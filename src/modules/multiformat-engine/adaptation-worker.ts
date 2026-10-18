import type { AdaptSucceededOutput, AdaptationRepository } from "../../core/ports/adaptation-repository";
import { logEvent, sanitizeError } from "../../lib/observability";
import {
  reclaimAbandonedWork,
  startLeaseRenewal,
} from "../../lib/worker-lease-runtime";
import type { RenderJobService } from "../video-rendering/render-job-service";
import { RenderWorkerHealth } from "../video-rendering/worker-health";
import { verifyRenderArtifact } from "../video-rendering/artifact/verify-render-artifact";
import { renderStorage } from "../video-rendering/storage/render-storage";
import { fitCopy } from "./adapters/copy/fit-copy";
import { survivingClaims, validateCopyOutput } from "./adapters/copy/validate-copy";
import { fitImage } from "./adapters/image/fit-image";
import { adaptSceneGraph } from "./adapters/video/adapt-scene";
import type {
  AdaptationJobRecord,
  AdaptationSourceSnapshot,
} from "./domain/types";
import { AdaptationError } from "./errors";
import { requireFormatContract } from "./formats/registry";
import { ADAPTATION_LIMITS } from "./limits";
import type { AdaptationRecipe } from "./domain/types";
import { parseRecipe } from "./recipe/hash-recipe";
import { sha256Hex } from "./serialization/hash-adaptation";
import { assertSnapshotIntegrity as checkSnapshot } from "./source/source-snapshot";
import type { MultiFormatSourceResolver } from "./source/source-resolver";
import { verifySourceIntegrity } from "./source/verify-source-integrity";
import type { AdaptationStorage } from "./storage/adaptation-storage";

export type AdaptationWorkerDeps = {
  repository: AdaptationRepository;
  sources: MultiFormatSourceResolver;
  storage: AdaptationStorage;
  renderJobs: Pick<
    RenderJobService,
    "enqueueContract" | "get" | "artifact"
  >;
  health?: RenderWorkerHealth;
  now?: () => Date;
};

/** How many jobs one pass claims before the loop re-checks the world. */
const ADAPTATION_WORKER_BATCH_SIZE = 4;

/** How long an idle pass waits before looking again. */
const ADAPTATION_WORKER_POLL_MS = 250;

/**
 * Sleeps, but wakes immediately on abort so a shutdown is not held up by the poll
 * interval.
 */
function waitOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type RunOnceResult = {
  processed: number;
  completed: number;
  failed: number;
  cancelled: number;
  waiting: number;
};

/**
 * A failure reason a caller already knows, rather than a thrown error.
 *
 * `AdaptationErrorCode` keeps these honest: a CP15 render code is admitted here on
 * purpose, because "the render failed because X" is more use to the person
 * reading the batch than a generic adaptation error.
 */
export type AdaptationFailure = {
  code: string;
  message: string;
};

function failureReason(error: unknown): AdaptationFailure {
  if (error instanceof AdaptationError) {
    return { code: error.code, message: error.message };
  }

  if (
    error &&
    typeof error === "object" &&
    typeof (error as AdaptationFailure).code === "string" &&
    typeof (error as AdaptationFailure).message === "string"
  ) {
    return {
      code: (error as AdaptationFailure).code,
      message: (error as AdaptationFailure).message,
    };
  }

  return {
    code: "ADAPTATION_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Turns one queued adaptation job into a produced variant.
 *
 * The worker decides nothing. It reads the recipe the service froze, re-checks the
 * frozen snapshot is still intact, produces exactly what the recipe says, and then
 * measures the result before recording it — so a stored variant is always
 * something that was checked, never something that was assumed.
 *
 * It owns no timers of its own beyond `run`: `runOnce`, the reconciliation passes
 * and the sweep are all callable on their own, so a test drives them directly and
 * the process wrapper only has to decide when to stop.
 */
export class AdaptationWorker {
  private readonly repository: AdaptationRepository;
  private readonly sources: MultiFormatSourceResolver;
  private readonly storage: AdaptationStorage;
  private readonly renderJobs: AdaptationWorkerDeps["renderJobs"];
  private readonly health: RenderWorkerHealth;
  private readonly now: () => Date;

  constructor(deps: AdaptationWorkerDeps) {
    this.repository = deps.repository;
    this.sources = deps.sources;
    this.storage = deps.storage;
    this.renderJobs = deps.renderJobs;
    this.health = deps.health ?? new RenderWorkerHealth();
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Claims and processes up to `limit` jobs.
   *
   * Claiming is atomic per job, so several workers can share one queue without
   * producing a variant twice; when nothing can be claimed the sweep is over.
   */
  async runOnce(limit = 1): Promise<RunOnceResult> {
    const result: RunOnceResult = {
      processed: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      waiting: 0,
    };

    for (let index = 0; index < limit; index += 1) {
      const job = await this.repository.claimNext();
      if (!job) break;

      result.processed += 1;
      this.health.markJobStarted(job.id);
      const stopLeaseRenewal = startLeaseRenewal(
        this.repository,
        "adaptation",
        job.id,
      );

      try {
        const outcome = await this.process(job);

        if (outcome === "SUCCEEDED") result.completed += 1;
        else if (outcome === "CANCELLED") result.cancelled += 1;
        else result.waiting += 1;

        // A job parked on a render is deliberately left as the current job: it is
        // still outstanding work, so reporting it finished would overstate what
        // this worker has actually delivered.
        if (outcome !== "WAITING_RENDER") {
          this.health.markJobFinished(
            outcome === "SUCCEEDED" ? "SUCCEEDED" : "CANCELLED",
          );
        }
      } catch (error) {
        result.failed += 1;
        await this.fail(job, error);
        this.health.markJobFinished("FAILED");
      } finally {
        stopLeaseRenewal();
      }
    }

    return result;
  }

  /**
   * Runs until the signal aborts.
   *
   * The loop keeps the housekeeping passes in step with real work, because the
   * things they fix — a render that finished, a cancellation that never landed, a
   * row nobody ever claimed — are all discovered while polling, not on a timer
   * that could drift away from the queue.
   */
  async run(signal?: AbortSignal): Promise<void> {
    this.health.markStarted();

    try {
      while (!signal?.aborted) {
        try {
          this.health.markTick();
          await reclaimAbandonedWork(this.repository, "adaptation");

          const result = await this.runOnce(ADAPTATION_WORKER_BATCH_SIZE);

          if (result.processed === 0) {
            await this.reconcileWaitingRenders();
            await this.settleCancelRequested();

            if ((await this.sweepAbandonedJobs()) > 0) continue;
          }

          await waitOrAbort(ADAPTATION_WORKER_POLL_MS, signal);
        } catch (error) {
          this.health.markError(
            error instanceof Error ? error.message : String(error),
          );
          logEvent("error", "worker.tick_failed", {
            worker: "adaptation",
            error: sanitizeError(error),
          });
          await waitOrAbort(ADAPTATION_WORKER_POLL_MS, signal);
        }
      }
    } finally {
      this.health.markStopped();
    }
  }

  /**
   * Finishes jobs whose cancellation was requested but never finalised — a worker
   * that was interrupted, or one that died holding the row.
   */
  async settleCancelRequested(): Promise<number> {
    const jobs = await this.repository.findCancelRequestedJobs();
    let settled = 0;

    for (const job of jobs) {
      await this.cancelled(job);
      settled += 1;
    }

    return settled;
  }

  /**
   * Reconciles video jobs parked on a CP15 render.
   *
   * A finished render hands CP19 its verified artifact. A failed one fails the
   * variant with the render's own reason, because "this composition could not be
   * encoded" is more use than a generic adaptation error. A render that is still
   * running, or a batch cancelled while it was in flight, is left alone.
   */
  async reconcileWaitingRenders(): Promise<number> {
    const jobs = await this.repository.findWaitingRenderJobs();
    let resolved = 0;

    for (const job of jobs) {
      if (job.status !== "WAITING_RENDER" || !job.renderJobId) continue;

      try {
        const render = await this.renderJobs.get({
          projectId: job.projectId,
          renderJobId: job.renderJobId,
          userId: job.requestedById,
        });

        if (render.status === "SUCCEEDED") {
          const artifact = await this.renderJobs.artifact({
            projectId: job.projectId,
            renderJobId: job.renderJobId,
            userId: job.requestedById,
          });

          if (!artifact) continue;

          await this.finishVideo(job, artifact);
          resolved += 1;
          continue;        }

        if (render.status === "FAILED") {
          await this.fail(job, {
            code: render.errorCode ?? "ADAPTATION_RENDER_FAILED",
            message: render.errorMessage ?? "The render failed",
          });
          resolved += 1;
          continue;
        }

        if (render.status === "CANCELLED") {
          await this.cancelled(job);
          resolved += 1;
        }
      } catch (error) {
        await this.fail(job, error);
        resolved += 1;
      }
    }

    return resolved;
  }

  /**
   * Fails jobs that were queued and never picked up.
   *
   * A queue entry older than the limit is treated as abandoned, so a batch says
   * why it stalled instead of sitting part-way forever.
   */
  async sweepAbandonedJobs(): Promise<number> {
    const cutoff = new Date(
      this.now().getTime() - ADAPTATION_LIMITS.maxQueueAgeMs,
    ).toISOString();

    const stale = await this.repository.findStaleQueuedJobs(cutoff);
    let swept = 0;

    for (const job of stale) {
      await this.fail(job, {
        code: "ADAPTATION_STALE_JOB",
        message: "This adaptation was never picked up by a worker",
      });
      swept += 1;
    }

    return swept;
  }

  private async process(
    job: AdaptationJobRecord,
  ): Promise<"SUCCEEDED" | "WAITING_RENDER" | "CANCELLED"> {
    if (job.status === "CANCEL_REQUESTED") {
      await this.cancelled(job);
      return "CANCELLED";
    }

    const recipe = parseRecipe(job.recipe);
    const batch = await this.repository.getBatch(job.projectId, job.batchId);

    if (!batch) {
      throw new AdaptationError(
        "ADAPTATION_BATCH_NOT_FOUND",
        "The batch this job belongs to no longer exists",
        500,
      );
    }

    // The recipe's digest is checked against the frozen snapshot, so a stored job
    // cannot be pointed at content it was not planned for.
    const snapshot = checkSnapshot({
      serialized: batch.sourceSnapshot,
      expectedSha256: batch.sourceSha256,
    });

    if (recipe.sourceSha256 !== batch.sourceSha256) {
      throw new AdaptationError(
        "ADAPTATION_SOURCE_CHANGED_SINCE_SNAPSHOT",
        "This job was planned against a different version of the source",
        409,
      );
    }

    const format = requireFormatContract(recipe.formatId);

    await this.repository.updateProgress(job.id, 10, this.timestamp());
    await this.repository.markRunning({
      jobId: job.id,
      startedAt: this.timestamp(),
      updatedAt: this.timestamp(),
    });

    await verifySourceIntegrity({
      projectId: job.projectId,
      snapshot,
      readSourceBytes: (input) => this.sources.readSourceBytes(input),
    });

    if (recipe.kind === "COPY") {
      return this.produceCopy(job, recipe, snapshot);
    }

    if (recipe.kind === "IMAGE") {
      return this.produceImage(job, recipe, snapshot, format);
    }

    return this.produceVideo(job, recipe, snapshot);
  }

  private async produceCopy(
    job: AdaptationJobRecord,
    recipe: AdaptationRecipe,
    snapshot: AdaptationSourceSnapshot,
  ): Promise<"SUCCEEDED"> {
    if (snapshot.sourceType !== "WRITING_VARIANT") {
      throw new AdaptationError(
        "ADAPTATION_SOURCE_TYPE_UNSUPPORTED",
        "Copy can only be adapted from writing",
        500,
      );
    }

    const maxCharacters = recipe.output.maxCharacters ?? 0;
    const maxWords = recipe.output.maxWords ?? 0;

    const fitted = fitCopy({
      text: snapshot.text,
      maxCharacters,
      maxWords,
    });

    if (fitted.text.length === 0) {
      throw new AdaptationError(
        "ADAPTATION_OUTPUT_INVALID",
        "Nothing in the source fits this format",
        422,
      );
    }

    validateCopyOutput({
      outputText: fitted.text,
      sourceText: snapshot.text,
      maxCharacters,
      maxWords,
    });

    // The worker re-derives provenance from the text it actually fitted, and
    // requires it to agree with what the recipe claimed. A recipe that promised
    // sources the fitted output does not support is a planning bug, and shipping
    // the variant anyway would put unsupported claims behind a real caption.
    const kept = survivingClaims({
      outputText: fitted.text,
      claims: snapshot.claims,
    });

    const derived = [...new Set(kept.sourceIds)].sort();
    const promised = [...new Set(recipe.provenanceSourceIds)].sort();

    if (derived.join(",") !== promised.join(",")) {
      throw new AdaptationError(
        "ADAPTATION_OUTPUT_INVALID",
        "The adapted copy does not support the sources this variant promised",
        500,
      );
    }

    await this.succeeded(job, {
      outputText: fitted.text,
      outputMimeType: recipe.output.mimeType,
      outputStorageKey: null,
      outputByteSize: Buffer.byteLength(fitted.text, "utf8"),
      outputChecksumSha256: sha256Hex(fitted.text),
      outputWidth: null,
      outputHeight: null,
      renderJobId: null,
    });

    return "SUCCEEDED";
  }

  private async produceImage(
    job: AdaptationJobRecord,
    recipe: AdaptationRecipe,
    snapshot: AdaptationSourceSnapshot,
    format: ReturnType<typeof requireFormatContract>,
  ): Promise<"SUCCEEDED"> {
    if (snapshot.sourceType !== "GENERATED_IMAGE") {
      throw new AdaptationError(
        "ADAPTATION_SOURCE_TYPE_UNSUPPORTED",
        "Images can only be adapted from generated images",
        500,
      );
    }

    if (!recipe.outputStorageKey) {
      throw new AdaptationError(
        "ADAPTATION_OUTPUT_INVALID",
        `${recipe.formatId} has no output location`,
        500,
      );
    }

    // Read the live bytes again rather than trusting the snapshot's metadata: the
    // file on disk is what is about to be cropped.
    const sourceBytes = await this.sources.readSourceBytes({
      projectId: job.projectId,
      snapshot,
    });

    const fitted = await fitImage({
      sourceBytes,
      sourceTransparent: snapshot.transparent,
      format,
    });

    await this.repository.updateProgress(job.id, 70, this.timestamp());

    const stored = await this.storage.putBytes(
      recipe.outputStorageKey,
      fitted.bytes,
    );

    await this.succeeded(job, {
      outputText: null,
      outputMimeType: fitted.mimeType,
      outputStorageKey: stored.storageKey,
      outputByteSize: stored.byteSize,
      outputChecksumSha256: stored.checksumSha256,
      outputWidth: fitted.width,
      outputHeight: fitted.height,
      renderJobId: null,
    });

    return "SUCCEEDED";
  }

  private async produceVideo(
    job: AdaptationJobRecord,
    recipe: AdaptationRecipe,
    snapshot: AdaptationSourceSnapshot,
  ): Promise<"SUCCEEDED" | "WAITING_RENDER" | "CANCELLED"> {
    if (snapshot.sourceType !== "VISUAL_COMPOSITION") {
      throw new AdaptationError(
        "ADAPTATION_SOURCE_TYPE_UNSUPPORTED",
        "Video can only be adapted from compositions",
        500,
      );
    }

    const contract = adaptSceneGraph({
      projectId: job.projectId,
      snapshot,
      targetWidth: recipe.output.width ?? snapshot.width,
      targetHeight: recipe.output.height ?? snapshot.height,
    });

    const render = await this.renderJobs.enqueueContract(
      job.projectId,
      job.requestedById,
      contract,
    );

    await this.repository.markWaitingRender({
      jobId: job.id,
      renderJobId: render.id,
      progressPct: 40,
      updatedAt: this.timestamp(),
    });

    // A render that is already resolved — a retry, or an instant failure — is
    // settled here rather than waiting for a sweep that may never arrive.
    if (render.status === "SUCCEEDED") {
      const artifact = await this.renderJobs.artifact({
        projectId: job.projectId,
        renderJobId: render.id,
        userId: job.requestedById,
      });

      if (artifact) {
        await this.finishVideo({ ...job, renderJobId: render.id }, artifact);
        return "SUCCEEDED";
      }

      return "WAITING_RENDER";
    }

    if (render.status === "FAILED") {
      await this.fail(job, {
        code: render.errorCode ?? "ADAPTATION_RENDER_FAILED",
        message: render.errorMessage ?? "The render failed",
      });

      return "SUCCEEDED";
    }

    return "WAITING_RENDER";
  }

  /**
   * Records a finished render as a finished variant.
   *
   * CP15's own verification is the gate, and it is run again here rather than
   * taken on trust: the artifact is re-probed with FFprobe against the width,
   * height and duration the recipe asked for, and CP19 records the checksum and
   * byte size that probe produced. A variant is never marked succeeded on the
   * strength of a render row alone.
   */
  private async finishVideo(
    job: AdaptationJobRecord,
    artifact: { storageKey: string },
  ): Promise<void> {
    const recipe = parseRecipe(job.recipe);
    const batch = await this.repository.getBatch(job.projectId, job.batchId);

    if (!batch) {
      throw new AdaptationError(
        "ADAPTATION_BATCH_NOT_FOUND",
        "The batch this job belongs to no longer exists",
        500,
      );
    }

    const snapshot = checkSnapshot({
      serialized: batch.sourceSnapshot,
      expectedSha256: batch.sourceSha256,
    });

    if (snapshot.sourceType !== "VISUAL_COMPOSITION") {
      throw new AdaptationError(
        "ADAPTATION_SOURCE_TYPE_UNSUPPORTED",
        "Video can only be adapted from compositions",
        500,
      );
    }

    const verified = await verifyRenderArtifact(
      renderStorage.absolutePath(artifact.storageKey),
      {
        width: recipe.output.width ?? snapshot.width,
        height: recipe.output.height ?? snapshot.height,
        durationMs: snapshot.durationMs,
      },
    );

    await this.succeeded(job, {
      outputText: null,
      outputMimeType: "video/mp4",
      // The bytes live in CP15's storage; CP19 records the reference, not a copy.
      outputStorageKey: null,
      outputByteSize: verified.byteSize,
      outputChecksumSha256: verified.checksumSha256,
      outputWidth: verified.width,
      outputHeight: verified.height,
      renderJobId: job.renderJobId,
    });
  }

  private async succeeded(
    job: AdaptationJobRecord,
    output: AdaptSucceededOutput,
  ): Promise<void> {
    const finishedAt = this.timestamp();

    await this.repository.markSucceeded({
      jobId: job.id,
      output,
      finishedAt,
      updatedAt: finishedAt,
    });

    await this.repository.refreshBatchStatus({
      batchId: job.batchId,
      updatedAt: finishedAt,
    });
  }

  private async cancelled(job: AdaptationJobRecord): Promise<void> {
    const finishedAt = this.timestamp();

    await this.repository.markCancelled({
      jobId: job.id,
      finishedAt,
      updatedAt: finishedAt,
    });

    await this.repository.refreshBatchStatus({
      batchId: job.batchId,
      updatedAt: finishedAt,
    });
  }

  /**
   * Records why a job could not be produced, then refreshes its batch.
   *
   * The refresh happens on failure too: a batch whose last remaining job just
   * failed is finished, and leaving it part-way would misreport the run forever.
   *
   * A caller that already knows the reason — a CP15 render that failed with its
   * own code, a sweep that never got a worker — passes that reason rather than an
   * `Error`, because re-deriving the code from an `Error` would flatten every
   * specific cause into one generic one and throw away the only clue the caller
   * had.
   */
  private async fail(job: AdaptationJobRecord, error: unknown): Promise<void> {
    const reason = failureReason(error);
    const finishedAt = this.timestamp();

    await this.repository.markFailed({
      jobId: job.id,
      errorCode: reason.code,
      errorMessage: reason.message.slice(0, 500),
      finishedAt,
      updatedAt: finishedAt,
    });

    await this.repository.refreshBatchStatus({
      batchId: job.batchId,
      updatedAt: finishedAt,
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
