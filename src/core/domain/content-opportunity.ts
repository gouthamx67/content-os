import type { IntentSubjectType } from "./content-intent";
import type { OpportunityTrigger } from "./opportunity-registry";

/**
 * CP12 produces advisory content opportunities. An opportunity is not content:
 * nothing here has been written, rendered or scheduled. It is a grounded
 * suggestion that a user may take up as a CP09 intent or dismiss, which is why
 * the internal `priorityScore` never leaves the service layer.
 */

export const OPPORTUNITY_CHANNELS = [
  "VIDEO",
  "IMAGE",
  "TEXT",
  "AUDIO",
  "CAMPAIGN",
] as const;
export type OpportunityChannel = (typeof OPPORTUNITY_CHANNELS)[number];

export const OPPORTUNITY_STATUSES = [
  "ACTIVE",
  "DISMISSED",
  "SELECTED",
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export type { OpportunityTrigger };

/**
 * Three different kinds of id travel with an opportunity and must never be
 * confused. `sourceIds` are real `Source` document ids and are the only ones
 * allowed to become a CP09 intent's `sourceIds`. `evidenceIds` are the CP06
 * graph's own evidence rows. `entityIds` are intelligence entities referenced
 * by the subject (a workflow's features, say), which are subjects rather than
 * sources. The subject itself is carried by `subjectType`/`subjectId`.
 */
export type OpportunityEvidence = {
  /** Ids of real Source documents the subject was grounded in. */
  sourceIds: string[];

  /** Evidence ids backing those entities, when the graph has any. */
  evidenceIds: string[];

  /** Related intelligence entity ids, e.g. the features a workflow steps through. */
  entityIds: string[];
};

export type ContentOpportunity = {
  id: string;
  projectId: string;

  /**
   * Stable identity of the thing being recommended: content type, subject and
   * platform. Present from generation, before the row exists, so that anything
   * downstream of `generate()` — a provider, a model prompt, a merge — has a
   * durable handle to address an opportunity by. `id` is empty until the row is
   * persisted; `key` never is.
   */
  key: string;

  /** Registry template that proposed this, e.g. `workflow_carousel`. */
  templateId: string;

  /** CP09 content type this maps to, e.g. `video.product_demo`. */
  contentTypeId: string;

  channel: OpportunityChannel;

  platform: string;

  /**
   * Identity of the *thing* being recommended, not of the record. Stable across
   * refreshes so a dismissal or a selection survives regeneration.
   */
  subjectType: IntentSubjectType;
  subjectId: string | null;
  subjectLabel: string;

  title: string;

  rationale: string;

  /** Human-readable reasons, derived from the score factors. */
  reasons: string[];

  /**
   * What is thin about the grounding. A weak-but-honest opportunity is allowed;
   * an opportunity that pretends its gaps do not exist is not.
   */
  missingInputs: string[];

  /** Internal ranking only. Never serialized to the API. */
  priorityScore: number;

  evidence: OpportunityEvidence;

  status: OpportunityStatus;

  /** Set when the user takes the opportunity up as a CP09 intent. */
  selectedIntentId: string | null;

  dismissedAt: string | null;

  createdAt: string;
  updatedAt: string;
};

/**
 * What the API returns. The score is dropped here rather than at each route so
 * no future endpoint can leak it by forgetting.
 *
 * `isProgress` is a reading of current project state, not a property of the
 * row: whether existing content already covers this subject and content type
 * changes every time an intent is created or a storyboard ships, while the row
 * does not. It is therefore computed on the way out rather than stored, so the
 * API can never serve a stale claim.
 */
export type ContentOpportunityView = Omit<
  ContentOpportunity,
  "priorityScore" | "projectId"
> & {
  /** True when existing content already covers this subject + content type. */
  isProgress: boolean;
};

export function toOpportunityView(
  opportunity: ContentOpportunity,
  isProgress: boolean,
): ContentOpportunityView {
  // Written as explicit deletes rather than a rest-destructure so the two names
  // that must not survive stay visible at the point of removal. A rest-destructure
  // reads the same to a reader who does not know the intent, and a future field
  // added to the type would flow into the view silently either way — which is
  // correct, since the view is the default.
  const view: Record<string, unknown> = { ...opportunity, isProgress };
  delete view.priorityScore;
  delete view.projectId;
  return view as ContentOpportunityView;
}

export const OPPORTUNITY_ERROR_CODES = [
  "RECOMMENDATION_INVALID_INPUT",
  "RECOMMENDATION_NOT_FOUND",
  "RECOMMENDATION_KEY_COLLISION",
] as const;
export type RecommendationErrorCode = (typeof OPPORTUNITY_ERROR_CODES)[number];

export class RecommendationError extends Error {
  override readonly name = "RecommendationError";

  constructor(
    readonly code: RecommendationErrorCode,
    message: string,
  ) {
    super(message);
  }
}
