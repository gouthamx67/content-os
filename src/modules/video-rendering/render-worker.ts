import { createId } from "../../lib/id";
import type { RenderJobRepository } from "../../core/ports/render-job-repository";
import type { RenderJobRecord } from "./domain/types";
import { RenderError, RenderCancelledError } from "./errors";
import { assertWithinRenderLimits, validateRendererContract } from "./contract/validate-renderer-contract";
import { getFfmpegVersion } from "./ffmpeg/capabilities";
import { verifyRenderArtifact } from "./artifact/verify-render-artifact";
import { renderVideo } from "./renderer/video-renderer";
import { RenderAssetResolver } from "./assets/render-asset-resolver";
import {
  artifactStorageKey,
  type RenderStorage,
} from "./storage/render-storage";
import { RENDER_OUTPUT } from "./render-limits";
import { RenderWorkerHealth } from "./worker-health";

export type RenderWorkerDeps = {
  repository: RenderJobRepository;
  storage: RenderStorage;
  assets: RenderAssetResolver;
  health?: RenderWorkerHealth;
  pollIntervalMs?: number;
  cancelPollIntervalMs?: number;
  progressThrottleMs?: number;
  workDirRoot?: string;
  fontFile?: string | null;
};

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_CANCEL_POLL_MS = 500;
const DEFAULT_PROGRESS_THROTTLE_MS = 400;

/**
 * Pulls render jobs off the queue, one at a time.
 *
 * A single in-process worker is enough for this deployment, and a single worker
 * keeps concurrency at one so a render cannot starve the web app's event loop.
 * The claim itself is still atomic, so a second worker can be started later
 * without changing this class.
 */
export class RenderWorker {
  private readonly repository: RenderJobRepository;
  private readonly storage: RenderStorage;
  private readonly assets: RenderAssetResolver;
  readonly health: RenderWorkerHealth;
  private readonly pollIntervalMs: number;
  private readonly cancelPollIntervalMs: number;
  private readonly progressThrottleMs: number;
  private readonly workDirRoot: string | undefined;
  private readonly fontFile: string | null | undefined;

  constructor(deps: RenderWorkerDeps) {
    this.repository = deps.repository;
    this.storage = deps.storage;
    this.assets = deps.assets;
    this.health = deps.health ?? new RenderWorkerHealth();
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.cancelPollIntervalMs = deps.cancelPollIntervalMs ?? DEFAULT_CANCEL_POLL_MS;
    this.progressThrottleMs = deps.progressThrottleMs ?? DEFAULT_PROGRESS_THROTTLE_MS;
    this.workDirRoot = deps.workDirRoot;
    this.fontFile = deps.fontFile;
  }

  /** Processes at most one queued job. Returns true if work was done. */
  async tick(): Promise<boolean> {
    this.health.markTick();
    await this.finalizeOrphanedCancellations();

    const job = await this.repository.claimNext();
    if (!job) return false;

    await this.process(job);
    return true;
  }

  /** Runs until the signal aborts, sleeping between empty polls. */
  async run(signal?: AbortSignal): Promise<void> {
    this.health.markStarted();

    try {
      while (!signal?.aborted) {
        const worked = await this.tick();
        if (!worked) await this.sleep(this.pollIntervalMs, signal);
      }
    } finally {
      this.health.markStopped();
    }
  }

  private async process(job: RenderJobRecord): Promise<void> {
    this.health.markJobStarted(job.id);

    const controller = new AbortController();
    const cancelTimer = setInterval(() => {
      void this.checkCancelled(job, controller);
    }, this.cancelPollIntervalMs);
    cancelTimer.unref?.();

    let dispose: (() => Promise<void>) | null = null;

    try {
      const contract = validateRendererContract(JSON.parse(job.sceneGraph));
      assertWithinRenderLimits(contract);

      const ffmpegVersion = await getFfmpegVersion();
      const now = new Date().toISOString();
      await this.repository.markRunning({
        renderJobId: job.id,
        ffmpegVersion,
        startedAt: now,
        updatedAt: now,
      });

      if (controller.signal.aborted) throw new RenderCancelledError();

      const result = await renderVideo({
        renderJobId: job.id,
        projectId: job.projectId,
        contract,
        assets: this.assets,
        signal: controller.signal,
        onProgress: (percent) => {
          void this.reportProgress(job, percent);
        },
        fontFile: this.fontFile,
        workDirRoot: this.workDirRoot,
      });
      dispose = result.dispose;

      const verified = await verifyRenderArtifact(result.outputPath, {
        width: job.width,
        height: job.height,
        durationMs: job.durationMs,
      });

      const storageKey = artifactStorageKey(job.projectId, job.id);
      const stored = await this.storage.putFile(storageKey, result.outputPath);

      const finishedAt = new Date().toISOString();
      await this.repository.createArtifact({
        id: createId("rart"),
        renderJobId: job.id,
        projectId: job.projectId,
        storageKey: stored.storageKey,
        mimeType: RENDER_OUTPUT.mimeType,
        byteSize: verified.byteSize,
        checksumSha256: verified.checksumSha256,
        createdAt: finishedAt,
      });

      await this.repository.markSucceeded({
        renderJobId: job.id,
        ffmpegVersion: result.ffmpegVersion,
        finishedAt,
        updatedAt: finishedAt,
      });

      this.health.markJobFinished("SUCCEEDED");
    } catch (error) {
      if (error instanceof RenderCancelledError) {
        await this.repository.markCancelled({
          renderJobId: job.id,
          finishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        this.health.markJobFinished("CANCELLED");
      } else {
        const code = error instanceof RenderError ? error.code : "RENDER_FAILED";
        const message = sanitizeMessage(
          error instanceof Error ? error.message : "Render failed",
        );
        await this.repository.markFailed({
          renderJobId: job.id,
          errorCode: code,
          errorMessage: message,
          finishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        this.health.markError(message);
        this.health.markJobFinished("FAILED");
      }
    } finally {
      clearInterval(cancelTimer);
      if (dispose) await dispose().catch(() => undefined);
    }
  }

  private async checkCancelled(
    job: RenderJobRecord,
    controller: AbortController,
  ): Promise<void> {
    if (controller.signal.aborted) return;
    try {
      const fresh = await this.repository.get(job.projectId, job.id);
      if (fresh?.status === "CANCEL_REQUESTED") controller.abort();
    } catch {
      // A transient read failure must not abort a healthy render.
    }
  }

  private async reportProgress(job: RenderJobRecord, percent: number): Promise<void> {
    const bounded = Math.max(0, Math.min(100, percent));
    const now = Date.now();
    const bucket = Math.floor(bounded);

    if (bucket <= this.lastPercent || now - this.lastProgressAt < this.progressThrottleMs) {
      return;
    }

    this.lastPercent = bucket;
    this.lastProgressAt = now;

    try {
      await this.repository.updateProgress(
        job.id,
        bucket,
        new Date().toISOString(),
      );
    } catch {
      // Progress is best-effort; the terminal transition is what must persist.
    }
  }

  private async finalizeOrphanedCancellations(): Promise<void> {
    const orphans = await this.repository.findCancelRequested();
    if (orphans.length === 0) return;

    const now = new Date().toISOString();
    for (const orphan of orphans) {
      if (this.health.snapshot().currentJobId === orphan.id) continue;
      await this.repository.markCancelled({
        renderJobId: orphan.id,
        finishedAt: now,
        updatedAt: now,
      });
    }
  }

  private lastPercent = -1;
  private lastProgressAt = 0;

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}

/**
 * FFmpeg diagnostics can include absolute filesystem paths. They are kept for
 * grouping but reduced to a placeholder before they reach a stored row or an
 * API response.
 */
export function sanitizeMessage(message: string): string {
  const singleLine = message.replace(/\s+/g, " ").trim();
  const withoutPaths = singleLine.replace(/(?:\/[\w.@+-]+){2,}/g, "<path>");
  return withoutPaths.slice(0, 400);
}
