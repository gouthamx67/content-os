import { createId } from "../../../lib/id";
import path from "node:path";
import type { AudioRepository } from "../../../core/ports/audio-repository";
import { RenderWorkerHealth } from "../../video-rendering/worker-health";
import { sanitizeMessage } from "../../video-rendering/render-worker";
import { getFfmpegVersion } from "../../video-rendering/ffmpeg/capabilities";
import type { AudioSourceResolver } from "../assets/audio-source-resolver";
import type { AudioStorage } from "../storage/audio-storage";
import { audioArtifactStorageKey } from "../storage/audio-storage";
import type { AudioGraph } from "../serialization/audio-graph";
import { AudioCancelledError, AudioError, AudioExecutionError } from "../errors";
import { validateAudioComposition } from "../domain/validation";
import { renderAudio } from "../renderer/audio-renderer";
import { muxVideoAudio } from "../renderer/mux-video-audio";
import { verifyAudioArtifact, verifyMuxedVideoArtifact } from "../artifact/verify-audio-artifact";
import type { AudioRenderJobRecord } from "../domain/types";

export type VideoArtifactSummary = {
  storageKey: string;
  width: number;
  height: number;
};

export type AudioWorkerDeps = {
  repository: AudioRepository;
  storage: AudioStorage;
  sources: AudioSourceResolver;
  videoArtifactFor: (videoRenderJobId: string) => Promise<VideoArtifactSummary | null>;
  videoStoragePath: (storageKey: string) => string;
  health?: RenderWorkerHealth;
  pollIntervalMs?: number;
  cancelPollIntervalMs?: number;
  progressThrottleMs?: number;
  workDirRoot?: string;
};

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_CANCEL_POLL_MS = 500;
const DEFAULT_PROGRESS_THROTTLE_MS = 400;

/**
 * Pulls audio render jobs off the queue, one at a time.
 *
 * One job at a time keeps FFmpeg from saturating the host. The claim is atomic,
 * so a second worker can be run later without two workers winning the same job.
 * A queued job is rendered from its frozen graph, never from the mutable track
 * rows, so an edit during a render cannot leak into the artifact.
 */
export class AudioRenderWorker {
  private readonly repository: AudioRepository;
  private readonly storage: AudioStorage;
  private readonly sources: AudioSourceResolver;
  private readonly videoArtifactFor: AudioWorkerDeps["videoArtifactFor"];
  private readonly videoStoragePath: AudioWorkerDeps["videoStoragePath"];
  readonly health: RenderWorkerHealth;
  private readonly pollIntervalMs: number;
  private readonly cancelPollIntervalMs: number;
  private readonly progressThrottleMs: number;
  private readonly workDirRoot: string | undefined;

  constructor(deps: AudioWorkerDeps) {
    this.repository = deps.repository;
    this.storage = deps.storage;
    this.sources = deps.sources;
    this.videoArtifactFor = deps.videoArtifactFor;
    this.videoStoragePath = deps.videoStoragePath;
    this.health = deps.health ?? new RenderWorkerHealth();
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.cancelPollIntervalMs = deps.cancelPollIntervalMs ?? DEFAULT_CANCEL_POLL_MS;
    this.progressThrottleMs = deps.progressThrottleMs ?? DEFAULT_PROGRESS_THROTTLE_MS;
    this.workDirRoot = deps.workDirRoot;
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

  private async process(job: AudioRenderJobRecord): Promise<void> {
    this.health.markJobStarted(job.id);

    const controller = new AbortController();
    const cancelTimer = setInterval(() => {
      void this.checkCancelled(job, controller);
    }, this.cancelPollIntervalMs);
    cancelTimer.unref?.();

    let dispose: (() => Promise<void>) | null = null;

    try {
      const graph = JSON.parse(job.audioGraph) as AudioGraph;
      validateAudioComposition(graph.composition.tracks, graph.composition.durationMs);

      const ffmpegVersion = await getFfmpegVersion();
      const startedAt = new Date().toISOString();
      await this.repository.markRunning({
        audioRenderJobId: job.id,
        ffmpegVersion,
        startedAt,
        updatedAt: startedAt,
      });

      if (controller.signal.aborted) throw new AudioCancelledError();

      const result = await renderAudio({
        audioRenderJobId: job.id,
        projectId: job.projectId,
        graph,
        sources: this.sources,
        signal: controller.signal,
        onProgress: (percent) => {
          void this.reportProgress(job, percent);
        },
        workDirRoot: this.workDirRoot,
      });
      dispose = result.dispose;

      const verified = await verifyAudioArtifact(result.outputPath, {
        sampleRate: job.sampleRate,
        channels: job.channels,
        durationMs: job.durationMs,
      });

      const wavKey = audioArtifactStorageKey(job.projectId, job.id, "wav");
      const storedWav = await this.storage.putFile(wavKey, result.outputPath);

      const finishedAt = new Date().toISOString();
      await this.repository.createAudioArtifact({
        id: createId("aart"),
        audioRenderJobId: job.id,
        projectId: job.projectId,
        storageKey: storedWav.storageKey,
        mimeType: "audio/wav",
        byteSize: verified.byteSize,
        checksumSha256: verified.checksumSha256,
        createdAt: finishedAt,
      });

      if (job.outputFormat === "MP4") {
        if (!job.videoRenderJobId) {
          throw new AudioExecutionError(
            "MP4 audio job is missing its video render job",
          );
        }

        const video = await this.videoArtifactFor(job.videoRenderJobId);
        if (!video) {
          throw new AudioError(
            "VIDEO_ARTIFACT_NOT_READY",
            "Video artifact is not available for muxing",
            409,
          );
        }

        if (controller.signal.aborted) throw new AudioCancelledError();

        const muxedPath = path.join(
          path.dirname(result.outputPath),
          "final.mp4",
        );

        await muxVideoAudio({
          videoPath: this.videoStoragePath(video.storageKey),
          audioPath: result.outputPath,
          outputPath: muxedPath,
          durationMs: job.durationMs,
          signal: controller.signal,
          onProgress: (percent) => {
            void this.reportProgress(job, percent);
          },
        });

        const verifiedMux = await verifyMuxedVideoArtifact(muxedPath, {
          width: video.width,
          height: video.height,
          durationMs: job.durationMs,
        });

        const mp4Key = audioArtifactStorageKey(job.projectId, job.id, "mp4");
        const storedMp4 = await this.storage.putFile(mp4Key, muxedPath);

        const muxedAt = new Date().toISOString();
        await this.repository.createMuxedArtifact({
          id: createId("mart"),
          audioRenderJobId: job.id,
          projectId: job.projectId,
          videoRenderJobId: job.videoRenderJobId,
          storageKey: storedMp4.storageKey,
          mimeType: "video/mp4",
          byteSize: verifiedMux.byteSize,
          checksumSha256: verifiedMux.checksumSha256,
          createdAt: muxedAt,
        });
      }

      await this.repository.markSucceeded({
        audioRenderJobId: job.id,
        ffmpegVersion: result.ffmpegVersion,
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      this.health.markJobFinished("SUCCEEDED");
    } catch (error) {
      if (error instanceof AudioCancelledError) {
        await this.repository.markCancelled({
          audioRenderJobId: job.id,
          finishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        this.health.markJobFinished("CANCELLED");
      } else {
        const code = error instanceof AudioError ? error.code : "AUDIO_FFMPEG_FAILED";
        const message = sanitizeMessage(
          error instanceof Error ? error.message : "Audio render failed",
        );
        await this.repository.markFailed({
          audioRenderJobId: job.id,
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
    job: AudioRenderJobRecord,
    controller: AbortController,
  ): Promise<void> {
    if (controller.signal.aborted) return;
    try {
      const fresh = await this.repository.getRenderJob(job.projectId, job.id);
      if (fresh?.status === "CANCEL_REQUESTED") controller.abort();
    } catch {
      // A transient read failure must not abort a healthy render.
    }
  }

  private async reportProgress(
    job: AudioRenderJobRecord,
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
        audioRenderJobId: orphan.id,
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
