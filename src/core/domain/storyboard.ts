/**
 * A storyboard is the plan for one piece of content: the scenes, the shots inside
 * them, the text that appears, the narration to be written, and the exact time
 * each of those occupies. It is what a creative direction becomes once someone
 * has to actually make it.
 *
 * Two things are deliberately absent, because they are later checkpoints and
 * pretending to hold them here would make this plan look finished when it is
 * not: there are no media files, and there is no rendered output. A scene says
 * `captureMode: "BROWSER"` and where to go; nothing here opens a browser, records
 * a frame, or writes an audio file.
 *
 * Every timing is milliseconds from the start of the piece, and the timeline is
 * contiguous: a plan with a gap in it cannot be handed to an editor or a
 * renderer without somebody deciding what belongs in the gap. That invariant is
 * what the validator checks first and the timeline builder guarantees.
 *
 * Dates are ISO strings, matching the rest of the domain, not `Date`.
 */

export const STORYBOARD_STATUSES = [
  "DRAFT",
  "READY",
  "SELECTED",
  "LOCKED",
  "ARCHIVED",
] as const;
export type StoryboardStatus = (typeof STORYBOARD_STATUSES)[number];

export function isStoryboardStatus(value: unknown): value is StoryboardStatus {
  return STORYBOARD_STATUSES.includes(value as StoryboardStatus);
}

export const STORYBOARD_SCENE_TYPES = [
  "HOOK",
  "PROBLEM",
  "REVEAL",
  "PRODUCT_DEMO",
  "WORKFLOW",
  "FEATURE",
  "TRANSFORMATION",
  "PROOF",
  "SOCIAL_PROOF",
  "CTA",
  "TRANSITION",
  "CUSTOM",
] as const;
export type StoryboardSceneType = (typeof STORYBOARD_SCENE_TYPES)[number];

export function isStoryboardSceneType(
  value: unknown,
): value is StoryboardSceneType {
  return STORYBOARD_SCENE_TYPES.includes(value as StoryboardSceneType);
}

export const STORYBOARD_VISUAL_TYPES = [
  "PRODUCT_UI",
  "BROWSER",
  "SCREEN_CAPTURE",
  "IMAGE",
  "VIDEO",
  "LOGO",
  "TEXT",
  "BRAND",
  "SOLID",
  "CUSTOM",
] as const;
export type StoryboardVisualType = (typeof STORYBOARD_VISUAL_TYPES)[number];

export function isStoryboardVisualType(
  value: unknown,
): value is StoryboardVisualType {
  return STORYBOARD_VISUAL_TYPES.includes(value as StoryboardVisualType);
}

export const STORYBOARD_CAPTURE_MODES = [
  "NONE",
  "BROWSER",
  "SCREEN",
  "ASSET",
  "REMOTE_MEDIA",
] as const;
export type StoryboardCaptureMode = (typeof STORYBOARD_CAPTURE_MODES)[number];

export function isStoryboardCaptureMode(
  value: unknown,
): value is StoryboardCaptureMode {
  return STORYBOARD_CAPTURE_MODES.includes(value as StoryboardCaptureMode);
}

export const STORYBOARD_TRANSITION_TYPES = [
  "CUT",
  "FADE",
  "DISSOLVE",
  "SLIDE",
  "ZOOM",
  "MATCH_CUT",
  "CUSTOM",
] as const;
export type StoryboardTransitionType =
  (typeof STORYBOARD_TRANSITION_TYPES)[number];

export function isStoryboardTransitionType(
  value: unknown,
): value is StoryboardTransitionType {
  return STORYBOARD_TRANSITION_TYPES.includes(
    value as StoryboardTransitionType,
  );
}

/**
 * What a piece of on-screen text is for. The role is not decoration: it decides
 * how long the text can stay up and whether a scene needs a claim behind it, so
 * it is stored rather than inferred from the copy at render time.
 */
export const STORYBOARD_TEXT_ROLES = [
  "HEADLINE",
  "CAPTION",
  "LABEL",
  "FEATURE_CALLOUT",
  "CTA",
] as const;
export type StoryboardTextRole = (typeof STORYBOARD_TEXT_ROLES)[number];

export function isStoryboardTextRole(value: unknown): value is StoryboardTextRole {
  return STORYBOARD_TEXT_ROLES.includes(value as StoryboardTextRole);
}

export const STORYBOARD_TEXT_POSITIONS = [
  "TOP",
  "CENTER",
  "BOTTOM",
  "LOWER_THIRD",
  "FULL_FRAME",
] as const;
export type StoryboardTextPosition =
  (typeof STORYBOARD_TEXT_POSITIONS)[number];

export function isStoryboardTextPosition(
  value: unknown,
): value is StoryboardTextPosition {
  return STORYBOARD_TEXT_POSITIONS.includes(
    value as StoryboardTextPosition,
  );
}

export const STORYBOARD_TEXT_EMPHASIS = ["NORMAL", "BOLD", "ACCENT"] as const;
export type StoryboardTextEmphasis = (typeof STORYBOARD_TEXT_EMPHASIS)[number];

export function isStoryboardTextEmphasis(
  value: unknown,
): value is StoryboardTextEmphasis {
  return STORYBOARD_TEXT_EMPHASIS.includes(value as StoryboardTextEmphasis);
}

/**
 * What a shot has to be captured from, and by what later job.
 *
 * A capture requirement is a note to a future step, never an instruction to act
 * now. `mode: "BROWSER"` with a `target` says "drive this page and show this" -
 * the page, the element, and the workflow step if there is one. It does not
 * mean this checkpoint knows how. Keeping it structured is the point: a plan
 * that only said "record a demo" could not be checked against the project, and a
 * storyboard whose references cannot be checked is a document, not a plan.
 */
export interface StoryboardCaptureRequirement {
  mode: StoryboardCaptureMode;
  /**
   * The thing to capture, named specifically enough for a later job to act on:
   * a page and control, a screen, or the file to use. Required whenever the mode
   * is anything other than `NONE`.
   */
  target: string;
  /** CP06 workflow this shot demonstrates, when it demonstrates one. */
  workflowId: string | null;
  /** CP06 feature this shot shows, when it shows one. */
  featureId: string | null;
  /** CP07 session to replay or extend, when one already exists. */
  browserSessionId: string | null;
  /** A trace within that session, when the shot needs a specific step. */
  browserTraceId: string | null;
}

/**
 * One shot's worth of capturing, resolved to a scene.
 *
 * A capture requirement hangs off a shot, but the work lands on a beat: this is
 * the queue a later checkpoint actually reads. Naming it separately keeps the
 * scene id attached, so a capture job cannot survive a reorder pointing at a beat
 * that no longer exists.
 */
export interface StoryboardCaptureTarget {
  sceneId: string;
  mode: StoryboardCaptureMode;
  target: string;
  workflowId: string | null;
}

export interface StoryboardShot {
  id: string;
  /** What happens on screen, in one readable line. */
  description: string;
  visualType: StoryboardVisualType;
  /**
   * What the product is doing, when it is on screen doing something. Empty is
   * honest for a title card or a logo beat; a `PRODUCT_UI` shot with nothing
   * here is a shot nobody can build.
   */
  productInteraction: string;
  framing: string;
  cameraMotion: string;
  /** Ids of real project assets this shot uses. Never free text. */
  assetIds: string[];
  /** Ids of recorded evidence this shot is checked against. */
  evidenceIds: string[];
  captureRequirement: StoryboardCaptureRequirement;
  notes: string;
}

export interface StoryboardTextOverlay {
  id: string;
  role: StoryboardTextRole;
  text: string;
  position: StoryboardTextPosition;
  emphasis: StoryboardTextEmphasis;
  /** Milliseconds from the start of the owning scene. */
  startOffsetMs: number;
  endOffsetMs: number;
}

export interface StoryboardVoiceoverPlan {
  /**
   * Draft narration, not a recorded track. The words come from the direction, so
   * they are already grounded; the timing is not here because the scene owns it.
   */
  text: string;
}

export interface StoryboardMusicDirection {
  style: string;
  tempoBpm: number | null;
}

export interface StoryboardSfxCue {
  name: string;
  /** Milliseconds from the start of the owning scene. */
  atOffsetMs: number;
  why: string;
}

export interface StoryboardTransitionPlan {
  type: StoryboardTransitionType;
  rationale: string;
}

export interface StoryboardScene {
  id: string;
  /** Zero-based and dense, so the order is the timeline. */
  order: number;
  type: StoryboardSceneType;
  name: string;
  /** Why this scene is in the piece, in one line. */
  purpose: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  shots: StoryboardShot[];
  textOverlays: StoryboardTextOverlay[];
  voiceoverPlan: StoryboardVoiceoverPlan | null;
  musicDirection: StoryboardMusicDirection | null;
  sfxCues: StoryboardSfxCue[];
  transitionIn: StoryboardTransitionPlan | null;
  transitionOut: StoryboardTransitionPlan | null;
  /** Ids of CP06 features this scene shows. */
  featureIds: string[];
  /** Ids of CP06 workflows this scene demonstrates. */
  workflowIds: string[];
  /** Ids of CP06 claims this scene rests on. */
  claimIds: string[];
  /** Ids of CP06 evidence backing those claims. */
  evidenceIds: string[];
  notes: string;
}

export interface Storyboard {
  id: string;
  projectId: string;
  intentId: string;
  /** The chosen direction this was built from. A storyboard never floats free. */
  directionId: string;
  name: string;
  status: StoryboardStatus;
  /** The duration the request asked for. The timeline has to land on this. */
  targetDurationMs: number;
  /** The sum of the scenes. Kept separately so a drift is visible, not inferred. */
  actualDurationMs: number;
  aspectRatio: string | null;
  platforms: string[];
  brandVersion: number | null;
  intelligenceVersion: number | null;
  /** The creative run that produced the direction this was built from. */
  creativeRunId: string;
  /**
   * Incremented on every accepted edit and reorder. A storyboard that silently
   * changes under a reader is worse than no versioning at all, so the number is
   * part of the record rather than a log somebody keeps elsewhere.
   */
  version: number;
  scenes: StoryboardScene[];
  createdAt: string;
  updatedAt: string;
}

export type CreateStoryboardInput = Omit<
  Storyboard,
  "id" | "createdAt" | "updatedAt"
> & { id?: string; createdAt?: string; updatedAt?: string };

export type UpdateStoryboardInput = Partial<
  Pick<
    Storyboard,
    | "name"
    | "status"
    | "targetDurationMs"
    | "actualDurationMs"
    | "scenes"
    | "version"
  >
> & { updatedAt?: string };

/** The fields a person may change on a scene. Timings are not among them. */
export type EditableStoryboardScene = Partial<
  Omit<StoryboardScene, "id" | "order" | "startMs" | "endMs" | "durationMs">
>;

export const STORYBOARD_ERROR_CODES = [
  "STORYBOARD_INVALID_INPUT",
  "STORYBOARD_INTENT_NOT_FOUND",
  "STORYBOARD_INTENT_NOT_RESOLVED",
  "STORYBOARD_DIRECTION_NOT_FOUND",
  "STORYBOARD_DIRECTION_NOT_SELECTED",
  "STORYBOARD_NOT_FOUND",
  "STORYBOARD_LOCKED",
  "STORYBOARD_PLANNER_FAILED",
  "STORYBOARD_INSUFFICIENT_CONTEXT",
  "STORYBOARD_DURATION_UNSUPPORTED",
] as const;
export type StoryboardErrorCode = (typeof STORYBOARD_ERROR_CODES)[number];

export class StoryboardError extends Error {
  constructor(
    readonly code: StoryboardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StoryboardError";
  }
}
