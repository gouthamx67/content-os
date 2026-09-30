/**
 * A storyboard planner is a proposal machine, not a writer of record.
 *
 * It receives the whole context — the direction, the material, the duration — and
 * returns scenes: the plan, and nothing else. It does not receive a repository,
 * a clock, or an id factory.
 *
 * Deliberately absent from what it returns: `id`, `projectId`, `intentId`,
 * `directionId`, `status`, `version`, `brandVersion`, `intelligenceVersion`, and
 * the scene `order`/`startMs`/`endMs`/`durationMs`. The service assigns identity
 * and provenance, and the timeline is derived from the requested duration rather
 * than accepted from a proposal — a provider cannot mint a row, claim a
 * provenance it was not given, or hand back a plan whose scenes do not add up.
 *
 * Timings are therefore not the planner's to state. It says what each scene is
 * for and how much attention it wants relative to the others; the service turns
 * that into a contiguous timeline that lands exactly on the target. That is why
 * `relativeWeight` is a number and not a duration.
 */

import type { StoryboardContext } from "../domain/storyboard-context";
import type {
  StoryboardCaptureMode,
  StoryboardScene,
  StoryboardSceneType,
  StoryboardTransitionPlan,
  StoryboardVisualType,
} from "../domain/storyboard";

/**
 * A scene as proposed: the fields a planner wants to change, and nothing else.
 *
 * Deliberately partial, and identical in shape to `EditableStoryboardScene`. The
 * planner is filling in a shape the domain already chose, so the beats it does not
 * speak to keep what the deterministic planner put there. Requiring every field
 * would force a model to restate the whole scene — which is both a worse prompt
 * and a worse failure mode, since one field it invents badly now breaks a scene
 * whose other fields were fine.
 */
export type PlannedStoryboardScene = Partial<
  Omit<StoryboardScene, "id" | "order" | "startMs" | "endMs" | "durationMs">
> & {
  /**
   * Relative emphasis between 0 and 100. A hook and a close want more of a short
   * piece than a supporting beat does. Zero means "no more than the others".
   */
  relativeWeight: number;
};

export interface StoryboardPlannerRequest {
  context: StoryboardContext;
  /**
   * The beat sequence the deterministic planner arrived at, so a model is asked
   * to *fill in* a shape the domain already chose rather than to invent one. A
   * plan that drifts structurally from the mode is a worse outcome than a dull
   * one, and a model given a free hand will drift.
   */
  sceneTypes: readonly StoryboardSceneType[];
}

export interface StoryboardPlannerResult {
  provider: string;
  model: string | null;
  scenes: PlannedStoryboardScene[];
}

export interface StoryboardPlanner {
  readonly id: string;
  plan(request: StoryboardPlannerRequest): Promise<StoryboardPlannerResult>;
}

export type {
  StoryboardCaptureMode,
  StoryboardTransitionPlan,
  StoryboardVisualType,
};
