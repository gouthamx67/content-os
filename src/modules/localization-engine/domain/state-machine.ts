import { LocalizationError } from "../errors";
import type { LocalizationStatus } from "./types";

/**
 * The one legal map of localization states.
 *
 * A job moves forward through review and can be sent back for changes, marked
 * stale when its source revision moves, or retried after a provider failure.
 * Everything not listed is refused, so a hand-crafted request cannot skip
 * review and jump straight to `APPLIED`.
 */
const TRANSITIONS: Record<
  LocalizationStatus,
  readonly LocalizationStatus[]
> = {
  DRAFT: ["READY_TO_LOCALIZE", "STALE", "FAILED"],
  READY_TO_LOCALIZE: ["PROCESSING", "STALE", "FAILED"],
  PROCESSING: ["NEEDS_REVIEW", "FAILED", "STALE"],
  NEEDS_REVIEW: ["CHANGES_REQUESTED", "APPROVED", "PROCESSING", "STALE", "FAILED"],
  CHANGES_REQUESTED: ["PROCESSING", "STALE", "FAILED"],
  APPROVED: ["APPLIED", "CHANGES_REQUESTED", "PROCESSING", "STALE", "FAILED"],
  APPLIED: ["STALE"],
  STALE: ["PROCESSING", "READY_TO_LOCALIZE", "FAILED"],
  FAILED: ["PROCESSING", "STALE"],
};

/** States whose segments may still be edited by a reviewer. */
const EDITABLE: readonly LocalizationStatus[] = [
  "DRAFT",
  "READY_TO_LOCALIZE",
  "NEEDS_REVIEW",
  "CHANGES_REQUESTED",
];

export function canTransition(
  from: LocalizationStatus,
  to: LocalizationStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(
  from: LocalizationStatus,
  to: LocalizationStatus,
): void {
  if (!canTransition(from, to)) {
    throw new LocalizationError(
      "LOCALIZATION_INVALID_TRANSITION",
      `Cannot move a localization from ${from} to ${to}`,
      { from, to },
    );
  }
}

export function isEditable(status: LocalizationStatus): boolean {
  return EDITABLE.includes(status);
}

export function assertEditable(status: LocalizationStatus): void {
  if (!isEditable(status)) {
    throw new LocalizationError(
      "LOCALIZATION_INVALID_TRANSITION",
      `A localization in ${status} cannot be edited`,
      { status },
    );
  }
}
