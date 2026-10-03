import { createId } from "../../lib/id";
import type { ImageGenerationRepository } from "../../core/ports/image-generation-repository";
import { RenderWorkerHealth } from "../video-rendering/worker-health";
import { sanitizeMessage } from "../video-rendering/render-worker";
import { inspectImage } from "./artifact/image-metadata";
import { verifyGeneratedImage } from "./artifact/verify-image";
import type { ImageSourceDependencies } from "./assets/resolve-product-asset";
import { resolveImageSource } from "./assets/resolve-product-asset";
import { validateDesignGraph } from "./domain/validation";
import type { ImageGenerationJobRecord } from "./domain/types";
import {
  ImageCancelledError,
  ImageExecutionError,
  ImageGenerationError,
} from "./errors";
import { getImageProvider } from "./providers/registry";
import { parseGenerationRecipe } from "./recipe/generation-recipe";
import { bytesToDataUrl } from "./render/embed-image";
import type { ImageStorage } from "./storage/image-storage";
import { imageArtifactStorageKey } from "./storage/image-storage";

export type ImageWorkerDeps = {
  repository: ImageGenerationRepository;
  storage: ImageStorage;
  sources: ImageSourceDependencies;
  health?: RenderWorkerHealth;
  pollIntervalMs?: number;
  cancelPollIntervalMs?: number;
  progressThrottleMs?: number;
};

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_CANCEL_POLL_MS = 500;
const DEFAULT_PROGRESS_THROTTLE_MS = 400;

/**
 * Pulls image generation jobs off the queue, one at a time.
 *
 * The claim is atomic, so a second worker can be added without two workers
 * winning the same job. The job is rendered from its frozen recipe, never from
 * live project state, so a brand or product edit during a run cannot leak into
 * the artifact. Bytes are verified before the job is allowed to say SUCCEEDED.
 */
export class ImageGenerationWorker {
  private readonly repository: ImageGenerationRepository;
  private readonly storage: ImageStorage;
  private readonly sources: ImageSourceDependencies;
  readonly health: RenderWorkerHealth;
  private readonly pollIntervalMs: number;
  private readonly cancelPollIntervalMs: number;
  private readonly progressThrottleMs: number;

  private lastPercent = -1;
  private lastProgressAt = 0;

  constructor(deps: ImageWorkerDeps) {
    this.repository = deps.repository;
    this.storage = deps.storage;
    this.sources = deps.sources;
    this.health = deps.health ?? new RenderWorkerHealth();
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.cancelPollIntervalMs =
      deps.cancelPollIntervalMs ?? DEFAULT_CANCEL_POLL_MS;
    this.progressThrottleMs =
      deps.progressThrottleMs ?? DEFAULT_PROGRESS_THROTTLE_MS;
  }

  async tick(): Promise<boolean> {
    this.health.markTick();
    await this.finalizeOrphanedCancellations();

    const job = await this.repository.claimNext();
    if (!job) return false;

    await this.process(job);
    return true;
  }

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

  private async process(job: ImageGenerationJobRecord): Promise<void> {
    this.health.markJobStarted(job.id);
    this.lastPercent = -1;
    this.lastProgressAt = 0;

    const controller = new AbortController();
    const cancelTimer = setInterval(() => {
      void this.checkCancelled(job, controller);
    }, this.cancelPollIntervalMs);
    cancelTimer.unref?.();

    try {
      const recipe = parseGenerationRecipe(job.generationRecipe);
      validateDesignGraph(recipe.designGraph);
      const provider = getImageProvider(recipe.provider);

      const startedAt = new Date().toISOString();
      await this.repository.markRunning({
        jobId: job.id,
        providerVersion: provider.version,
        startedAt,
        updatedAt: startedAt,
      });

      if (controller.signal.aborted) throw new ImageCancelledError();
      await this.reportProgress(job, 20);

      const imageDataUrls = await this.resolveSources(job.projectId, recipe);
      if (controller.signal.aborted) throw new ImageCancelledError();
      await this.reportProgress(job, 40);

      const result = await provider.generate({
        graph: recipe.designGraph,
        width: recipe.width,
        height: recipe.height,
        format: recipe.outputFormat,
        transparent: recipe.transparent,
        imageDataUrls,
      });
      await this.reportProgress(job, 80);

      if (controller.signal.aborted) throw new ImageCancelledError();

      const metadata = await inspectImage(result.bytes);
      await verifyGeneratedImage({
        bytes: result.bytes,
        metadata,
        expected: {
          width: recipe.width,
          height: recipe.height,
          format: recipe.outputFormat,
          transparent: recipe.transparent,
        },
      });

      const extension = recipe.outputFormat === "JPEG" ? "jpg" : "png";
      const key = imageArtifactStorageKey(job.projectId, job.id, extension);
      const stored = await this.storage.putBytes(key, result.bytes);

      const finishedAt = new Date().toISOString();
      await this.repository.createAsset({
        id: createId("iasset"),
        projectId: job.projectId,
        generationJobId: job.id,
        graphicDocumentId: job.graphicDocumentId,
        storageKey: stored.storageKey,
        mimeType: result.mimeType,
        outputFormat: recipe.outputFormat,
        width: metadata.width,
        height: metadata.height,
        byteSize: stored.byteSize,
        checksumSha256: stored.checksumSha256,
        transparent: recipe.transparent,
        metadata: JSON.stringify(metadata),
        createdAt: finishedAt,
      });

      await this.reportProgress(job, 100);
      await this.repository.markSucceeded({
        jobId: job.id,
        providerJobId: result.providerJobId,
        providerModel: result.providerModel,
        providerVersion: result.providerVersion,
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      this.health.markJobFinished("SUCCEEDED");
    } catch (error) {
      if (error instanceof ImageCancelledError) {
        const now = new Date().toISOString();
        await this.repository.markCancelled({
          jobId: job.id,
          finishedAt: now,
          updatedAt: now,
        });
        this.health.markJobFinished("CANCELLED");
      } else {
        const code =
          error instanceof ImageGenerationError
            ? error.code
            : "IMAGE_GENERATION_FAILED";
        const message = sanitizeMessage(
          error instanceof Error ? error.message : "Image generation failed",
        );
        const now = new Date().toISOString();
        await this.repository.markFailed({
          jobId: job.id,
          errorCode: code,
          errorMessage: message,
          finishedAt: now,
          updatedAt: now,
        });
        this.health.markError(message);
        this.health.markJobFinished("FAILED");
      }
    } finally {
      clearInterval(cancelTimer);
    }
  }

  private async resolveSources(
    projectId: string,
    recipe: ReturnType<typeof parseGenerationRecipe>,
  ): Promise<Map<string, string>> {
    const byRef = new Map<string, string>();

    for (const ref of recipe.sourceAssetRefs) {
      const source = await resolveImageSource(projectId, ref, this.sources);
      byRef.set(ref, bytesToDataUrl(source.bytes, source.mimeType));
    }

    const byElement = new Map<string, string>();
    for (const element of recipe.designGraph.elements) {
      if (element.type !== "IMAGE" || !element.assetRef) continue;
      const dataUrl = byRef.get(element.assetRef);
      if (!dataUrl) {
        throw new ImageExecutionError(
          `Image element ${element.id} references an unresolved source`,
        );
      }
      byElement.set(element.id, dataUrl);
    }

    return byElement;
  }

  private async checkCancelled(
    job: ImageGenerationJobRecord,
    controller: AbortController,
  ): Promise<void> {
    if (controller.signal.aborted) return;
    try {
      const fresh = await this.repository.getJob(job.projectId, job.id);
      if (fresh?.status === "CANCEL_REQUESTED") controller.abort();
    } catch {
      // A transient read failure must not abort a healthy generation.
    }
  }

  private async reportProgress(
    job: ImageGenerationJobRecord,
    percent: number,
  ): Promise<void> {
    const bounded = Math.max(0, Math.min(100, percent));
    const now = Date.now();
    const bucket = Math.floor(bounded);

    if (
      bucket <= this.lastPercent ||
      now - this.lastProgressAt < this.progressThrottleMs
    ) {
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
        jobId: orphan.id,
        finishedAt: now,
        updatedAt: now,
      });
    }
  }

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
