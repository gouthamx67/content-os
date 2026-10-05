import { createId } from "../../lib/id";
import type { WritingRepository } from "../../core/ports/writing-repository";
import type {
  CreateWritingClaimInput,
  CreateWritingVariantInput,
} from "../../core/ports/writing-repository";
import { sanitizeMessage } from "../video-rendering/render-worker";
import { RenderWorkerHealth } from "../video-rendering/worker-health";
import { validateVariant } from "./claims/validate-variant";
import type {
  WritingCandidate,
  WritingContext,
  WritingGenerationJobRecord,
} from "./domain/types";
import { WritingError } from "./errors";
import type { WritingProviderRegistry } from "./providers/registry";
import { parseWritingContext } from "./recipe/snapshot";
import { sha256Hex } from "./serialization/hash-writing";

export type WritingWorkerDeps = {
  repository: WritingRepository;
  registry: WritingProviderRegistry;
  health?: RenderWorkerHealth;
  pollIntervalMs?: number;
  cancelPollIntervalMs?: number;
  progressThrottleMs?: number;
};

export class WritingCancelledError extends Error {
  override readonly name = "WritingCancelledError";
  constructor() {
    super("Writing job cancelled");
  }
}

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_CANCEL_POLL_MS = 500;
const DEFAULT_PROGRESS_THROTTLE_MS = 400;

function documentTitle(context: WritingContext): string {
  const name = context.product.name ?? context.brand.name ?? "Untitled";
  return `${name} ${context.blockType.toLowerCase().replace(/_/g, " ")}`.slice(
    0,
    120,
  );
}

type Accepted = {
  candidate: WritingCandidate;
  text: string;
  claims: ReturnType<typeof validateVariant>["claims"];
};

/**
 * Pulls writing jobs off the queue, one at a time.
 *
 * It reads only the job's frozen context, never live project state: the copy it
 * persists is grounded against exactly the facts the request captured. A run
 * where every candidate invents something fails with WRITING_NO_GROUNDED_VARIANTS
 * rather than persisting copy the project cannot support.
 */
export class WritingGenerationWorker {
  private readonly repository: WritingRepository;
  private readonly registry: WritingProviderRegistry;
  readonly health: RenderWorkerHealth;
  private readonly pollIntervalMs: number;
  private readonly cancelPollIntervalMs: number;
  private readonly progressThrottleMs: number;

  private lastPercent = -1;
  private lastProgressAt = 0;

  constructor(deps: WritingWorkerDeps) {
    this.repository = deps.repository;
    this.registry = deps.registry;
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

  private async process(job: WritingGenerationJobRecord): Promise<void> {
    this.health.markJobStarted(job.id);
    this.lastPercent = -1;
    this.lastProgressAt = 0;

    const controller = new AbortController();
    const cancelTimer = setInterval(() => {
      void this.checkCancelled(job, controller);
    }, this.cancelPollIntervalMs);
    cancelTimer.unref?.();

    try {
      const context = parseWritingContext(job.contextSnapshot);
      const provider = this.registry.resolve(job.provider);

      const startedAt = new Date().toISOString();
      await this.repository.markRunning({
        jobId: job.id,
        providerVersion: null,
        startedAt,
        updatedAt: startedAt,
      });

      if (controller.signal.aborted) throw new WritingCancelledError();
      await this.reportProgress(job, 20);

      const result = await provider.generate({
        context,
        variantCount: job.variantCount,
      });
      await this.reportProgress(job, 60);

      if (controller.signal.aborted) throw new WritingCancelledError();

      const accepted: Accepted[] = [];
      for (const candidate of result.candidates) {
        const validation = validateVariant(candidate.text, context);
        if (validation.accepted) {
          accepted.push({
            candidate,
            text: candidate.text,
            claims: validation.claims,
          });
        }
      }

      if (accepted.length === 0) {
        throw new WritingError(
          "WRITING_NO_GROUNDED_VARIANTS",
          "No generated variant could be grounded in the project",
          422,
        );
      }

      const now = new Date().toISOString();
      const documentId = createId("wdoc");
      const first = accepted[0] as Accepted;

      const variants: CreateWritingVariantInput[] = accepted.map(
        (entry, index) => ({
          id: createId("wvar"),
          documentId,
          ordinal: index,
          label: entry.candidate.label?.trim() || `V${index + 1}`,
          text: entry.text,
          textSha256: sha256Hex(entry.text),
          instruction: entry.candidate.instruction ?? null,
          selected: index === 0,
          createdAt: now,
          updatedAt: now,
        }),
      );

      const claims: CreateWritingClaimInput[] = [];
      accepted.forEach((entry, index) => {
        const variant = variants[index];
        if (!variant) return;
        for (const claim of entry.claims) {
          claims.push({
            id: createId("wclm"),
            projectId: job.projectId,
            documentId,
            variantId: variant.id,
            text: claim.text,
            status: claim.status,
            sourceIds: claim.sourceIds,
            reasoning: claim.reasoning,
            createdAt: now,
          });
        }
      });

      await this.repository.persistGeneratedDocument({
        document: {
          id: documentId,
          projectId: job.projectId,
          createdById: job.requestedById,
          title: documentTitle(context),
          blockType: job.blockType,
          tone: job.tone,
          length: job.length,
          objective: job.objective,
          audience: job.audience,
          language: job.language,
          content: first.text,
          contentSha256: sha256Hex(first.text),
          contextSnapshot: job.contextSnapshot,
          contextSha256: job.contextSha256,
          version: 1,
          brandVersion: context.brandVersion,
          intelligenceVersion: context.intelligenceVersion,
          intentId: context.intent?.id ?? null,
          directionId: context.direction?.id ?? null,
          storyboardId: context.scene?.storyboardId ?? null,
          sceneId: context.scene?.sceneId ?? null,
          createdAt: now,
          updatedAt: now,
        },
        variants,
        claims,
      });

      await this.reportProgress(job, 100);
      const finishedAt = new Date().toISOString();
      await this.repository.markSucceeded({
        jobId: job.id,
        documentId,
        providerModel: result.providerModel,
        providerVersion: result.providerVersion,
        finishedAt,
        updatedAt: finishedAt,
      });

      this.health.markJobFinished("SUCCEEDED");
    } catch (error) {
      if (error instanceof WritingCancelledError) {
        const now = new Date().toISOString();
        await this.repository.markCancelled({
          jobId: job.id,
          finishedAt: now,
          updatedAt: now,
        });
        this.health.markJobFinished("CANCELLED");
      } else {
        const code =
          error instanceof WritingError
            ? error.code
            : "WRITING_GENERATION_FAILED";
        const message = sanitizeMessage(
          error instanceof Error ? error.message : "Writing generation failed",
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

  private async checkCancelled(
    job: WritingGenerationJobRecord,
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
    job: WritingGenerationJobRecord,
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
