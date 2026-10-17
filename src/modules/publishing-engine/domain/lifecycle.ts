import type { PublicationStatus } from "./types";

/**
 * The publication state machine, one authoritative table.
 *
 * Repositories only ever move a row through a transition listed here, and the
 * worker's claims are the transitions into PUBLISHING. Anything else is a
 * programming error surfaced as PUBLISHING_INVALID_TRANSITION rather than a
 * silently inconsistent row.
 */
export const PUBLICATION_TRANSITIONS: Record<
  PublicationStatus,
  readonly PublicationStatus[]
> = {
  DRAFT: ["READY", "DRAFT", "CANCELLED"],
  READY: ["READY", "QUEUED", "SCHEDULED", "DRAFT", "CANCELLED", "STALE"],
  SCHEDULED: ["READY", "QUEUED", "PUBLISHING", "CANCELLED", "STALE"],
  QUEUED: ["PUBLISHING", "CANCELLED", "STALE"],
  PUBLISHING: ["PUBLISHED", "FAILED", "AMBIGUOUS", "AUTH_REQUIRED", "STALE"],
  PUBLISHED: [],
  FAILED: ["READY", "QUEUED", "CANCELLED"],
  AMBIGUOUS: ["READY", "QUEUED", "PUBLISHING", "FAILED", "PUBLISHED", "CANCELLED"],
  AUTH_REQUIRED: ["READY", "QUEUED", "CANCELLED"],
  STALE: ["READY", "DRAFT", "CANCELLED"],
  CANCELLED: [],
};

export function canTransition(
  from: PublicationStatus,
  to: PublicationStatus,
): boolean {
  return PUBLICATION_TRANSITIONS[from].includes(to);
}

/** Statuses a user may (re)validate; each moves to READY or back to DRAFT. */
export const VALIDATABLE_STATUSES: readonly PublicationStatus[] = [
  "DRAFT",
  "READY",
  "STALE",
  "FAILED",
  "AUTH_REQUIRED",
];

/** Statuses a user may cancel. PUBLISHING is deliberately not cancellable. */
export const CANCELLABLE_STATUSES: readonly PublicationStatus[] = [
  "DRAFT",
  "READY",
  "SCHEDULED",
  "QUEUED",
  "FAILED",
  "AMBIGUOUS",
  "AUTH_REQUIRED",
  "STALE",
];

/**
 * Timezone names PostgreSQL and `Intl` both accept. The column stores the
 * caller's IANA name; an invalid one is a 400, not a silent UTC fallback,
 * because a post scheduled for the wrong zone is a real-world mistake.
 */
export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function isFutureInstant(
  scheduledFor: string,
  nowIso: string,
  minimumLeadMs = 30_000,
): boolean {
  const target = Date.parse(scheduledFor);
  if (!Number.isFinite(target)) return false;
  return target > Date.parse(nowIso) + minimumLeadMs;
}
