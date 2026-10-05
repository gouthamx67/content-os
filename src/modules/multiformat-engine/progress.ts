import type {
  AdaptationBatchRecord,
  AdaptationBatchStatus,
  AdaptationJobRecord,
} from "./domain/types";

/** A job that will never run again. */
export const TERMINAL_JOB_STATUSES = ["SUCCEEDED", "FAILED", "CANCELLED"] as const;

/** A job that has been asked to stop but has not finished doing so. */
export function isTerminalJobStatus(status: string): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

/**
 * What the whole batch is, given every one of its jobs.
 *
 * The batch never has its own opinion: it is derived, so a job that fails halfway
 * through can never leave the batch claiming success. Three distinctions matter to
 * a reader:
 *
 * - everything succeeded, or nothing succeeded-and-something-still-works, is
 *   `PARTIAL` rather than `FAILED`, because a partly adapted campaign is a real
 *   outcome with usable parts;
 * - a cancellation that has not finished propagating is `CANCEL_REQUESTED`, not
 *   `CANCELLED`, so the UI can still say work is stopping;
 * - a batch whose jobs are all still queued is `QUEUED`, not `RUNNING`.
 */
export function deriveBatchStatus(
  jobs: readonly AdaptationJobRecord[],
): AdaptationBatchStatus {
  if (jobs.length === 0) return "QUEUED";

  const statuses = jobs.map((job) => job.status);
  const succeeded = statuses.filter((status) => status === "SUCCEEDED").length;
  const cancelled = statuses.filter((status) => status === "CANCELLED").length;
  const failed = statuses.filter((status) => status === "FAILED").length;
  const cancelRequested = statuses.filter(
    (status) => status === "CANCEL_REQUESTED",
  ).length;
  const waiting = statuses.filter(
    (status) => status === "QUEUED" || status === "RUNNING" || status === "WAITING_RENDER",
  ).length;

  if (cancelRequested > 0) return "CANCEL_REQUESTED";
  if (waiting > 0) {
    return statuses.every((status) => status === "QUEUED") ? "QUEUED" : "RUNNING";
  }

  if (succeeded === statuses.length) return "SUCCEEDED";
  if (cancelled === statuses.length) return "CANCELLED";
  if (failed === statuses.length) return "FAILED";
  if (succeeded > 0) return "PARTIAL";

  return "CANCELLED";
}

/**
 * Progress as completed work over requested work.
 *
 * A job parked on a render is not done, so it does not count — which means a
 * batch that is waiting on a video honestly reads as short of 100%.
 */
export function deriveBatchProgress(
  jobs: readonly AdaptationJobRecord[],
): number {
  if (jobs.length === 0) return 0;

  const finished = jobs.filter((job) => isTerminalJobStatus(job.status)).length;
  return Math.round((finished / jobs.length) * 100);
}

export function deriveBatchFinishedAt(
  jobs: readonly AdaptationJobRecord[],
): string | null {
  if (jobs.length === 0) return null;
  if (!jobs.every((job) => isTerminalJobStatus(job.status))) return null;

  const stamps = jobs
    .map((job) => job.finishedAt)
    .filter((stamp): stamp is string => typeof stamp === "string");

  if (stamps.length !== jobs.length) return null;

  return stamps.reduce((latest, stamp) =>
    stamp > latest ? stamp : latest,
  );
}