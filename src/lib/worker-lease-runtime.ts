import { logEvent, sanitizeError } from "./observability";

/**
 * Shared lease plumbing for queue workers: a periodic lease refresh bound to
 * one job, and the recovery sweep every worker runs before claiming new work.
 *
 * Kept as free functions so the five workers (render, audio, image, writing,
 * adaptation) share one implementation and one logging vocabulary.
 */
export type LeaseSupportingRepository = {
  renewLease(jobId: string, nowIso: string): Promise<boolean>;
  reclaimExpiredLeases(nowIso: string): Promise<{
    cancelled: number;
    requeued: number;
  }>;
};

export const LEASE_RENEW_MS = 60_000;

/** Starts refreshing the lease every minute; call the returned function to stop. */
export function startLeaseRenewal(
  repository: LeaseSupportingRepository,
  worker: string,
  jobId: string,
): () => void {
  const timer = setInterval(() => {
    void repository
      .renewLease(jobId, new Date().toISOString())
      .then((renewed) => {
        if (!renewed) {
          logEvent("warn", "worker.lease_lost", { worker, jobId });
        }
      })
      .catch((error) => {
        logEvent("warn", "worker.lease_renew_failed", {
          worker,
          jobId,
          error: sanitizeError(error),
        });
      });
  }, LEASE_RENEW_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

export async function reclaimAbandonedWork(
  repository: LeaseSupportingRepository,
  worker: string,
): Promise<void> {
  try {
    const reclaimed = await repository.reclaimExpiredLeases(
      new Date().toISOString(),
    );
    if (reclaimed.cancelled > 0 || reclaimed.requeued > 0) {
      logEvent("warn", "worker.lease_reclaimed", {
        worker,
        cancelled: reclaimed.cancelled,
        requeued: reclaimed.requeued,
      });
    }
  } catch (error) {
    logEvent("warn", "worker.lease_reclaim_failed", {
      worker,
      error: sanitizeError(error),
    });
  }
}
