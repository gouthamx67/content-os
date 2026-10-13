/**
 * One error shape for every campaign failure.
 *
 * The code is the contract a client branches on; the message is for a human.
 * Readiness is not an error — it is reported as data — so the codes here are the
 * hard refusals: a state transition that is not allowed, a schedule that cannot
 * be satisfied, an artifact that belongs to a different project.
 */
export const CAMPAIGN_ERROR_CODES = [
  "CAMPAIGN_NOT_FOUND",
  "CAMPAIGN_DELIVERABLE_NOT_FOUND",
  "CAMPAIGN_INVALID_INPUT",
  "CAMPAIGN_DELIVERABLE_LIMIT_EXCEEDED",
  "CAMPAIGN_INVALID_LIFECYCLE_TRANSITION",
  "CAMPAIGN_PLAN_REQUIRED",
  "CAMPAIGN_NOT_READY",
  "CAMPAIGN_GROUNDING_MISSING",
  "CAMPAIGN_APPROVAL_REQUIRED",
  "CAMPAIGN_APPROVAL_STALE",
  "CAMPAIGN_REVISION_CONFLICT",
  "CAMPAIGN_CHANNEL_UNSUPPORTED",
  "CAMPAIGN_PLATFORM_UNKNOWN",
  "CAMPAIGN_PLATFORM_NOT_IN_PROJECT",
  "CAMPAIGN_CONTENT_TYPE_MISMATCH",
  "CAMPAIGN_SCHEDULE_INVALID",
  "CAMPAIGN_SCHEDULE_CONFLICT",
  "CAMPAIGN_LAUNCH_KIT_NOT_ASSEMBLED",
  "CAMPAIGN_CROSS_PROJECT_ARTIFACT",
  "CAMPAIGN_ARTIFACT_NOT_FOUND",
  "CAMPAIGN_PROVIDER_UNAVAILABLE",
  "CAMPAIGN_UNSUPPORTED_CLAIM",
] as const;
export type CampaignErrorCode = (typeof CAMPAIGN_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<CampaignErrorCode, number> = {
  CAMPAIGN_NOT_FOUND: 404,
  CAMPAIGN_DELIVERABLE_NOT_FOUND: 404,
  CAMPAIGN_INVALID_INPUT: 400,
  CAMPAIGN_DELIVERABLE_LIMIT_EXCEEDED: 400,
  CAMPAIGN_INVALID_LIFECYCLE_TRANSITION: 409,
  CAMPAIGN_PLAN_REQUIRED: 409,
  CAMPAIGN_NOT_READY: 409,
  CAMPAIGN_GROUNDING_MISSING: 422,
  CAMPAIGN_APPROVAL_REQUIRED: 409,
  CAMPAIGN_APPROVAL_STALE: 409,
  CAMPAIGN_REVISION_CONFLICT: 409,
  CAMPAIGN_CHANNEL_UNSUPPORTED: 422,
  CAMPAIGN_PLATFORM_UNKNOWN: 422,
  CAMPAIGN_PLATFORM_NOT_IN_PROJECT: 422,
  CAMPAIGN_CONTENT_TYPE_MISMATCH: 422,
  CAMPAIGN_SCHEDULE_INVALID: 422,
  CAMPAIGN_SCHEDULE_CONFLICT: 409,
  CAMPAIGN_LAUNCH_KIT_NOT_ASSEMBLED: 409,
  CAMPAIGN_CROSS_PROJECT_ARTIFACT: 403,
  CAMPAIGN_ARTIFACT_NOT_FOUND: 404,
  CAMPAIGN_PROVIDER_UNAVAILABLE: 501,
  CAMPAIGN_UNSUPPORTED_CLAIM: 422,
};

export class CampaignError extends Error {
  readonly code: CampaignErrorCode;
  readonly status: number;
  readonly extras: Record<string, unknown>;

  constructor(
    code: CampaignErrorCode,
    message: string,
    extras: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CampaignError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.extras = extras;
  }
}

export function isCampaignError(error: unknown): error is CampaignError {
  return error instanceof CampaignError;
}
