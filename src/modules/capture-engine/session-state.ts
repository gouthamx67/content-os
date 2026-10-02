import type { CaptureSessionStatus } from "./capture-types";

/**
 * Session lifecycle.
 *
 * DRAFT -> ACTIVE -> REVIEW -> COMPLETED, with CANCELLED reachable from every
 * state that has not yet produced a final result. COMPLETED and CANCELLED are
 * terminal: a completed session's takes are the record of what shipped, and
 * reopening it would mean the manifest no longer describes the session it names.
 *
 * ACTIVE -> REVIEW exists so review can be a state rather than an implicit
 * "started and not finished" reading, and REVIEW -> ACTIVE lets a user go back
 * for another take without completing.
 */
const transitions: Record<CaptureSessionStatus, CaptureSessionStatus[]> = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["REVIEW", "COMPLETED", "CANCELLED"],
  REVIEW: ["ACTIVE", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(
  from: CaptureSessionStatus,
  to: CaptureSessionStatus,
): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(
  from: CaptureSessionStatus,
  to: CaptureSessionStatus,
): void {
  if (!canTransition(from, to)) {
    throw new CaptureTransitionError(from, to);
  }
}

export class CaptureTransitionError extends Error {
  readonly from: CaptureSessionStatus;
  readonly to: CaptureSessionStatus;

  constructor(from: CaptureSessionStatus, to: CaptureSessionStatus) {
    super(`Capture session cannot move from ${from} to ${to}`);
    this.name = "CaptureTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function allowedTransitions(
  from: CaptureSessionStatus,
): readonly CaptureSessionStatus[] {
  return transitions[from];
}
