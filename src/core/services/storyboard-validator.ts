/**
 * Every rule a storyboard has to clear before it can be stored or shown.
 *
 * The same philosophy as the direction validator, and for the same reason: the
 * failure this layer exists to prevent is a plan that looks actionable and is
 * not. A storyboard is read as a commitment - this is the piece, this is what it
 * says, this is when it happens. A reference to a feature the project does not
 * have, a claim nobody verified, a number with nothing behind it, a gap in the
 * timeline: each of those is a promise the project cannot keep, and each is
 * invisible unless something checks.
 *
 * So the checks are exhaustive rather than sampled, and they report *all* the
 * problems at once. A validator that stops at the first fault turns a single
 * regeneration into a sequence of them, which is how a user ends up paying for
 * the same model call five times to find one typo.
 *
 * The timeline is checked first, because it is the one class of defect that makes
 * the rest meaningless: a plan with a hole in it cannot be timed, captioned or
 * rendered, whatever else is true about it.
 */

import type { StoryboardContext } from "../domain/storyboard-context";
import {
  isStoryboardCaptureMode,
  isStoryboardSceneType,
  isStoryboardTextPosition,
  isStoryboardTextRole,
  isStoryboardTransitionType,
  isStoryboardVisualType,
  type Storyboard,
  type StoryboardScene,
  type StoryboardTextOverlay,
} from "../domain/storyboard";
import { MIN_SCENE_DURATION_MS } from "../../lib/storyboard-timeline";
import { readsAsConceptualVisual, readsAsExperimentalHook } from "./creative-mode-policy";
import { supportableNumbers, unsupportedQuantifiedClaim } from "./copy-claims";

export interface StoryboardValidationIssue {
  code: string;
  message: string;
  /** The scene the problem is in, when it is in one. */
  sceneId?: string;
}

export class StoryboardValidationFailure extends Error {
  constructor(readonly issues: StoryboardValidationIssue[]) {
    super(
      issues.map((issue) => issue.message).join("; ") ||
        "Storyboard failed validation",
    );
    this.name = "StoryboardValidationFailure";
  }
}

/** A plan under this long cannot carry an argument, and over this is two pieces. */
export const MIN_TARGET_DURATION_MS = 3_000;
export const MAX_TARGET_DURATION_MS = 600_000;
/** Enough for a scene to be read, and not so much that a plan becomes a script. */
export const MAX_SCENES = 20;
export const MAX_TEXT_OVERLAYS_PER_SCENE = 6;
const MAX_FIELD_LENGTH = 900;

function add(
  issues: StoryboardValidationIssue[],
  code: string,
  message: string,
  sceneId?: string,
): void {
  issues.push(sceneId === undefined ? { code, message } : { code, message, sceneId });
}

function checkText(
  issues: StoryboardValidationIssue[],
  label: string,
  value: string,
  required: boolean,
  sceneId?: string,
): void {
  if (value.length === 0) {
    if (required) {
      add(issues, "STORYBOARD_EMPTY_FIELD", `${label} is empty`, sceneId);
    }
    return;
  }
  if (value.length > MAX_FIELD_LENGTH) {
    add(
      issues,
      "STORYBOARD_FIELD_TOO_LONG",
      `${label} is ${value.length} characters, over the ${MAX_FIELD_LENGTH} limit`,
      sceneId,
    );
  }
}

/**
 * The timeline: contiguous from zero, ending exactly on the target, and every
 * scene at least a millisecond long. This is the invariant everything else
 * assumes, so it is checked first and reported as a whole.
 */
function checkTimeline(
  issues: StoryboardValidationIssue[],
  board: Pick<Storyboard, "scenes" | "targetDurationMs" | "actualDurationMs">,
): void {
  const scenes = board.scenes;

  if (scenes.length === 0) {
    add(issues, "STORYBOARD_NO_SCENES", "A storyboard needs at least one scene");
    return;
  }
  if (scenes.length > MAX_SCENES) {
    add(
      issues,
      "STORYBOARD_TOO_MANY_SCENES",
      `A storyboard has ${scenes.length} scenes, over the ${MAX_SCENES} limit`,
    );
  }

  let expectedStart = 0;
  scenes.forEach((scene, index) => {
    if (scene.order !== index) {
      add(
        issues,
        "STORYBOARD_SCENE_ORDER_INVALID",
        `Scene "${scene.name}" is at index ${index} but claims order ${scene.order}`,
        scene.id,
      );
    }
    if (scene.startMs !== expectedStart) {
      add(
        issues,
        "STORYBOARD_TIMELINE_DISCONTINUOUS",
        `Scene "${scene.name}" starts at ${scene.startMs}ms but the previous scene ends at ${expectedStart}ms`,
        scene.id,
      );
    }
    if (scene.endMs - scene.startMs !== scene.durationMs) {
      add(
        issues,
        "STORYBOARD_SCENE_DURATION_MISMATCH",
        `Scene "${scene.name}" spans ${scene.endMs - scene.startMs}ms but records ${scene.durationMs}ms`,
        scene.id,
      );
    }
    if (scene.durationMs < MIN_SCENE_DURATION_MS) {
      add(
        issues,
        "STORYBOARD_SCENE_TOO_SHORT",
        `Scene "${scene.name}" is ${scene.durationMs}ms long; a scene has to be longer than that to be cut between`,
        scene.id,
      );
    }
    if (scene.endMs < scene.startMs) {
      add(
        issues,
        "STORYBOARD_SCENE_NEGATIVE",
        `Scene "${scene.name}" ends before it starts`,
        scene.id,
      );
    }
    expectedStart = scene.endMs;
  });

  if (expectedStart !== board.targetDurationMs) {
    add(
      issues,
      "STORYBOARD_DURATION_MISMATCH",
      `The scenes cover ${expectedStart}ms but the piece is ${board.targetDurationMs}ms`,
    );
  }
  if (board.actualDurationMs !== board.targetDurationMs) {
    add(
      issues,
      "STORYBOARD_ACTUAL_DURATION_MISMATCH",
      `The storyboard records ${board.actualDurationMs}ms actual against a ${board.targetDurationMs}ms target`,
    );
  }
  if (board.targetDurationMs < MIN_TARGET_DURATION_MS) {
    add(
      issues,
      "STORYBOARD_TARGET_TOO_SHORT",
      `A ${board.targetDurationMs}ms piece is too short to carry a hook, an argument and a close`,
    );
  }
  if (board.targetDurationMs > MAX_TARGET_DURATION_MS) {
    add(
      issues,
      "STORYBOARD_TARGET_TOO_LONG",
      `A ${board.targetDurationMs}ms piece is over the ${MAX_TARGET_DURATION_MS}ms limit; split it rather than stretching scenes`,
    );
  }
}

/**
 * Every id a scene cites has to exist in the context. A reference to something
 * the project does not have is the specific failure this checkpoint exists to
 * catch: the plan reads as buildable and the build cannot start.
 */
function checkReferences(
  issues: StoryboardValidationIssue[],
  scene: StoryboardScene,
  context: StoryboardContext,
): void {
  const known = {
    features: new Set(context.product.features.map((feature) => feature.id)),
    workflows: new Set(context.product.workflows.map((workflow) => workflow.id)),
    claims: new Set(context.product.claims.map((claim) => claim.id)),
    evidence: new Set(context.evidence.map((item) => item.id)),
    assets: new Set(context.assets.map((asset) => asset.id)),
    sessions: new Set(context.browserCaptures.map((capture) => capture.id)),
  };

  for (const id of scene.featureIds) {
    if (!known.features.has(id)) {
      add(issues, "STORYBOARD_UNKNOWN_FEATURE", `Scene "${scene.name}" refers to a feature this project does not have`, scene.id);
    }
  }
  for (const id of scene.workflowIds) {
    if (!known.workflows.has(id)) {
      add(issues, "STORYBOARD_UNKNOWN_WORKFLOW", `Scene "${scene.name}" refers to a workflow this project does not have`, scene.id);
    }
  }
  for (const id of scene.claimIds) {
    if (!known.claims.has(id)) {
      add(issues, "STORYBOARD_UNKNOWN_CLAIM", `Scene "${scene.name}" rests on a claim the project never recorded`, scene.id);
    }
  }
  for (const id of scene.evidenceIds) {
    if (!known.evidence.has(id)) {
      add(issues, "STORYBOARD_UNKNOWN_EVIDENCE", `Scene "${scene.name}" cites evidence this project does not have`, scene.id);
    }
  }

  for (const shot of scene.shots) {
    for (const id of shot.assetIds) {
      if (!known.assets.has(id)) {
        add(issues, "STORYBOARD_UNKNOWN_ASSET", `A shot in "${scene.name}" uses an asset this project does not have`, scene.id);
      }
    }
    for (const id of shot.evidenceIds) {
      if (!known.evidence.has(id)) {
        add(issues, "STORYBOARD_UNKNOWN_EVIDENCE", `A shot in "${scene.name}" cites evidence this project does not have`, scene.id);
      }
    }
    const capture = shot.captureRequirement;
    if (!isStoryboardCaptureMode(capture.mode)) {
      add(issues, "STORYBOARD_INVALID_CAPTURE_MODE", `A shot in "${scene.name}" names an unknown capture mode`, scene.id);
    } else if (capture.mode === "NONE") {
      if (capture.target.length > 0) {
        add(issues, "STORYBOARD_CAPTURE_TARGET_WITHOUT_MODE", `A shot in "${scene.name}" names a target but captures nothing`, scene.id);
      }
    } else if (capture.target.trim().length === 0) {
      // A capture with no target is a wish. Somebody later has to drive something,
      // and "something" is the part that was left out.
      add(issues, "STORYBOARD_CAPTURE_TARGET_MISSING", `A shot in "${scene.name}" captures but does not say what to capture`, scene.id);
    }
    if (capture.featureId && !known.features.has(capture.featureId)) {
      add(issues, "STORYBOARD_UNKNOWN_FEATURE", `A shot in "${scene.name}" captures a feature this project does not have`, scene.id);
    }
    if (capture.workflowId && !known.workflows.has(capture.workflowId)) {
      add(issues, "STORYBOARD_UNKNOWN_WORKFLOW", `A shot in "${scene.name}" captures a workflow this project does not have`, scene.id);
    }
    if (capture.browserSessionId && !known.sessions.has(capture.browserSessionId)) {
      add(issues, "STORYBOARD_UNKNOWN_SESSION", `A shot in "${scene.name}" points at a browser session this project has not run`, scene.id);
    }
    if (capture.browserTraceId && !capture.browserSessionId) {
      add(issues, "STORYBOARD_TRACE_WITHOUT_SESSION", `A shot in "${scene.name}" names a trace without the session it belongs to`, scene.id);
    }
    if (capture.browserTraceId && capture.browserSessionId) {
      const session = context.browserCaptures.find((item) => item.id === capture.browserSessionId);
      if (session && !session.traceIds.includes(capture.browserTraceId)) {
        add(issues, "STORYBOARD_UNKNOWN_TRACE", `A shot in "${scene.name}" names a trace that session never recorded`, scene.id);
      }
    }
  }
}

/** On-screen text and narration: non-empty, inside the scene, and not invented. */
function checkTextOverlays(
  issues: StoryboardValidationIssue[],
  scene: StoryboardScene,
  supportable: ReadonlySet<string>,
): void {
  if (scene.textOverlays.length > MAX_TEXT_OVERLAYS_PER_SCENE) {
    add(
      issues,
      "STORYBOARD_TOO_MANY_OVERLAYS",
      `Scene "${scene.name}" has ${scene.textOverlays.length} text overlays, over the ${MAX_TEXT_OVERLAYS_PER_SCENE} limit`,
      scene.id,
    );
  }

  for (const overlay of scene.textOverlays) {
    const label = `Text overlay ${overlay.id} in "${scene.name}"`;
    checkText(issues, label, overlay.text, true, scene.id);

    if (!isStoryboardTextRole(overlay.role)) {
      add(issues, "STORYBOARD_INVALID_TEXT_ROLE", `${label} has an unknown role`, scene.id);
    }
    if (!isStoryboardTextPosition(overlay.position)) {
      add(issues, "STORYBOARD_INVALID_TEXT_POSITION", `${label} has an unknown position`, scene.id);
    }
    if (overlay.startOffsetMs < 0) {
      add(issues, "STORYBOARD_TEXT_OUT_OF_BOUNDS", `${label} starts before its scene`, scene.id);
    }
    if (overlay.endOffsetMs > scene.durationMs) {
      add(
        issues,
        "STORYBOARD_TEXT_OUT_OF_BOUNDS",
        `${label} ends at ${overlay.endOffsetMs}ms, past the ${scene.durationMs}ms scene`,
        scene.id,
      );
    }
    if (overlay.endOffsetMs <= overlay.startOffsetMs) {
      add(issues, "STORYBOARD_TEXT_ZERO_LENGTH", `${label} is on screen for no time at all`, scene.id);
    }

    const unsupported = unsupportedQuantifiedClaim(overlay.text, supportable);
    if (unsupported) {
      add(
        issues,
        "STORYBOARD_UNSUPPORTED_QUANTIFIED_CLAIM",
        `${label} states ${unsupported}, which no supported claim in this project backs`,
        scene.id,
      );
    }
  }

  const narration = scene.voiceoverPlan?.text;
  if (narration !== undefined) {
    checkText(issues, `Narration in "${scene.name}"`, narration, false, scene.id);
    const unsupported = unsupportedQuantifiedClaim(narration, supportable);
    if (unsupported) {
      add(
        issues,
        "STORYBOARD_UNSUPPORTED_QUANTIFIED_CLAIM",
        `Narration in "${scene.name}" states ${unsupported}, which no supported claim in this project backs`,
        scene.id,
      );
    }
  }

  for (const cue of scene.sfxCues) {
    if (cue.atOffsetMs < 0 || cue.atOffsetMs > scene.durationMs) {
      add(issues, "STORYBOARD_SFX_OUT_OF_BOUNDS", `A sound cue in "${scene.name}" lands outside its scene`, scene.id);
    }
    checkText(issues, `Sound cue ${cue.name} in "${scene.name}"`, cue.why, true, scene.id);
  }

  if (scene.musicDirection) {
    const { tempoBpm } = scene.musicDirection;
    if (tempoBpm !== null && (!Number.isFinite(tempoBpm) || tempoBpm <= 0 || tempoBpm > 300)) {
      add(issues, "STORYBOARD_INVALID_TEMPO", `Scene "${scene.name}" sets a tempo outside any real range`, scene.id);
    }
  }
}

/** The shape of a scene: something to shoot, and an honest shot type. */
function checkScene(
  issues: StoryboardValidationIssue[],
  scene: StoryboardScene,
  context: StoryboardContext,
  supportable: ReadonlySet<string>,
): void {
  if (!isStoryboardSceneType(scene.type)) {
    add(issues, "STORYBOARD_INVALID_SCENE_TYPE", `Scene "${scene.name}" has an unknown type`, scene.id);
  }
  checkText(issues, `Scene "${scene.name}"`, scene.name, true, scene.id);
  checkText(issues, `The purpose of "${scene.name}"`, scene.purpose, true, scene.id);
  checkText(issues, `Notes on "${scene.name}"`, scene.notes, false, scene.id);

  if (scene.shots.length === 0) {
    add(issues, "STORYBOARD_SCENE_WITHOUT_SHOTS", `Scene "${scene.name}" has no shot, so there is nothing to make`, scene.id);
  }
  if (scene.shots.length > 6) {
    add(issues, "STORYBOARD_TOO_MANY_SHOTS", `Scene "${scene.name}" has ${scene.shots.length} shots, which is more than one beat can hold`, scene.id);
  }

  const productShots: readonly string[] = ["PRODUCT_UI", "BROWSER", "SCREEN_CAPTURE"];
  for (const shot of scene.shots) {
    if (!isStoryboardVisualType(shot.visualType)) {
      add(issues, "STORYBOARD_INVALID_VISUAL_TYPE", `A shot in "${scene.name}" has an unknown visual type`, scene.id);
    }
    checkText(issues, `The shot description in "${scene.name}"`, shot.description, true, scene.id);
    checkText(issues, `The framing in "${scene.name}"`, shot.framing, true, scene.id);
    checkText(issues, `The camera move in "${scene.name}"`, shot.cameraMotion, false, scene.id);

    // A shot that claims to be the product, with nothing the product does, cannot
    // be built - the person making it is left holding the whole idea.
    if (productShots.includes(shot.visualType) && shot.productInteraction.trim().length === 0) {
      add(
        issues,
        "STORYBOARD_SHOT_WITHOUT_INTERACTION",
        `A shot in "${scene.name}" shows the product but does not say what it is doing`,
        scene.id,
      );
    }
  }

  for (const transition of [scene.transitionIn, scene.transitionOut]) {
    if (transition && !isStoryboardTransitionType(transition.type)) {
      add(issues, "STORYBOARD_INVALID_TRANSITION", `Scene "${scene.name}" has an unknown transition`, scene.id);
    }
    if (transition) {
      checkText(issues, `The transition rationale in "${scene.name}"`, transition.rationale, true, scene.id);
    }
  }

  checkTextOverlays(issues, scene, supportable);
  checkReferences(issues, scene, context);
}

/**
 * The structure of the piece, judged against the mode.
 *
 * A hook first and the ask last are structural rather than stylistic: without
 * them the piece is a demo, and a mode that requires the real interface cannot be
 * satisfied by a scene that only ever shows type.
 */
function checkStructure(
  issues: StoryboardValidationIssue[],
  board: Storyboard,
  context: StoryboardContext,
): void {
  const scenes = board.scenes;
  if (scenes.length === 0) return;

  const hasProductUi = scenes.some((scene) =>
    scene.shots.some((shot) => shot.visualType === "PRODUCT_UI" || shot.visualType === "BROWSER"),
  );

  if (context.policy.requireProductUi && !hasProductUi) {
    add(
      issues,
      "STORYBOARD_PRODUCT_UI_REQUIRED",
      `${context.policy.label} mode needs the real product interface, and this plan never shows it`,
    );
  }
  if (context.policy.requireProductUi && context.assets.length === 0) {
    add(
      issues,
      "STORYBOARD_NO_PRODUCT_UI_RECORDED",
      `${context.policy.label} mode needs a product interface, and this project has not recorded one`,
    );
  }

  const hook = scenes[0];
  if (hook && hook.type !== "HOOK") {
    add(
      issues,
      "STORYBOARD_NO_HOOK",
      `The piece opens on "${hook.name}" rather than on a hook, so there is nothing to earn the next ${Math.round(board.targetDurationMs / 1000)} seconds with`,
      hook.id,
    );
  }
  if (hook && !context.policy.allowExperimentalHooks && readsAsExperimentalHook(context.direction.hook.mechanism)) {
    add(
      issues,
      "STORYBOARD_EXPERIMENTAL_HOOK_FORBIDDEN",
      `${context.policy.label} mode does not allow the experimental opening this direction describes`,
      hook.id,
    );
  }

  const last = scenes[scenes.length - 1];
  if (context.direction.cta && last && last.type !== "CTA") {
    add(
      issues,
      "STORYBOARD_MISSING_CTA",
      `The direction asks for "${context.direction.cta}" but the piece ends on "${last.name}"`,
      last.id,
    );
  }

  if (!context.policy.allowConceptualVisuals) {
    for (const scene of scenes) {
      for (const shot of scene.shots) {
        if (
          (shot.visualType === "CUSTOM" || shot.visualType === "TEXT") &&
          readsAsConceptualVisual(`${shot.description} ${shot.framing} ${shot.notes}`)
        ) {
          add(
            issues,
            "STORYBOARD_CONCEPTUAL_VISUAL_FORBIDDEN",
            `A shot in "${scene.name}" reads as a conceptual visual, which ${context.policy.label} mode does not allow`,
            scene.id,
          );
        }
      }
    }
  }
}

/**
 * Validates a whole storyboard against the context it was built from. Throws
 * with every problem it found rather than returning the first one, so a
 * regeneration fixes a draft in one pass.
 */
export function validateStoryboard(
  board: Storyboard,
  context: StoryboardContext,
): Storyboard {
  const issues: StoryboardValidationIssue[] = [];
  const supportable = supportableNumbers(
    context.product.claims.map((claim) => claim.text),
    [Math.round(context.requirements.targetDurationMs / 1000)],
  );

  checkTimeline(issues, board);
  for (const scene of board.scenes) {
    checkScene(issues, scene, context, supportable);
  }
  checkStructure(issues, board, context);

  if (issues.length > 0) {
    throw new StoryboardValidationFailure(issues);
  }
  return board;
}

/** Whether a storyboard is sound, for callers that want a verdict not a throw. */
export function isStoryboardValid(
  board: Storyboard,
  context: StoryboardContext,
): { valid: boolean; issues: StoryboardValidationIssue[] } {
  try {
    validateStoryboard(board, context);
    return { valid: true, issues: [] };
  } catch (error) {
    if (error instanceof StoryboardValidationFailure) {
      return { valid: false, issues: error.issues };
    }
    throw error;
  }
}

/** A single overlay's span, for readers that need to place it on a ruler. */
export function overlaySpan(overlay: StoryboardTextOverlay): number {
  return overlay.endOffsetMs - overlay.startOffsetMs;
}
