/**
 * The AI storyboard planner.
 *
 * Like the AI creative director, it is useful when a model is available and
 * invisible when one is not: anything it cannot deliver — a provider failure, a
 * reply that is not JSON, a scene count that does not match the beats — is raised
 * as an error so the service falls back to the deterministic plan and reports why.
 *
 * It parses rather than casts. A model is a source of untrusted input that happens
 * to be well-intentioned, so every field it sends is checked against the project's
 * own vocabularies and reference ids before it can reach the service. A field the
 * model gets wrong is dropped, not stored: a scene with one good idea and a
 * hallucinated id in it is worth keeping, and a scene that was rejected wholesale
 * would throw away the good idea too.
 */

import type { AIProvider } from "../../core/ports/ai-provider";
import type {
  PlannedStoryboardScene,
  StoryboardPlanner,
  StoryboardPlannerRequest,
  StoryboardPlannerResult,
} from "../../core/ports/storyboard-planner";
import {
  isStoryboardTextEmphasis,
  isStoryboardTextPosition,
  isStoryboardTextRole,
  isStoryboardTransitionType,
  isStoryboardVisualType,
  type StoryboardScene,
  type StoryboardShot,
  type StoryboardTextOverlay,
  type StoryboardTransitionPlan,
} from "../../core/domain/storyboard";
import {
  buildStoryboardPrompt,
  extractStoryboardScenes,
  storyboardSystemPrompt,
} from "./storyboard-planner-prompt";

/**
 * A shot the model proposed carries no capture plan of its own. The deterministic
 * planner assigned one to the beat, and that is the one a later job can act on.
 */
const NO_CAPTURE: StoryboardShot["captureRequirement"] = {
  mode: "NONE",
  target: "",
  workflowId: null,
  featureId: null,
  browserSessionId: null,
  browserTraceId: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

export class AiStoryboardPlanner implements StoryboardPlanner {
  readonly id = "ai-storyboard-planner";

  constructor(
    private readonly ai: AIProvider,
    private readonly options: { defaultModel?: string; temperature?: number } = {},
  ) {}

  async plan(request: StoryboardPlannerRequest): Promise<StoryboardPlannerResult> {
    const { context, sceneTypes } = request;

    const response = await this.ai.generate({
      model: this.options.defaultModel,
      temperature: this.options.temperature ?? 0.5,
      messages: [
        { role: "system", content: storyboardSystemPrompt(context.mode) },
        { role: "user", content: buildStoryboardPrompt(context, sceneTypes) },
      ],
      metadata: {
        purpose: "storyboard",
        projectId: context.projectId,
        intentId: context.intentId,
        mode: context.mode,
      },
    });

    const entries = extractStoryboardScenes(response.text, sceneTypes.length);

    return {
      provider: this.id,
      model: response.model,
      scenes: entries.map((entry, index) =>
        this.toScene(entry, sceneTypes[index], context),
      ),
    };
  }

  /**
   * Turns one model entry into a partial scene.
   *
   * Everything here is a filter, not an interpreter: a field is taken when the
   * model sent something the project recognises, and skipped when it did not. The
   * returned `relativeWeight` is the one field the model has to get right to have
   * any effect on the timeline, so a missing or nonsensical one falls back to the
   * beat's own weight and the plan still shapes correctly.
   */
  private toScene(
    entry: Record<string, unknown>,
    beatType: StoryboardPlannerRequest["sceneTypes"][number],
    context: StoryboardPlannerRequest["context"],
  ): PlannedStoryboardScene {
    const scene: Partial<StoryboardScene> = {};

    const name = asString(entry["name"]);
    if (name) scene.name = name;

    const purpose = asString(entry["purpose"]);
    if (purpose) scene.purpose = purpose;

    const shots = this.toShots(entry["shots"], context);
    if (shots.length > 0) scene.shots = shots;

    const textOverlays = this.toTextOverlays(entry["textOverlays"], beatType);
    if (textOverlays.length > 0) scene.textOverlays = textOverlays;

    const voiceover = entry["voiceoverPlan"];
    if (isRecord(voiceover)) {
      const text = asString(voiceover["text"]);
      if (text) scene.voiceoverPlan = { text };
    }

    const music = this.toMusic(entry["musicDirection"]);
    if (music) scene.musicDirection = music;

    const transitionIn = this.toTransition(entry["transitionIn"]);
    if (transitionIn) scene.transitionIn = transitionIn;

    const transitionOut = this.toTransition(entry["transitionOut"]);
    if (transitionOut) scene.transitionOut = transitionOut;

    // References are intersected with what the project actually has, so a
    // hallucinated id is dropped here rather than becoming a validation failure
    // for the whole plan.
    const featureIds = intersect(
      asStringList(entry["featureIds"]),
      context.product.features.map((feature) => feature.id),
    );
    if (featureIds.length > 0) scene.featureIds = featureIds;

    const workflowIds = intersect(
      asStringList(entry["workflowIds"]),
      context.product.workflows.map((workflow) => workflow.id),
    );
    if (workflowIds.length > 0) scene.workflowIds = workflowIds;

    const claimIds = intersect(
      asStringList(entry["claimIds"]),
      context.product.claims.map((claim) => claim.id),
    );
    if (claimIds.length > 0) scene.claimIds = claimIds;

    const evidenceIds = intersect(
      asStringList(entry["evidenceIds"]),
      context.evidence.map((item) => item.id),
    );
    if (evidenceIds.length > 0) scene.evidenceIds = evidenceIds;

    const notes = asString(entry["notes"]);
    if (notes) scene.notes = notes;

    return { ...scene, relativeWeight: this.toWeight(entry["relativeWeight"]) };
  }

  private toShots(value: unknown, context: StoryboardPlannerRequest["context"]): StoryboardShot[] {
    if (!Array.isArray(value)) return [];
    const shots: StoryboardShot[] = [];

    value.slice(0, 4).forEach((raw, index) => {
      if (!isRecord(raw)) return;
      const description = asString(raw["description"]);
      if (!description) return;

      const visual = raw["visualType"];

      shots.push({
        // A shot id is a local label for the scene it sits in; the scene owns the
        // real one, and this only has to be unique within the scene.
        id: `shot_${index + 1}`,
        description,
        visualType: isStoryboardVisualType(visual) ? visual : "CUSTOM",
        productInteraction: asString(raw["productInteraction"]) ?? "",
        framing: asString(raw["framing"]) ?? "medium",
        cameraMotion: asString(raw["cameraMovement"]) ?? "static",
        assetIds: intersect(
          asStringList(raw["assetIds"]),
          context.assets.map((asset) => asset.id),
        ),
        evidenceIds: intersect(
          asStringList(raw["evidenceIds"]),
          context.evidence.map((item) => item.id),
        ),
        // A model is not told to decide what a later capture job should do with
        // the shot, and it is not in a position to know which session exists. Left
        // as "nothing to capture" so the beat's own capture plan stands, rather
        // than letting a model invent a URL.
        captureRequirement: NO_CAPTURE,
        notes: asString(raw["notes"]) ?? "",
      });
    });

    return shots;
  }

  private toTextOverlays(
    value: unknown,
    beatType: StoryboardPlannerRequest["sceneTypes"][number],
  ): StoryboardTextOverlay[] {
    if (!Array.isArray(value)) return [];
    const overlays: StoryboardTextOverlay[] = [];

    value.slice(0, 4).forEach((raw, index) => {
      if (!isRecord(raw)) return;
      const text = asString(raw["text"]);
      if (!text) return;

      const role = raw["role"];
      const position = raw["position"];
      const emphasis = raw["emphasis"];

      overlays.push({
        id: `overlay_${index + 1}`,
        // A hook that opens with no words is a mistake, and so is a close that
        // ends on one, so the beat's role fills in when the model sends nothing.
        role: isStoryboardTextRole(role) ? role : defaultTextRole(beatType),
        text,
        position: isStoryboardTextPosition(position) ? position : "CENTER",
        emphasis: isStoryboardTextEmphasis(emphasis) ? emphasis : "NORMAL",
        // Timings are relative to the scene and are re-clamped by the service
        // against whatever span the scene ends up with.
        startOffsetMs: toOffset(raw["startOffsetMs"], 0),
        endOffsetMs: toOffset(raw["endOffsetMs"], 1200),
      });
    });

    return overlays;
  }

  private toMusic(value: unknown): StoryboardScene["musicDirection"] {
    if (isRecord(value)) {
      const style = asString(value["style"]);
      if (style) {
        const tempo = value["tempoBpm"];
        return {
          style,
          tempoBpm:
            typeof tempo === "number" && Number.isFinite(tempo) && tempo > 0
              ? Math.round(tempo)
              : null,
        };
      }
    }
    // A model asked for a sentence will send one, and a sentence is still useful
    // direction; the tempo is simply not stated.
    const style = asString(value);
    return style ? { style, tempoBpm: null } : null;
  }

  private toTransition(value: unknown): StoryboardTransitionPlan | null {
    if (!isRecord(value)) return null;
    const type = value["type"];
    if (!isStoryboardTransitionType(type)) return null;
    return { type, rationale: asString(value["rationale"]) ?? "because the beat changes" };
  }

  /**
   * Clamped into the range the service accepts. Out-of-range weights are a model
   * that misunderstood the scale, and a number that cannot be clamped is better
   * ignored than guessed at: the beat's own weight is a known-good answer.
   */
  private toWeight(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return 1;
    if (value <= 0) return 0.1;
    return Math.min(100, Math.max(0.1, value));
  }
}

function toOffset(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.round(value);
}

function intersect(proposed: readonly string[], known: readonly string[]): string[] {
  const allowed = new Set(known);
  return proposed.filter((id) => allowed.has(id));
}

/** The text a beat implies when the model does not say: the ask closes, the rest speaks. */
function defaultTextRole(
  beatType: StoryboardPlannerRequest["sceneTypes"][number],
): StoryboardTextOverlay["role"] {
  if (beatType === "CTA") return "CTA";
  if (beatType === "HOOK") return "HEADLINE";
  return "CAPTION";
}
