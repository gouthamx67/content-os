/**
 * Worker lease contract.
 *
 * A claimed job carries a lease deadline. The worker refreshes the deadline
 * while it is alive (progress writes and an explicit heartbeep), so a lease
 * that runs out proves the previous owner is gone: either the process crashed
 * or its host was suspended. A sweep requeues those jobs instead of leaving
 * them RUNNING forever.
 *
 * The deadline must be comfortably longer than any single blocking step
 * without a refresh (for example one ffmpeg stderr progress gap), and
 * comfortably shorter than an operator's patience for a stuck job.
 */
export const WORKER_LEASE_TTL_MS = 5 * 60_000;

export const WORKER_LEASE_EXPIRED_CODE = "WORKER_LEASE_EXPIRED";

export const WORKER_LEASE_EXPIRED_MESSAGE =
  "The worker holding this job stopped reporting (lease expired); the job was requeued.";

export function workerLeaseExpiry(
  nowIso: string,
  ttlMs: number = WORKER_LEASE_TTL_MS,
): string {
  return new Date(new Date(nowIso).getTime() + ttlMs).toISOString();
}
