/**
 * The HTTP edge of the recommendation checkpoint.
 *
 * Recommendations are advisory, so the shape of this API is mostly about what a
 * client is *not* allowed to do. A caller names no features, no subjects, no
 * scores and no evidence: the whole point of the engine is that the suggestion
 * came from the project rather than from the request. The only writable field on
 * the whole resource is the user's own decision about it.
 *
 * Two leaks this file exists to prevent:
 *
 * The ranking score. `serializeOpportunity` is the only way an opportunity
 * reaches a response, and it drops `priorityScore` and `projectId`. The domain's
 * `toOpportunityView` already strips them; doing it again here means a future
 * route that reaches for the internal object still cannot leak it.
 *
 * Self-directed generation. There is no body that can name a feature, a claim or
 * a subject to recommend. Generate takes no body at all, so the set of
 * recommendations a project has is decided by the project's data and by nothing
 * else.
 */

import {
  OPPORTUNITY_CHANNELS,
  OPPORTUNITY_STATUSES,
  RecommendationError,
  type ContentOpportunityView,
  type OpportunityChannel,
  type OpportunityStatus,
} from "../core/domain/content-opportunity";
import { getContentType } from "../core/domain/content-type";
import { getPlatform } from "../core/domain/platform";
import { recommendableContentTypeIds } from "../core/domain/opportunity-registry";
import { HttpError, jsonError, wrapHttpError } from "./http";

/**
 * 404 for anything the project cannot see, including an id that exists in
 * another project: an authorization failure would confirm the id is real.
 * 422 for a decision the domain does not have, 409 for one the current state
 * forbids.
 */
const RECOMMENDATION_ERROR_STATUS: Readonly<Record<string, number>> = {
  RECOMMENDATION_INVALID_INPUT: 422,
  RECOMMENDATION_NOT_FOUND: 404,
  // A recommendation id from another project is reported as missing rather than
  // forbidden, because a 403 would confirm the id exists somewhere.
  RECOMMENDATION_SCOPE_VIOLATION: 404,
  RECOMMENDATION_NOT_GENERATED: 409,
  RECOMMENDATION_ALREADY_GENERATED: 409,
};

export function wrapRecommendationHttpError(error: unknown): Response {
  if (error instanceof RecommendationError) {
    return jsonError(
      RECOMMENDATION_ERROR_STATUS[error.code] ?? 500,
      error.message,
      { code: error.code },
    );
  }
  return wrapHttpError(error);
}

export function isOpportunityStatus(value: unknown): value is OpportunityStatus {
  return (
    typeof value === "string" &&
    (OPPORTUNITY_STATUSES as readonly string[]).includes(value)
  );
}

export function isOpportunityChannel(value: unknown): value is OpportunityChannel {
  return (
    typeof value === "string" &&
    (OPPORTUNITY_CHANNELS as readonly string[]).includes(value)
  );
}

/**
 * The vocabularies the panel needs to render and label a card. Sent with the
 * list rather than hard-coded in the client, because the channel and platform
 * vocabularies live in the domain and a copy would drift the first time either
 * grows an entry.
 */
export function recommendationRegistry() {
  return {
    channels: [...OPPORTUNITY_CHANNELS],
    statuses: [...OPPORTUNITY_STATUSES],
    contentTypes: listRecommendedContentTypes(),
  };
}

function listRecommendedContentTypes() {
  const types: Array<{
    id: string;
    name: string;
    channel: string;
    platforms: string[];
  }> = [];

  // Derived from the template registry rather than listed here, so a template
  // that names a new content type shows up in the panel without this file
  // knowing anything about it.
  for (const id of recommendableContentTypeIds()) {
    const definition = getContentType(id);
    if (!definition) continue;
    types.push({
      id: definition.id,
      name: definition.name,
      channel: definition.channel,
      platforms: [...definition.supportedPlatforms],
    });
  }

  return types;
}

export type SerializedOpportunity = ContentOpportunityView;

export function serializeOpportunity(
  opportunity: ContentOpportunityView,
): SerializedOpportunity {
  // The domain's view has already dropped `priorityScore` and `projectId`; this
  // copy makes the guarantee visible at the boundary rather than assumed from a
  // caller three files away, and detaches the arrays so a response cannot be
  // mutated through the object the service returned.
  return {
    ...opportunity,
    reasons: [...opportunity.reasons],
    missingInputs: [...opportunity.missingInputs],
    evidence: {
      sourceIds: [...opportunity.evidence.sourceIds],
      evidenceIds: [...opportunity.evidence.evidenceIds],
      entityIds: [...opportunity.evidence.entityIds],
    },
  };
}

export function serializeOpportunities(
  opportunities: readonly ContentOpportunityView[],
): SerializedOpportunity[] {
  return opportunities.map(serializeOpportunity);
}

/**
 * The only writable field on the whole resource: the user's decision.
 *
 * Everything else — the title, the rationale, the reasons, the evidence, the
 * subject, the score — is refused by name. A client that could edit the rationale
 * could make the server display a claim the product graph does not contain, which
 * is the one failure this feature is not allowed to have.
 */
const WRITABLE_FIELDS = ["status"] as const;

export function parseUpdateOpportunityRequest(
  body: unknown,
): { status: OpportunityStatus } {
  const record = requireObject(body);

  const rejected = Object.keys(record).filter(
    (key) => !(WRITABLE_FIELDS as readonly string[]).includes(key),
  );
  if (rejected.length > 0) {
    throw new HttpError(
      400,
      `Recommendations are server-derived and only their status is yours. Remove ${rejected.join(", ")}.`,
    );
  }

  if (!isOpportunityStatus(record.status)) {
    throw new HttpError(
      422,
      `status must be one of ${OPPORTUNITY_STATUSES.join(", ")}`,
    );
  }

  // A client may restore a dismissed item, but it may not claim to have taken
  // one up: selection creates a real intent, and only the selection route can.
  if (record.status === "SELECTED") {
    throw new HttpError(
      409,
      "Use the select route to take a recommendation up: it creates the content intent.",
    );
  }

  return { status: record.status };
}

/** Generate and refresh take no body, so a client cannot steer the outcome. */
export function rejectGenerateBody(body: unknown): void {
  const record = requireObject(body);
  const keys = Object.keys(record);
  if (keys.length > 0) {
    throw new HttpError(
      400,
      `Recommendations are derived from the project, not from a request. Remove ${keys.join(", ")}.`,
    );
  }
}

export function parseStatusFilter(value: string | null): OpportunityStatus | undefined {
  if (!value) return undefined;
  const status = value.toUpperCase();
  if (!isOpportunityStatus(status)) {
    throw new HttpError(400, `Unknown recommendation status "${value}"`);
  }
  return status;
}

/** Platform names for the card subtitle, resolved server-side from the registry. */
export function platformName(platformId: string): string {
  return getPlatform(platformId)?.name ?? platformId;
}

function requireObject(value: unknown, label = "body"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, `${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}
