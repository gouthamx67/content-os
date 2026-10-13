import type { CampaignRevisionKind, CampaignStatus } from "./types";
import { throwFormatError } from "./channels";

/**
 * The lifecycle as an explicit graph.
 *
 * Approval is deliberately the only edge into `APPROVED`, and every edge that
 * changes what was approved leaves it. That is the whole reason the graph exists:
 * a campaign cannot be "approved and edited" at the same time, and the type of a
 * transition is checked rather than inferred from whatever fields happen to be
 * set.
 */
export type CampaignAction =
  | "PLAN"
  | "SUBMIT"
  | "APPROVE"
  | "RETURN"
  | "SCHEDULE"
  | "ASSEMBLE"
  | "EDIT"
  | "ARCHIVE";

const TRANSITIONS: Record<CampaignStatus, CampaignAction[]> = {
  DRAFT: ["PLAN", "EDIT", "ARCHIVE"],
  PLANNED: ["PLAN", "SUBMIT", "SCHEDULE", "EDIT", "ASSEMBLE", "ARCHIVE"],
  IN_REVIEW: ["APPROVE", "RETURN", "ARCHIVE"],
  APPROVED: ["SCHEDULE", "ASSEMBLE", "EDIT", "ARCHIVE"],
  ARCHIVED: [],
};

const RESULT: Partial<Record<CampaignAction, CampaignStatus>> = {
  PLAN: "PLANNED",
  SUBMIT: "IN_REVIEW",
  APPROVE: "APPROVED",
  RETURN: "PLANNED",
};

export function allowedActions(status: CampaignStatus): CampaignAction[] {
  return [...TRANSITIONS[status]];
}

export function canPerform(
  status: CampaignStatus,
  action: CampaignAction,
): boolean {
  return TRANSITIONS[status].includes(action);
}

/**
 * Returns the resulting status, or throws. `EDIT`, `SCHEDULE`, `ASSEMBLE` and
 * `ARCHIVE` are checked for legality but leave the status to the caller, because
 * "editing an approved campaign returns it to PLANNED" is a decision the service
 * makes together with clearing the approval hash.
 */
export function assertAction(
  status: CampaignStatus,
  action: CampaignAction,
): CampaignStatus {
  if (!canPerform(status, action)) {
    throwFormatError(
      "CAMPAIGN_INVALID_LIFECYCLE_TRANSITION",
      `Cannot ${action.toLowerCase()} a campaign in ${status}`,
    );
  }
  if (action === "ARCHIVE") return "ARCHIVED";
  return RESULT[action] ?? status;
}

/**
 * Which revision kinds change what an approval vouched for. Assembly, review and
 * archival intentionally do not: assembling a launch kit reads the campaign, it
 * does not alter the brief a person signed off on.
 */
const MATERIAL_KINDS: ReadonlySet<CampaignRevisionKind> = new Set([
  "BRIEF_UPDATED",
  "STRATEGY_SET",
  "PLAN_SET",
  "DELIVERABLE_ADDED",
  "DELIVERABLE_UPDATED",
  "DELIVERABLE_REMOVED",
  "SCHEDULED",
]);

export function isMaterialChange(kind: CampaignRevisionKind): boolean {
  return MATERIAL_KINDS.has(kind);
}

/**
 * A material change to an approved campaign invalidates the approval: it returns
 * to `PLANNED` and the hash/approver are cleared. A change to a campaign that is
 * not approved is harmless and returns the status unchanged.
 */
export function statusAfterChange(
  status: CampaignStatus,
  material: boolean,
): CampaignStatus {
  if (status === "APPROVED" && material) return "PLANNED";
  return status;
}
