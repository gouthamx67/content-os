/**
 * The service owns the lifecycle of a storyboard: gathering the context from the
 * chosen direction, asking a planner for a beat-by-beat plan, refusing anything
 * the project cannot stand behind, and keeping the rules about editing, ordering
 * and locking.
 *
 * Four rules are the reason this is a service and not a route handler:
 *
 *  - A plan is always built from a *selected* direction. A storyboard for an
 *    argument nobody chose is a plan for the wrong film.
 *  - Identity and provenance are assigned here, never taken from a proposal. A
 *    planner returns scenes; the row belongs to the service.
 *  - Timing is derived here, never accepted. Whatever a planner says about
 *    emphasis, the timeline is rebuilt so it covers the requested duration
 *    exactly. A plan whose scenes do not add up is not stored and then reported;
 *    it never reaches storage.
 *  - A locked storyboard stops being editable. Locking is the point at which a
 *    person has decided, and a later edit that silently changes the decided plan
 *    is worse than refusing the edit.
 */

import {
  StoryboardError,
  type EditableStoryboardScene,
  type Storyboard,
  type StoryboardCaptureRequirement,
  type StoryboardCaptureTarget,
  type StoryboardScene,
  type StoryboardStatus,
} from "../domain/storyboard";
import type { StoryboardContext } from "../domain/storyboard-context";
import type { StoryboardRepository } from "../ports/storyboard-repository";
import type {
  PlannedStoryboardScene,
  StoryboardPlanner,
} from "../ports/storyboard-planner";
import type { ContentIntentRepository } from "../ports/content-intent-repository";
import type { CreativeDirectionRepository } from "../ports/creative-direction-repository";
import type { IntelligenceRepository } from "../ports/intelligence-repository";
import type { BrandRepository } from "../ports/brand-repository";
import type { AssetRepository } from "../ports/asset-repository";
import type { BrowserSessionRepository } from "../ports/browser-session-repository";
import type { ProjectService } from "./project-service";
import { buildCreativeContext } from "./creative-context-builder";
import {
  buildStoryboardContext,
  requestedDurationMsFor,
} from "./storyboard-context-builder";
import { getContentType } from "../domain/content-type";
import { toBrandExecutionProfile } from "../domain/brand";
import {
  planStoryboard,
  SCENE_TYPE_WEIGHT,
} from "./deterministic-storyboard-planner";
import {
  StoryboardValidationFailure,
  validateStoryboard,
} from "./storyboard-validator";
import { buildStoryboardTimeline } from "../../lib/storyboard-timeline";
import { createId } from "../../lib/id";
import { pgTimestampToIso } from "../../lib/time";

/**
 * What a piece gets when the request named no length.
 *
 * Thirty seconds is the shortest span that can carry a hook, an argument and a
 * close, and it is a default rather than an answer: the panel shows it, and
 * changing it re-times the plan. It only applies to content that supports
 * duration at all — a written post has no timeline to plan against.
 */
export const DEFAULT_STORYBOARD_DURATION_MS = 30_000;

export type GenerateStoryboardInput = {
  projectId: string;
  userId: string;
  intentId: string;
  directionId: string;
  /** Overrides the intent's own duration. */
  targetDurationMs?: number;
};

export type StoryboardGeneration = {
  storyboard: Storyboard;
  provider: string;
  model: string | null;
  /** Set when a model planner failed and the deterministic one stood in. */
  fallbackFrom: string | null;
  fallbackReason: string | null;
  /** The shots a later checkpoint would have to capture, for the capture list. */
  captureTargets: StoryboardCaptureTarget[];
};

export type UpdateStoryboardScenesInput = {
  projectId: string;
  userId: string;
  storyboardId: string;
  /** Scene changes by id. Ids not in the map are left exactly as they are. */
  scenes: Array<{ sceneId: string; changes: EditableStoryboardScene }>;
};

export type ReorderStoryboardSceneInput = {
  projectId: string;
  userId: string;
  storyboardId: string;
  sceneId: string;
  toIndex: number;
};

export interface StoryboardServiceDependencies {
  projectService: Pick<ProjectService, "getAuthorized">;
  intentRepository: Pick<ContentIntentRepository, "getById">;
  directionRepository: Pick<CreativeDirectionRepository, "getById" | "listByIntent">;
  repository: StoryboardRepository;
  intelligenceRepository: Pick<IntelligenceRepository, "readGraph" | "latestSnapshot">;
  brandRepository: Pick<BrandRepository, "getByProjectId">;
  assetRepository: Pick<AssetRepository, "listByProject">;
  browserSessionRepository?: Pick<BrowserSessionRepository, "listSessions">;
  /** In order of preference; the first failure falls through to the next. */
  planners?: StoryboardPlanner[];
  createId?: (prefix: string) => string;
  now?: () => Date;
}

/** Weights the planner proposes are advisory; they are clamped into this range. */
const MIN_WEIGHT = 0;
const MAX_WEIGHT = 100;
/** Beyond this a plan is a shot list, not an edit someone can work from. */
const MAX_SCENES = 20;

/**
 * The scene fields a person may change.
 *
 * An allow-list rather than a block-list, because a block-list silently lets
 * through anything added to the scene later — including `id` and the timings,
 * which are the domain's to assign. Copying these keys explicitly is also why an
 * edit cannot smuggle in a `relativeWeight` or a provenance field.
 */
const EDITABLE_SCENE_KEYS = [
  "type",
  "name",
  "purpose",
  "shots",
  "textOverlays",
  "voiceoverPlan",
  "musicDirection",
  "sfxCues",
  "transitionIn",
  "transitionOut",
  "featureIds",
  "workflowIds",
  "claimIds",
  "evidenceIds",
  "notes",
] as const satisfies readonly (keyof StoryboardScene)[];

/**
 * Visual types that put the real product interface on screen. A shot in one of
 * these is a shot somebody later has to actually capture.
 */
const PRODUCT_ON_SCREEN: ReadonlySet<string> = new Set([
  "PRODUCT_UI",
  "BROWSER",
  "SCREEN_CAPTURE",
]);

/** A shot that captures nothing, and says so. */
function noCapture(): StoryboardCaptureRequirement {
  return {
    mode: "NONE",
    target: "",
    workflowId: null,
    featureId: null,
    browserSessionId: null,
    browserTraceId: null,
  };
}

/**
 * Re-derives capture requirements on planner-authored shots.
 *
 * A planner can describe what a shot looks like but cannot know what this project
 * can actually capture: which features exist, which workflows are recorded,
 * which browser session ran. That is why the deterministic planner decides it and
 * why a proposal's own capture fields are discarded rather than trusted — a model
 * asking to "capture the pricing page" for a project with no pricing page would
 * otherwise write a capture job nobody can execute.
 *
 * The beat, not the shot index, owns the need: a beat either shows the product or
 * it does not, and the baseline's first real capture is the beat's capture plan.
 * So shots that show the interface inherit it and shots that do not — a title
 * card, a logo, a talking head a planner invented — capture nothing. This also
 * survives a planner splitting one beat into several shots or collapsing several
 * into one, which index-based inheritance would get wrong.
 */
function rederiveCapture(
  baseline: StoryboardScene["shots"],
  shots: StoryboardScene["shots"],
): StoryboardScene["shots"] {
  const plan = baseline.find((shot) => shot.captureRequirement.mode !== "NONE")
    ?.captureRequirement;

  return shots.map((shot) => ({
    ...shot,
    captureRequirement:
      plan && PRODUCT_ON_SCREEN.has(shot.visualType) ? { ...plan } : noCapture(),
  }));
}

function pickEditable(
  scene: StoryboardScene,
  changes: Partial<StoryboardScene>,
): StoryboardScene {
  const result = { ...scene };
  for (const key of EDITABLE_SCENE_KEYS) {
    const value = changes[key];
    if (value !== undefined) {
      // Each key is assignable to its own field type, but a heterogeneous loop
      // loses that; the cast is confined here rather than spread over the caller.
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

export class StoryboardService {
  private readonly createId: (prefix: string) => string;
  private readonly now: () => Date;
  private readonly planners: StoryboardPlanner[];

  constructor(private readonly deps: StoryboardServiceDependencies) {
    this.createId = deps.createId ?? ((prefix) => createId(prefix));
    this.now = deps.now ?? (() => new Date());
    this.planners = deps.planners ?? [];
  }

  async generate(input: GenerateStoryboardInput): Promise<StoryboardGeneration> {
    const context = await this.buildContext(
      input.projectId,
      input.userId,
      input.intentId,
      input.directionId,
      input.targetDurationMs,
    );

    const now = this.now();
    const timestamp = pgTimestampToIso(now.toISOString());
    const boardId = this.createId("sb");
    const sceneIds = Array.from(
      { length: MAX_SCENES },
      () => this.createId("sbscene"),
    );

    // The deterministic plan decides the structure; a planner may only fill in
    // the beats inside it. That ordering is deliberate: the mode's shape is a
    // product decision, and a model asked to invent the shape produces plans that
    // pass validation while missing the point.
    const baseline = planStoryboard({ context, idPrefix: boardId });
    const attempted = await this.runPlanners(context, baseline.scenes);

    const storyboard: Storyboard = {
      id: boardId,
      projectId: context.projectId,
      intentId: context.intentId,
      directionId: context.directionId,
      name: `${context.direction.name} storyboard`,
      status: "DRAFT",
      targetDurationMs: context.requirements.targetDurationMs,
      actualDurationMs: baseline.actualDurationMs,
      aspectRatio: context.requirements.aspectRatio,
      platforms: context.requirements.platforms,
      brandVersion: context.brandVersion,
      intelligenceVersion: context.intelligenceVersion,
      creativeRunId: context.direction.creativeRunId,
      version: 1,
      scenes: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // A planner that returns a plan the project cannot stand behind is treated the
    // same as one that throws: the deterministic plan stands in and the fallback is
    // reported. Refusing to generate at all would mean a bad model call breaks
    // something the project can always produce on its own.
    const filled = this.fillFromPlanner(context, baseline, attempted, sceneIds);
    let scenes: StoryboardScene[];
    try {
      scenes = filled.scenes;
      this.validate({ ...storyboard, scenes }, context);
    } catch (error) {
      if (!filled.usedPlanner) throw error;

      // The planner's fill was unusable. Take the beats it was filling in, without
      // its content, and say so — the failure is reported rather than hidden, but it
      // does not cost the project its plan.
      scenes = this.retime(
        baseline.scenes.map((scene, index) => ({
          ...scene,
          id: sceneIds[index] ?? this.createId("sbscene"),
        })),
        context.requirements.targetDurationMs,
        this.pacingOf(baseline.scenes),
      );
      filled.usedPlanner = false;
      filled.fallbackReason ??= "the plan the planner returned did not pass validation";
    }

    const validated = this.validate(
      { ...storyboard, scenes, actualDurationMs: scenes.at(-1)?.endMs ?? 0 },
      context,
    );
    const saved = await this.deps.repository.create(validated);

    const result = {
      provider: filled.usedPlanner ? filled.provider : "deterministic",
      model: filled.usedPlanner ? filled.model : null,
      fallbackFrom: filled.usedPlanner
        ? null
        : (attempted?.fallbackFrom ?? filled.provider),
      fallbackReason: filled.usedPlanner ? null : filled.fallbackReason,
    };

    return {
      storyboard: saved,
      provider: result.provider,
      model: result.model,
      fallbackFrom: result.fallbackFrom,
      fallbackReason: result.fallbackReason,
      // Built from the saved plan, so the capture list points at the ids that are
      // actually stored rather than the provisional ones the planner drafted with.
      captureTargets: baseline.captureTargets.map((target) => {
        const scene = saved.scenes[target.sceneIndex];
        if (!scene) {
          throw new StoryboardError(
            "STORYBOARD_PLANNER_FAILED",
            "A capture target referred to a scene the plan does not have",
          );
        }
        return {
          sceneId: scene.id,
          mode: target.workflowId ? "BROWSER" : "SCREEN",
          target: target.target,
          workflowId: target.workflowId,
        };
      }),
    };
  }

  async get(
    projectId: string,
    userId: string,
    storyboardId: string,
  ): Promise<Storyboard> {
    await this.deps.projectService.getAuthorized(projectId, userId);
    const board = await this.deps.repository.getById(storyboardId);
    if (!board || board.projectId !== projectId) {
      throw new StoryboardError(
        "STORYBOARD_NOT_FOUND",
        "Storyboard not found",
      );
    }
    return board;
  }

  async list(
    projectId: string,
    userId: string,
    options: { intentId?: string; status?: StoryboardStatus; limit?: number } = {},
  ): Promise<Storyboard[]> {
    await this.deps.projectService.getAuthorized(projectId, userId);
    return this.deps.repository.listByProject(projectId, options);
  }

  /**
   * Applies a set of scene edits. The timeline is rebuilt from the edited scenes
   * rather than patched, so a change to one scene's length cannot leave the rest
   * of the plan overlapping or leaving a gap.
   */
  async updateScenes(
    input: UpdateStoryboardScenesInput,
  ): Promise<Storyboard> {
    const board = await this.get(input.projectId, input.userId, input.storyboardId);
    this.assertEditable(board);

    const context = await this.contextFor(board, input.userId);
    const byId = new Map(input.scenes.map((entry) => [entry.sceneId, entry.changes]));

    const merged = board.scenes.map((scene) => {
      const changes = byId.get(scene.id);
      return changes ? pickEditable(scene, changes) : scene;
    });

    const unknownIds = input.scenes
      .map((entry) => entry.sceneId)
      .filter((sceneId) => !board.scenes.some((scene) => scene.id === sceneId));
    if (unknownIds.length > 0) {
      throw new StoryboardError(
        "STORYBOARD_INVALID_INPUT",
        `No scene with id ${unknownIds[0]} in this storyboard`,
      );
    }

    const retimed = this.retime(merged, board.targetDurationMs, this.pacingOf(merged));
    const validated = this.validate(
      {
        ...board,
        scenes: retimed,
        actualDurationMs: retimed.at(-1)?.endMs ?? 0,
        version: board.version + 1,
      },
      context,
    );
    return this.save(validated);
  }

  /**
   * Moves a scene and re-times the whole piece. Weights are preserved, so a hook
   * keeps its share of the piece wherever it ends up — a reorder changes the
   * argument's order, not its pacing priorities.
   */
  async reorderScene(input: ReorderStoryboardSceneInput): Promise<Storyboard> {
    const board = await this.get(input.projectId, input.userId, input.storyboardId);
    this.assertEditable(board);

    const from = board.scenes.findIndex((scene) => scene.id === input.sceneId);
    if (from < 0) {
      throw new StoryboardError(
        "STORYBOARD_INVALID_INPUT",
        "No scene with that id in this storyboard",
      );
    }
    if (!Number.isInteger(input.toIndex) || input.toIndex < 0 || input.toIndex >= board.scenes.length) {
      throw new StoryboardError(
        "STORYBOARD_INVALID_INPUT",
        "A scene can only be moved to a position that exists in the plan",
      );
    }
    if (from === input.toIndex) return board;

    const ordered = [...board.scenes];
    const [moved] = ordered.splice(from, 1);
    ordered.splice(input.toIndex, 0, moved);

    const context = await this.contextFor(board, input.userId);
    const retimed = this.retime(ordered, board.targetDurationMs, this.pacingOf(ordered));
    const validated = this.validate(
      {
        ...board,
        scenes: retimed,
        actualDurationMs: retimed.at(-1)?.endMs ?? 0,
        version: board.version + 1,
      },
      context,
    );
    return this.save(validated);
  }

  async select(
    projectId: string,
    userId: string,
    storyboardId: string,
  ): Promise<{ storyboard: Storyboard; demoted: Storyboard[] }> {
    await this.get(projectId, userId, storyboardId);
    const timestamp = pgTimestampToIso(this.now().toISOString());

    const outcome = await this.deps.repository.selectForIntent(storyboardId, timestamp);
    if (!outcome) {
      throw new StoryboardError(
        "STORYBOARD_NOT_FOUND",
        "Storyboard not found",
      );
    }
    return outcome;
  }

  /**
   * Locks a storyboard: the plan is now the decided one, and everything else
   * selected for the intent is archived so the next checkpoint reads exactly
   * this. Locking is one-way — unlocking would put the decision back in play, and
   * a decided plan that can be un-decided silently is not a decision.
   */
  async lock(
    projectId: string,
    userId: string,
    storyboardId: string,
  ): Promise<{ storyboard: Storyboard; archived: Storyboard[] }> {
    const board = await this.get(projectId, userId, storyboardId);
    if (board.status === "LOCKED") {
      throw new StoryboardError(
        "STORYBOARD_LOCKED",
        "This storyboard is already locked, and a locked plan cannot be changed",
      );
    }

    const timestamp = pgTimestampToIso(this.now().toISOString());
    const outcome = await this.deps.repository.lock(storyboardId, timestamp);
    if (!outcome) {
      throw new StoryboardError(
        "STORYBOARD_NOT_FOUND",
        "Storyboard not found",
      );
    }
    return outcome;
  }

  /**
   * The decided plan for an intent, if the piece has been locked.
   *
   * The intent id comes from the caller, so the result is checked against the
   * project that was authorized. Without that, being a member of any one project
   * would be enough to read another's decided plan by guessing its intent id.
   */
  async getLocked(
    projectId: string,
    userId: string,
    intentId: string,
  ): Promise<Storyboard | null> {
    await this.deps.projectService.getAuthorized(projectId, userId);
    const board = await this.deps.repository.getLockedForIntent(intentId);
    if (board && board.projectId !== projectId) return null;
    return board;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async save(board: Storyboard): Promise<Storyboard> {
    const saved = await this.deps.repository.update(board.id, {
      scenes: board.scenes,
      status: board.status,
      targetDurationMs: board.targetDurationMs,
      actualDurationMs: board.actualDurationMs,
      version: board.version,
      // The clock is the service's, not the caller's: an edit that reused the
      // board's existing timestamp would leave the row looking untouched even
      // though its version moved on.
      updatedAt: pgTimestampToIso(this.now().toISOString()),
    });
    if (!saved) {
      throw new StoryboardError(
        "STORYBOARD_NOT_FOUND",
        "Storyboard not found",
      );
    }
    return saved;
  }

  private assertEditable(board: Storyboard): void {
    if (board.status === "LOCKED") {
      throw new StoryboardError(
        "STORYBOARD_LOCKED",
        "This storyboard is locked. A locked plan is the decided one, so it cannot be edited",
      );
    }
  }

  private validate(board: Storyboard, context: StoryboardContext): Storyboard {
    try {
      return validateStoryboard(board, context);
    } catch (error) {
      if (error instanceof StoryboardValidationFailure) {
        throw new StoryboardError(
          "STORYBOARD_INVALID_INPUT",
          error.issues.map((issue) => issue.message).join("; "),
        );
      }
      throw error;
    }
  }

  /**
   * Re-derives start, end and duration for a sequence of scenes, preserving the
   * relative pacing it is given. A reorder or an edit changes the order and the
   * content; it does not get to change the length of the piece.
   */
  private retime(
    scenes: readonly StoryboardScene[],
    targetDurationMs: number,
    weights: readonly number[],
  ): StoryboardScene[] {
    const timeline = buildStoryboardTimeline(
      targetDurationMs,
      scenes.map((scene, index) => ({
        id: scene.id,
        weight: weights[index] ?? SCENE_TYPE_WEIGHT[scene.type] ?? 1,
      })),
    );

    const retimed = scenes.map((scene, index) => {
      const segment = timeline[index];
      return {
        ...scene,
        order: index,
        startMs: segment.startMs,
        endMs: segment.endMs,
        durationMs: segment.durationMs,
        // Offsets are relative to the scene, so a scene that moves or changes
        // length has to have them re-checked against the new span.
        textOverlays: scene.textOverlays.map((overlay) =>
          this.clampOverlay(overlay, segment.durationMs),
        ),
        sfxCues: scene.sfxCues.map((cue) => ({
          ...cue,
          atOffsetMs: Math.min(Math.max(0, cue.atOffsetMs), segment.durationMs),
        })),
      };
    });

    return retimed;
  }

  /**
   * Pacing for a plan that is already stored. A storyboard records where each
   * scene sits, not how much it wanted, so an edit or a reorder derives pacing
   * from the scene type. That is also the honest answer: a hook keeps its share
   * of the piece wherever a person moves it.
   */
  private pacingOf(scenes: readonly StoryboardScene[]): number[] {
    return scenes.map((scene) => SCENE_TYPE_WEIGHT[scene.type] ?? 1);
  }

  private clampOverlay(
    overlay: StoryboardScene["textOverlays"][number],
    sceneDurationMs: number,
  ): StoryboardScene["textOverlays"][number] {
    const start = Math.min(Math.max(0, overlay.startOffsetMs), sceneDurationMs);
    const end = Math.min(Math.max(start, overlay.endOffsetMs), sceneDurationMs);
    return { ...overlay, startOffsetMs: start, endOffsetMs: end };
  }

  /**
   * Merges a planner's scenes onto the deterministic beats, keeping identity and
   * timing. The planner fills the shape in; it does not get to restructure it.
   *
   * The proposed weights come back alongside the scenes because they are input to
   * the timeline and not a stored attribute: a plan records where each scene sits,
   * and a later reorder derives pacing from the scene types. Returning them here
   * rather than reading them off the scene afterwards is what stops a proposal's
   * weight from being silently dropped.
   */
  private applyPlannedScenes(
    baseline: readonly StoryboardScene[],
    planned: readonly PlannedStoryboardScene[],
    sceneIds: readonly string[],
  ): { scenes: StoryboardScene[]; weights: number[] } {
    const scenes: StoryboardScene[] = [];
    const weights: number[] = [];

    baseline.forEach((scene, index) => {
      const proposal = planned[index];
      const id = sceneIds[index] ?? this.createId("sbscene");
      if (!proposal) {
        scenes.push({ ...scene, id });
        weights.push(SCENE_TYPE_WEIGHT[scene.type] ?? 1);
        return;
      }

      const filled = pickEditable(scene, proposal);
      scenes.push({
        ...filled,
        id,
        type: scene.type,
        shots: rederiveCapture(scene.shots, filled.shots),
      });
      const proposed = proposal.relativeWeight;
      weights.push(
        typeof proposed === "number" && Number.isFinite(proposed)
          ? Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, proposed))
          : SCENE_TYPE_WEIGHT[scene.type] ?? 1,
      );
    });

    return { scenes, weights };
  }

  /**
   * Lays the deterministic beats down and, when a planner answered, fills them in
   * and lets it set the pacing.
   *
   * `usedPlanner` is mutable because the caller may find the filled plan invalid
   * and fall back, and the fallback has to be reported as one.
   */
  private fillFromPlanner(
    context: StoryboardContext,
    baseline: ReturnType<typeof planStoryboard>,
    attempted: Awaited<ReturnType<StoryboardService["runPlanners"]>>,
    sceneIds: readonly string[],
  ): {
    scenes: StoryboardScene[];
    provider: string;
    model: string | null;
    usedPlanner: boolean;
    fallbackReason: string | null;
  } {
    const base: StoryboardScene[] = baseline.scenes.map((scene, index) => ({
      ...scene,
      id: sceneIds[index] ?? this.createId("sbscene"),
    }));

    if (!attempted || attempted.scenes.length === 0) {
      return {
        scenes: base,
        provider: "deterministic",
        model: null,
        usedPlanner: false,
        fallbackReason: attempted?.fallbackReason ?? null,
      };
    }

    // A planner that filled the beats in gets to say how the pacing should feel, and
    // the timeline is rebuilt from that. It is still the domain that lays the scenes
    // down, so the result covers the requested duration exactly.
    const merged = this.applyPlannedScenes(baseline.scenes, attempted.scenes, sceneIds);
    return {
      scenes: this.retime(
        merged.scenes,
        context.requirements.targetDurationMs,
        merged.weights,
      ),
      provider: attempted.provider,
      model: attempted.model,
      usedPlanner: true,
      fallbackReason: null,
    };
  }

  /**
   * Asks each planner in turn, falling through on failure. The result is only used
   * if every one of them fails *or* the proposal is rejected by validation later;
   * this function only reports the last failure, because a chain that fell over
   * is the interesting part of the story.
   */
  private async runPlanners(
    context: StoryboardContext,
    baseline: readonly StoryboardScene[],
  ): Promise<{
    provider: string;
    model: string | null;
    scenes: PlannedStoryboardScene[];
    fallbackFrom: string | null;
    fallbackReason: string | null;
  } | null> {
    if (this.planners.length === 0) return null;

    const sceneTypes = baseline.map((scene) => scene.type);
    let lastFailure: { provider: string; reason: string } | null = null;

    for (const planner of this.planners) {
      try {
        const result = await planner.plan({ context, sceneTypes });
        return {
          provider: result.provider,
          model: result.model,
          scenes: result.scenes,
          fallbackFrom: null,
          fallbackReason: null,
        };
      } catch (error) {
        lastFailure = {
          provider: planner.id,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      provider: "deterministic",
      model: null,
      scenes: [],
      fallbackFrom: lastFailure?.provider ?? null,
      fallbackReason: lastFailure?.reason ?? null,
    };
  }

  private async contextFor(
    board: Storyboard,
    userId: string,
  ): Promise<StoryboardContext> {
    return this.buildContext(
      board.projectId,
      userId,
      board.intentId,
      board.directionId,
      board.targetDurationMs,
    );
  }

  private async buildContext(
    projectId: string,
    userId: string,
    intentId: string,
    directionId: string,
    overrideDurationMs?: number,
  ): Promise<StoryboardContext> {
    await this.deps.projectService.getAuthorized(projectId, userId);

    const intent = await this.deps.intentRepository.getById(intentId);
    if (!intent || intent.projectId !== projectId) {
      throw new StoryboardError(
        "STORYBOARD_INTENT_NOT_FOUND",
        "Content intent not found",
      );
    }
    if (intent.status !== "RESOLVED") {
      throw new StoryboardError(
        "STORYBOARD_INTENT_NOT_RESOLVED",
        "This content intent still needs answering before it can be planned",
      );
    }

    const direction = await this.deps.directionRepository.getById(directionId);
    if (!direction || direction.projectId !== projectId) {
      throw new StoryboardError(
        "STORYBOARD_DIRECTION_NOT_FOUND",
        "Creative direction not found",
      );
    }
    // A plan for an argument nobody chose is a plan for the wrong film. The
    // direction is checked rather than trusted, because a caller can hand us any
    // id it likes.
    if (direction.status !== "SELECTED") {
      throw new StoryboardError(
        "STORYBOARD_DIRECTION_NOT_SELECTED",
        "Select a creative direction before building a storyboard for it",
      );
    }
    if (direction.intentId !== intentId) {
      throw new StoryboardError(
        "STORYBOARD_DIRECTION_NOT_FOUND",
        "That creative direction belongs to a different content intent",
      );
    }

    const contentType = getContentType(intent.contentTypeId);
    if (contentType && !contentType.supportsDuration) {
      // A written post has no timeline, so there is nothing here to plan. Saying
      // so is more useful than inventing a thirty-second plan for a blog post.
      throw new StoryboardError(
        "STORYBOARD_DURATION_UNSUPPORTED",
        `A ${contentType.name} has no duration to plan against, so it has no storyboard`,
      );
    }

    const requested = requestedDurationMsFor(intent);
    const targetDurationMs = overrideDurationMs ?? requested ?? DEFAULT_STORYBOARD_DURATION_MS;
    if (!Number.isFinite(targetDurationMs) || targetDurationMs <= 0) {
      throw new StoryboardError(
        "STORYBOARD_DURATION_UNSUPPORTED",
        "This content has no usable duration to plan against",
      );
    }

    const [graph, brand, assets, sessions] = await Promise.all([
      this.deps.intelligenceRepository.readGraph(projectId),
      this.deps.brandRepository.getByProjectId(projectId),
      this.deps.assetRepository.listByProject(projectId),
      this.deps.browserSessionRepository?.listSessions(projectId) ?? Promise.resolve([]),
    ]);

    const snapshot = await this.deps.intelligenceRepository.latestSnapshot(projectId);
    const creativeContext = buildCreativeContext({
      intent,
      graph,
      brand: brand ? toBrandExecutionProfile(brand) : null,
      assets,
      mode: direction.mode,
      intelligenceVersion: snapshot?.version ?? null,
    });

    return buildStoryboardContext({
      context: creativeContext,
      intent,
      direction,
      targetDurationMs,
      sessions,
    });
  }
}
