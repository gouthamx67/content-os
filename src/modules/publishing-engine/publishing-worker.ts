import { sanitizeMessage } from "../video-rendering/render-worker";
import { RenderWorkerHealth } from "../video-rendering/worker-health";
import { logEvent, sanitizeError } from "../../lib/observability";
import { LEASE_RENEW_MS } from "../../lib/worker-lease-runtime";
import type { PublishingRepository } from "../../core/ports/publishing-repository";
import type { PublicationRecord } from "./domain/types";

export type PublishingWorkerDeps = {
  repository: PublishingRepository;
  /** Executes a publication claimed into PUBLISHING. */
  dispatch: (publication: PublicationRecord) => Promise<PublicationRecord | null>;
  /** Collects one analytics refresh the claim stamped. */
  collectAnalytics: (
    publication: PublicationRecord,
  ) => Promise<PublicationRecord | null>;
  health?: RenderWorkerHealth;
  pollIntervalMs?: number;
  ambiguousCooldownMs?: number;
  analyticsStaleClaimMs?: number;
};

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_AMBIGUOUS_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_ANALYTICS_STALE_CLAIM_MS = 10 * 60_000;

/**
 * Drains the CP23 queues, one publication at a time: due publishes (QUEUED or
 * SCHEDULED in the past), then ambiguous outcomes old enough to reconcile by
 * re-sending the same idempotency key, then claimed analytics refreshes.
 *
 * Scheduling is durable in Postgres, so a restart resumes exactly where the
 * previous process stopped and no in-process timer owns a due time.
 */
export class PublishingWorker {
  private readonly repository: PublishingRepository;
  private readonly dispatch: PublishingWorkerDeps["dispatch"];
  private readonly collectAnalytics: PublishingWorkerDeps["collectAnalytics"];
  readonly health: RenderWorkerHealth;
  private readonly pollIntervalMs: number;
  private readonly ambiguousCooldownMs: number;
  private readonly analyticsStaleClaimMs: number;

  constructor(deps: PublishingWorkerDeps) {
    this.repository = deps.repository;
    this.dispatch = deps.dispatch;
    this.collectAnalytics = deps.collectAnalytics;
    this.health = deps.health ?? new RenderWorkerHealth();
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.ambiguousCooldownMs =
      deps.ambiguousCooldownMs ?? DEFAULT_AMBIGUOUS_COOLDOWN_MS;
    this.analyticsStaleClaimMs =
      deps.analyticsStaleClaimMs ?? DEFAULT_ANALYTICS_STALE_CLAIM_MS;
  }

  async tick(): Promise<boolean> {
    this.health.markTick();
    const now = new Date();
    const nowIso = now.toISOString();

    await this.reclaimStalePublishing(nowIso);

    const due = await this.repository.claimNextDue(nowIso);
    if (due) {
      await this.process(due, "PUBLISH");
      return true;
    }

    const ambiguous = await this.repository.claimNextAmbiguous(
      new Date(now.getTime() - this.ambiguousCooldownMs).toISOString(),
    );
    if (ambiguous) {
      await this.process(ambiguous, "RECONCILE");
      return true;
    }

    const analytics = await this.repository.claimNextAnalytics(
      nowIso,
      new Date(now.getTime() - this.analyticsStaleClaimMs).toISOString(),
    );
    if (analytics) {
      await this.process(analytics, "ANALYTICS");
      return true;
    }

    return false;
  }

  async run(signal?: AbortSignal): Promise<void> {
    this.health.markStarted();
    try {
      while (!signal?.aborted) {
        try {
          const worked = await this.tick();
          if (!worked) await this.sleep(this.pollIntervalMs, signal);
        } catch (error) {
          this.health.markError(
            error instanceof Error ? error.message : "Worker tick failed",
          );
          logEvent("error", "worker.tick_failed", {
            worker: "publishing",
            error: sanitizeError(error),
          });
          await this.sleep(this.pollIntervalMs, signal);
        }
      }
    } finally {
      this.health.markStopped();
    }
  }

  private async reclaimStalePublishing(nowIso: string): Promise<void> {
    try {
      const reclaimed = await this.repository.reclaimStalePublishing(nowIso);
      if (reclaimed > 0) {
        logEvent("warn", "worker.publishing_lease_reclaimed", {
          worker: "publishing",
          reclaimed,
        });
      }
    } catch (error) {
      logEvent("warn", "worker.lease_reclaim_failed", {
        worker: "publishing",
        error: sanitizeError(error),
      });
    }
  }

  private async process(
    publication: PublicationRecord,
    kind: "PUBLISH" | "RECONCILE" | "ANALYTICS",
  ): Promise<void> {
    this.health.markJobStarted(publication.id);
    const stopLeaseRenewal =
      kind === "ANALYTICS"
        ? () => undefined
        : this.startPublicationLeaseRenewal(publication.id);

    try {
      const result =
        kind === "ANALYTICS"
          ? await this.collectAnalytics(publication)
          : await this.dispatch(publication);
      const succeeded =
        kind === "ANALYTICS"
          ? result !== null && result.analyticsErrorCode === null
          : result?.status === "PUBLISHED";
      this.health.markJobFinished(succeeded ? "SUCCEEDED" : "FAILED");
    } catch (error) {
      this.health.markError(
        sanitizeMessage(
          error instanceof Error ? error.message : "Publishing worker tick failed",
        ),
      );
      this.health.markJobFinished("FAILED");
    } finally {
      stopLeaseRenewal();
    }
  }

  private startPublicationLeaseRenewal(publicationId: string): () => void {
    const timer = setInterval(() => {
      void this.repository
        .renewPublishingLease(publicationId, new Date().toISOString())
        .then((renewed) => {
          if (!renewed) {
            logEvent("warn", "worker.lease_lost", {
              worker: "publishing",
              jobId: publicationId,
            });
          }
        })
        .catch((error) => {
          logEvent("warn", "worker.lease_renew_failed", {
            worker: "publishing",
            jobId: publicationId,
            error: sanitizeError(error),
          });
        });
    }, LEASE_RENEW_MS);
    timer.unref?.();
    return () => clearInterval(timer);
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
