/**
 * A creative direction is the concept for one piece of content: the angle, the
 * thesis, the hook, and how it would be shown and proven. It stops where a
 * storyboard starts - there are no scenes, timings, or shots here, because
 * deciding what to say is a different decision from deciding how to film it.
 *
 * Dates are ISO strings, matching the rest of the domain, not `Date`.
 */

export const CREATIVE_MODES = ["GUIDED", "BALANCED", "WILD"] as const;
export type CreativeMode = (typeof CREATIVE_MODES)[number];

export const CREATIVE_DIRECTION_STATUSES = [
  "DRAFT",
  "SELECTED",
  "REJECTED",
  "ARCHIVED",
] as const;
export type CreativeDirectionStatus = (typeof CREATIVE_DIRECTION_STATUSES)[number];

export const CREATIVE_ANGLES = [
  "PROBLEM_SOLUTION",
  "PRODUCT_FIRST",
  "WORKFLOW",
  "TRANSFORMATION",
  "FOUNDER",
  "TECHNICAL",
  "SOCIAL",
  "EMOTIONAL",
  "EDUCATIONAL",
  "BEFORE_AFTER",
  "DEMO",
  "CUSTOM",
] as const;
export type CreativeAngle = (typeof CREATIVE_ANGLES)[number];

export function isCreativeMode(value: unknown): value is CreativeMode {
  return CREATIVE_MODES.includes(value as CreativeMode);
}

export function isCreativeAngle(value: unknown): value is CreativeAngle {
  return CREATIVE_ANGLES.includes(value as CreativeAngle);
}

export function isCreativeDirectionStatus(
  value: unknown,
): value is CreativeDirectionStatus {
  return CREATIVE_DIRECTION_STATUSES.includes(
    value as CreativeDirectionStatus,
  );
}

export interface CreativeHook {
  /** The idea the piece leads with, in one sentence. */
  statement: string;
  /**
   * How the opening earns attention. Kept as a declared mechanism rather than
   * an open prompt so a mode can forbid it: Guided work cannot open on an
   * experimental mechanism even if the model produces one.
   */
  mechanism: string;
  /** The thing the viewer is meant to feel in the first beat. */
  emotionalTrigger: string;
}

export interface CreativeVisualStrategy {
  /** A look, a plan for shots and motion, in words only. */
  approach: string;
  /** Why this look serves the thesis. */
  rationale: string;
  /**
   * The moments the product should be seen doing something. Empty is honest
   * when there is no real product UI to show, which is exactly what Guided mode
   * refuses to accept.
   */
  productMoments: string[];
  /**
   * Ids of the project's real assets this look depends on, so a direction that
   * leans on a screen nobody captured is caught before it is shown to anyone.
   */
  assetIds: string[];
}

export interface CreativeProofStrategy {
  /**
   * Ids of CP06 claims this direction rests on, never claim text. A claim the
   * intelligence graph does not hold cannot be proven, so the text is looked up
   * rather than accepted - a model cannot assert a benefit by spelling it out
   * here.
   */
  claimIds: string[];
  /** Ids of CP06 evidence backing those claims. */
  evidenceIds: string[];
  /** How each claim would be shown, not what would be claimed. */
  proofPoints: string[];
}

export interface CreativeDirectionDraft {
  name: string;
  angle: CreativeAngle;
  /** The one claim of the piece: what this content argues. */
  thesis: string;
  hook: CreativeHook;
  /** Who this is for and what they care about. */
  audienceAngle: string;
  /** The feeling being engineered, named plainly. */
  emotionalAngle: string;
  narrativeSummary: string;
  visualStrategy: CreativeVisualStrategy;
  proofStrategy: CreativeProofStrategy;
  /** How the brand sounds, drawn from the brand execution profile. */
  voiceDirection: string;
  musicDirection: string;
  soundDirection: string;
  /** The ask, when the intent called for one. */
  cta: string | null;
  /** Why this direction suits this project. Shown to the user, so it has to be honest. */
  rationale: string;
}

export interface CreativeDirection extends CreativeDirectionDraft {
  id: string;
  projectId: string;
  intentId: string;
  mode: CreativeMode;
  status: CreativeDirectionStatus;
  /**
   * 1-100 fitness, computed from the context. Deliberately not shown as a
   * verdict: a score invites "the AI says this one is the best", which is a
   * claim this layer cannot make.
   */
  strengthScore: number;
  /**
   * Every run is a group of directions, so regenerating adds options instead of
   * replacing the ones a user may already be reading or has edited.
   */
  creativeRunId: string;
  /** True once a human has changed it. Regeneration must not overwrite these. */
  editedByUser: boolean;
  /** The brand and intelligence versions this was built against. */
  brandVersion: number | null;
  intelligenceVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateCreativeDirectionInput = Omit<
  CreativeDirection,
  "id" | "createdAt" | "updatedAt"
> & { id?: string; createdAt?: string; updatedAt?: string };

export type UpdateCreativeDirectionInput = Partial<
  Pick<CreativeDirection, "name" | "thesis" | "hook" | "audienceAngle" | "emotionalAngle" | "narrativeSummary" | "visualStrategy" | "proofStrategy" | "voiceDirection" | "musicDirection" | "soundDirection" | "cta" | "status" | "rationale">
> & { updatedAt?: string };

export const CREATIVE_ERROR_CODES = [
  "CREATIVE_INTENT_NOT_FOUND",
  "CREATIVE_INTENT_NOT_RESOLVED",
  "CREATIVE_DIRECTION_NOT_FOUND",
  "CREATIVE_MODE_REQUIRED",
  "CREATIVE_DIRECTION_INVALID",
  "CREATIVE_DIRECTION_FAILED",
  "CREATIVE_INVALID_OUTPUT",
  "CREATIVE_CLAIM_UNVERIFIED",
  "CREATIVE_UNKNOWN_ASSET",
  "CREATIVE_UNKNOWN_EVIDENCE",
  "CREATIVE_UNKNOWN_CLAIM",
  "CREATIVE_MODE_CONFLICT",
  "CREATIVE_INSUFFICIENT_CONTEXT",
] as const;
export type CreativeErrorCode = (typeof CREATIVE_ERROR_CODES)[number];

export class CreativeError extends Error {
  constructor(
    readonly code: CreativeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CreativeError";
  }
}
