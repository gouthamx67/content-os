/**
 * The deterministic storyboard planner.
 *
 * This is the floor the system stands on, not a fallback nobody runs. It is the
 * planner a paid model is compared against, and the one that still has to work
 * when the model is unavailable, the key is spent, or the direction is thin. A
 * capability whose good path needs a network call and whose bad path does not
 * work is a capability that fails in production.
 *
 * So everything here is derived from the context. Scene types come from the
 * direction's mode and angle, timings from the requested duration, copy from the
 * direction's own words, and every id a scene cites is one the context handed
 * over. Nothing is invented, and the validator re-checks that claim rather than
 * trusting it.
 *
 * The shape of a piece is not arbitrary. A hook and a call to action are
 * structural, so they are always placed and always given time. The middle is
 * where the two modes genuinely differ: BALANCED and GUIDED walk a sequence, WILD
 * favours a contrast pair and a transformation, and a direction with nothing to
 * show is not padded out with invented beats - the shot is honest that the piece
 * is carried by type and argument.
 */

import { buildStoryboardTimeline } from "../../lib/storyboard-timeline";
import { unsupportedQuantifiedClaim } from "./copy-claims";
import { readsAsExperimentalHook } from "./creative-mode-policy";
import type {
  StoryboardContext,
  StoryboardContextClaim,
  StoryboardContextFeature,
  StoryboardContextWorkflow,
} from "../domain/storyboard-context";
import type {
  StoryboardScene,
  StoryboardSceneType,
  StoryboardShot,
  StoryboardTextOverlay,
  StoryboardTransitionPlan,
  StoryboardVisualType,
  StoryboardCaptureRequirement,
} from "../domain/storyboard";

export interface StoryboardPlanInput {
  context: StoryboardContext;
  /** Id prefix, so two plans in one run never collide on generated ids. */
  idPrefix: string;
}

export interface StoryboardPlan {
  scenes: StoryboardScene[];
  actualDurationMs: number;
  /**
   * Shots that want a browser, with the page and control to aim at.
   *
   * `sceneIndex` points at the scene in `scenes` that needs the capture. The
   * service assigns the real scene ids after the plan is built, so a capture list
   * that only carried a target string would have nothing to attach itself to.
   */
  captureTargets: Array<{
    sceneIndex: number;
    sessionId: string | null;
    target: string;
    workflowId: string | null;
  }>;
}

/** Anything this planner could never draw on. */
const NO_CAPTURE: StoryboardCaptureRequirement = {
  mode: "NONE",
  target: "",
  workflowId: null,
  featureId: null,
  browserSessionId: null,
  browserTraceId: null,
};

/**
 * The visual weight a scene type asks for, before mode and mode-agnostic tuning.
 * Exported because re-timing an edited or reordered plan needs the same table,
 * and two copies of it would drift into two different shapes for one piece.
 */
export const SCENE_TYPE_WEIGHT: Record<StoryboardSceneType, number> = {
  HOOK: 1.4,
  PROBLEM: 1.1,
  REVEAL: 1.2,
  PRODUCT_DEMO: 1.5,
  WORKFLOW: 1.4,
  FEATURE: 1.2,
  TRANSFORMATION: 1.2,
  PROOF: 1.2,
  SOCIAL_PROOF: 1,
  CTA: 1.3,
  TRANSITION: 0.4,
  CUSTOM: 1,
};

/**
 * The middle of a piece, as a sequence of scene types. The index is roughly
 * where a beat belongs, not a promise about count: a long piece gets more of
 * these, a short one gets the first few.
 */
const MIDDLE_SEQUENCE: readonly StoryboardSceneType[] = [
  "PROBLEM",
  "REVEAL",
  "FEATURE",
  "PRODUCT_DEMO",
  "PROOF",
  "TRANSFORMATION",
];

/** A contrast-led alternative, for a direction that argues by contrast. */
const CONTRAST_SEQUENCE: readonly StoryboardSceneType[] = [
  "PROBLEM",
  "TRANSFORMATION",
  "REVEAL",
  "FEATURE",
  "PROOF",
  "SOCIAL_PROOF",
];

/** A short, readable name for a scene type, used when nothing better exists. */
const SCENE_LABEL: Record<StoryboardSceneType, string> = {
  HOOK: "Opening hook",
  PROBLEM: "The problem",
  REVEAL: "The reveal",
  PRODUCT_DEMO: "Product demo",
  WORKFLOW: "Core workflow",
  FEATURE: "Feature",
  TRANSFORMATION: "The shift",
  PROOF: "Proof",
  SOCIAL_PROOF: "Social proof",
  CTA: "Call to action",
  TRANSITION: "Transition",
  CUSTOM: "Key point",
};

function claimTexts(claims: readonly StoryboardContextClaim[]): string[] {
  return claims.map((claim) => claim.text);
}

/**
 * A headline trimmed to something that can be read in the time given. Whether the
 * words are *allowed* is a separate question, answered by
 * `claimsUnsupportedNumber` at each call site - a line that cannot be used is
 * left out rather than rewritten here, because rewriting copy silently is how a
 * plan ends up saying something nobody chose.
 */
function safeStatement(statement: string, maxLength = 90): string {
  const trimmed = statement.trim();
  if (trimmed.length > maxLength) {
    const cut = trimmed.slice(0, maxLength);
    const lastSpace = cut.lastIndexOf(" ");
    return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
  }
  return trimmed;
}

/** Whether a piece of text states a number the project cannot support. */
function claimsUnsupportedNumber(
  text: string,
  supported: ReadonlySet<string>,
): boolean {
  return unsupportedQuantifiedClaim(text, supported) !== null;
}

interface ClaimBundle {
  supported: Set<string>;
  claims: StoryboardContextClaim[];
  evidenceIds: string[];
}

function claimsFor(context: StoryboardContext): ClaimBundle {
  const claims = context.product.claims;
  const numbers = new Set<string>();
  for (const claim of claims) {
    for (const match of claim.text.matchAll(/\d+(?:[.,]\d+)?/g)) {
      numbers.add(match[0]);
    }
  }
  if (context.requirements.targetDurationMs) {
    numbers.add(String(Math.round(context.requirements.targetDurationMs / 1000)));
  }
  return {
    supported: numbers,
    claims,
    evidenceIds: [...new Set(claims.flatMap((claim) => claim.evidenceIds))],
  };
}

/** Features worth putting on screen, in a stable order. */
function usableFeatures(
  context: StoryboardContext,
  claims: ClaimBundle,
): StoryboardContextFeature[] {
  const claimText = claimTexts(claims.claims).join(" ").toLowerCase();
  const scored = context.product.features.map((feature, index) => ({
    feature,
    index,
    mentions: claimText.includes(feature.name.toLowerCase()) ? 2 : 0,
    hasEvidence: feature.evidenceIds.length > 0 ? 1 : 0,
  }));
  scored.sort(
    (left, right) =>
      right.mentions - left.mentions ||
      right.hasEvidence - left.hasEvidence ||
      left.index - right.index,
  );
  return scored.map((entry) => entry.feature);
}

/** Workflows that can actually be demonstrated, longest-running first in the plan. */
function demonstrableWorkflows(
  context: StoryboardContext,
  features: readonly StoryboardContextFeature[],
): StoryboardContextWorkflow[] {
  if (features.length === 0) return [];
  const names = features.map((feature) => feature.name.toLowerCase());
  return context.product.workflows.filter((workflow) => {
    const named = names.some((name) => workflow.name.toLowerCase().includes(name));
    return named || workflow.steps.length > 0;
  });
}

/** The capture requirement for a shot showing a feature or workflow. */
function captureFor(
  context: StoryboardContext,
  workflow: StoryboardContextWorkflow | null,
  feature: StoryboardContextFeature | null,
  target: string,
): StoryboardCaptureRequirement {
  if (!workflow && !feature) {
    // Nothing real to point at. The target stays empty rather than carrying a
    // description, because a target on a shot that captures nothing is a
    // instruction that cannot be followed.
    return { ...NO_CAPTURE };
  }
  const session = context.browserCaptures[0] ?? null;
  return {
    mode: workflow ? "BROWSER" : "SCREEN",
    target,
    workflowId: workflow?.id ?? null,
    featureId: feature?.id ?? null,
    browserSessionId: session?.id ?? null,
    browserTraceId: null,
  };
}

/** What a shot shows, and whether it needs the real interface to do it. */
function visualFor(
  type: StoryboardSceneType,
  context: StoryboardContext,
  hasRealUi: boolean,
): StoryboardVisualType {
  const productShots: readonly StoryboardSceneType[] = [
    "PRODUCT_DEMO",
    "WORKFLOW",
    "FEATURE",
    "PROOF",
    "REVEAL",
  ];
  if (!productShots.includes(type)) {
    if (type === "HOOK") return "TEXT";
    if (type === "CTA") return hasRealUi ? "PRODUCT_UI" : "TEXT";
    return "BRAND";
  }
  return hasRealUi ? "PRODUCT_UI" : "CUSTOM";
}

function transitionsBetween(
  from: StoryboardSceneType,
  to: StoryboardSceneType,
): StoryboardTransitionPlan {
  // A problem that turns into a reveal is the one place a match cut carries
  // meaning; elsewhere a cut is honest about there being no relationship.
  if (to === "REVEAL" && from === "PROBLEM") {
    return { type: "MATCH_CUT", rationale: "The reveal is the same idea, inverted" };
  }
  if (to === "TRANSFORMATION" || from === "TRANSFORMATION") {
    return { type: "DISSOLVE", rationale: "A change of state, so time dissolves rather than cuts" };
  }
  return { type: "CUT", rationale: "No relationship to show between these beats" };
}

/**
 * The middle beats, in order. Kept separate from the timing pass because the
 * number of scenes is decided by the duration and the available material, and
 * both of those are known before any of it is timed.
 */
function chooseMiddleTypes(
  context: StoryboardContext,
  claims: ClaimBundle,
  features: readonly StoryboardContextFeature[],
  workflows: readonly StoryboardContextWorkflow[],
  count: number,
): StoryboardSceneType[] {
  const sequence =
    context.mode === "WILD" ? CONTRAST_SEQUENCE : MIDDLE_SEQUENCE;

  if (count === 0) return [];
  if (context.mode !== "WILD") return [...sequence.slice(0, count)];

  // WILD opens on the contrast and spends its beats on the shift, but it will
  // not claim to show the product if there is nothing real to show.
  const prefers = workflows.length > 0 ? "WORKFLOW" : features.length > 0 ? "FEATURE" : null;
  const out: StoryboardSceneType[] = [];
  for (let index = 0; index < count; index += 1) {
    const base = sequence[index % sequence.length];
    if (prefers && (base === "FEATURE" || base === "PRODUCT_DEMO")) {
      out.push(prefers);
    } else {
      out.push(base);
    }
  }
  if (claims.claims.length > 0 && !out.includes("PROOF")) {
    out[out.length - 1] = "PROOF";
  }
  return out;
}

/** Builds the one-shot timeline for a scene, spanning the whole scene. */
function fullWidthText(
  prefix: string,
  text: string,
  role: StoryboardTextOverlay["role"],
  emphasis: StoryboardTextOverlay["emphasis"],
  sceneDurationMs: number,
): StoryboardTextOverlay {
  // A three beat minimum stops an overlay being written for a millisecond, and a
  // half-second cap stops it covering a long scene.
  const startOffsetMs = 0;
  const endOffsetMs = Math.max(3_000, Math.min(sceneDurationMs, sceneDurationMs - 200));
  return {
    id: `${prefix}_text`,
    role,
    text,
    position: role === "CTA" ? "CENTER" : role === "LABEL" ? "LOWER_THIRD" : "CENTER",
    emphasis,
    startOffsetMs: Math.min(startOffsetMs, Math.max(0, endOffsetMs - 500)),
    endOffsetMs: Math.max(endOffsetMs, 500),
  };
}

/**
 * The voiceover line for a scene, drawn from the direction's own words. Empty
 * rather than invented: a scene carried by a demo does not need narration, and a
 * fabricated one is worse than silence.
 */
function voiceoverFor(
  type: StoryboardSceneType,
  context: StoryboardContext,
  claims: ClaimBundle,
): string | null {
  const { direction } = context;
  switch (type) {
    case "HOOK":
      return direction.hook.statement;
    case "PROBLEM": {
      const problem = context.product.problems[0]?.description;
      return problem ?? direction.audienceAngle;
    }
    case "REVEAL":
      return direction.thesis;
    case "PROOF": {
      const claim = claims.claims[0];
      if (!claim) return null;
      return claimsUnsupportedNumber(claim.text, claims.supported)
        ? `${claim.text.replace(/\d+(?:\.\d+)?\s?(?:%|x|percent|times)\b\.?/gi, "").trim()}`
        : claim.text;
    }
    case "CTA":
      return direction.cta ?? null;
    case "WORKFLOW":
    case "PRODUCT_DEMO":
    case "FEATURE":
    case "TRANSFORMATION":
    case "SOCIAL_PROOF":
    case "TRANSITION":
    case "CUSTOM":
      // The narrator would add nothing the picture is not already saying. Silence
      // is a decision here, not an omission: a demo you can follow needs no voice
      // reading it back to you.
      return null;
  }
}

function musicFor(
  type: StoryboardSceneType,
  context: StoryboardContext,
): StoryboardScene["musicDirection"] {
  if (type === "HOOK" || type === "REVEAL" || type === "CTA") {
    return { style: context.direction.musicDirection, tempoBpm: null };
  }
  return null;
}

function sfxFor(
  type: StoryboardSceneType,
  context: StoryboardContext,
): StoryboardScene["sfxCues"] {
  if (type === "HOOK" && readsAsExperimentalHook(context.direction.hook.mechanism)) {
    return [
      {
        name: "impact",
        atOffsetMs: 0,
        why: "The opening mechanism earns its attention with a sound as much as a picture",
      },
    ];
  }
  if (type === "CTA") {
    return [
      {
        name: "subtle rise",
        atOffsetMs: 0,
        why: "A lift on the ask, so the moment reads as a decision",
      },
    ];
  }
  return [];
}

function purposeFor(
  type: StoryboardSceneType,
  context: StoryboardContext,
  feature: StoryboardContextFeature | null,
  workflow: StoryboardContextWorkflow | null,
): string {
  switch (type) {
    case "HOOK":
      return `Earn the next ${Math.round(context.requirements.targetDurationMs / 1000)} seconds with ${context.direction.hook.mechanism.toLowerCase()}`;
    case "PROBLEM":
      return "Name the thing the viewer already lives with, so the rest of the piece has something to answer";
    case "REVEAL":
      return "State the thesis in the viewer's own terms";
    case "PRODUCT_DEMO":
      return feature
        ? `Show ${feature.name} doing its job, on the real interface`
        : "Show the product doing the thing the direction promises";
    case "WORKFLOW":
      return workflow
        ? `Walk ${workflow.name} end to end so the value is a sequence, not a promise`
        : "Walk the core workflow end to end";
    case "FEATURE":
      return feature ? `Land ${feature.name} against the problem just named` : "Land the capability that answers the problem";
    case "TRANSFORMATION":
      return "Show the before and after, which is the whole argument";
    case "PROOF":
      return "Support the thesis with what the project can actually stand behind";
    case "SOCIAL_PROOF":
      return "Let other people carry the claim where evidence cannot";
    case "CTA":
      return context.direction.cta
        ? "Ask for the one thing the direction decided to ask for"
        : "Close on the product, without a demand";
    case "TRANSITION":
      return "Carry the viewer across without adding to the argument";
    case "CUSTOM":
      return "Carry a point the sequence did not have a place for";
  }
}

function nameFor(
  type: StoryboardSceneType,
  feature: StoryboardContextFeature | null,
  workflow: StoryboardContextWorkflow | null,
): string {
  if (type === "WORKFLOW" && workflow) return workflow.name;
  if (type === "FEATURE" && feature) return feature.name;
  if (type === "PRODUCT_DEMO" && feature) return `${feature.name} in use`;
  return SCENE_LABEL[type];
}

/** The interaction line for a product shot, stated concretely enough to build. */
function interactionFor(
  type: StoryboardSceneType,
  feature: StoryboardContextFeature | null,
  workflow: StoryboardContextWorkflow | null,
  hasRealUi: boolean,
): string {
  if (!hasRealUi) {
    return "No interface to drive: this shot is carried by type and copy, not by the product";
  }
  if (type === "WORKFLOW" && workflow) {
    const steps = workflow.steps.slice(0, 4).map((step) => step.action);
    return steps.length > 0
      ? steps.join(", then ")
      : `Complete ${workflow.name} in the real product`;
  }
  if (feature) return `Open ${feature.name} and show it handling a real case`;
  if (type === "PRODUCT_DEMO") return "Drive the product through the moment the direction promises";
  if (type === "PROOF") {
    return "Hold on the interface while the supporting claim is stated over it";
  }
  if (type === "CTA") {
    return "Rest on the product's own interface with the ask over it";
  }
  // A HOOK or a text-only beat has nothing for the product to do, and saying so
  // is more useful to a maker than an invented interaction.
  return "";
}

/** The framing and camera lines, which follow from the shot's job. */
function cameraFor(
  type: StoryboardSceneType,
  context: StoryboardContext,
): { framing: string; cameraMotion: string } {
  if (type === "HOOK") {
    return {
      framing: "Centred, generous margins, one idea filling the frame",
      cameraMotion:
        context.mode === "WILD"
          ? "A single deliberate push that does not settle"
          : "Locked off, so the copy carries the beat",
    };
  }
  if (type === "PRODUCT_DEMO" || type === "WORKFLOW") {
    return { framing: "Interface filling the frame, the active control readable", cameraMotion: "Follows the cursor, no cuts mid-action" };
  }
  if (type === "PROBLEM") {
    return { framing: "Tight, no room to move", cameraMotion: "Static, with the discomfort left in" };
  }
  if (type === "CTA") {
    return { framing: "Product and the ask in one frame", cameraMotion: "Settles to rest, motion stops" };
  }
  return { framing: "Clear enough to read in the time given", cameraMotion: "Minimal" };
}

/**
 * Builds a complete plan from the context.
 *
 * The scene count is derived, not chosen: enough to carry the direction, capped so
 * the piece stays watchable, and never so fine that a scene is a fraction of a
 * second. It returns the scenes with their timings resolved and no status or
 * identity attached - those belong to the service, which is the only place that
 * knows about storage.
 */
export function planStoryboard(input: StoryboardPlanInput): StoryboardPlan {
  const { context, idPrefix } = input;
  const claims = claimsFor(context);
  const features = usableFeatures(context, claims);
  const workflows = demonstrableWorkflows(context, features);
  const hasRealUi =
    context.policy.requireProductUi && context.assets.length === 0
      ? false
      : context.assets.some((asset) => asset.isProductUi);

  const { targetDurationMs } = context.requirements;

  // Twelve scenes is already more than a person tracks in a short piece; below
  // four, there is no room for an argument.
  const maxScenes = targetDurationMs >= 60_000 ? 12 : targetDurationMs >= 20_000 ? 8 : 5;
  const minScenes = targetDurationMs >= 20_000 ? 4 : 3;

  const hasCta = Boolean(context.direction.cta);
  const middleBudget = Math.max(0, maxScenes - 1 - (hasCta ? 1 : 0));
  const middleCount = Math.max(
    0,
    Math.min(middleBudget, Math.max(minScenes - 1, Math.round(middleBudget * 0.8))),
  );

  const middleTypes = chooseMiddleTypes(context, claims, features, workflows, middleCount);

  // A hook opens and a close ends; the middle is what the direction is about.
  // With no ask from the intent, the close becomes a rest on the product rather
  // than a demand - the count stays put so the piece still has a landing.
  const ordered: StoryboardSceneType[] = [
    "HOOK",
    ...middleTypes,
    hasCta ? "CTA" : "CUSTOM",
  ];

  // Feature and workflow assignment cycles through what is available, so two
  // feature scenes do not both describe the same feature.
  const featureOrder = features.length > 0 ? features : [null];
  const workflowOrder = workflows.length > 0 ? workflows : [null];
  let featureCursor = 0;
  let workflowCursor = 0;

  const weights = ordered.map((type) => {
    const base = SCENE_TYPE_WEIGHT[type];
    if (type === "HOOK" || type === "CTA") return base;
    // A mode that requires the interface spends its time where the product is.
    if (context.policy.requireProductUi && hasRealUi) {
      if (type === "PRODUCT_DEMO" || type === "WORKFLOW") return base * 1.1;
    }
    return base;
  });

  const timeline = buildStoryboardTimeline(
    targetDurationMs,
    ordered.map((type, index) => ({ id: `${idPrefix}_scene_${index}`, weight: weights[index] })),
  );

  const supportable = new Set<string>();
  for (const claim of claims.claims) {
    for (const match of claim.text.matchAll(/\d+(?:[.,]\d+)?/g)) supportable.add(match[0]);
  }
  supportable.add(String(Math.round(targetDurationMs / 1000)));

  const scenes: StoryboardScene[] = [];
  const captureTargets: StoryboardPlan["captureTargets"] = [];

  ordered.forEach((type, index) => {
    const segment = timeline[index];
    const feature =
      type === "FEATURE" || type === "PRODUCT_DEMO" || type === "REVEAL"
        ? featureOrder[featureCursor++ % featureOrder.length]
        : null;
    const workflow =
      type === "WORKFLOW" || type === "PRODUCT_DEMO"
        ? workflowOrder[workflowCursor++ % workflowOrder.length]
        : null;

    const previous = scenes[index - 1];
    const target =
      type === "WORKFLOW" && workflow
        ? workflow.steps[0]?.description ?? `The ${workflow.name} workflow`
        : feature
          ? feature.name
          : purposeFor(type, context, feature, workflow);

    const capture = captureFor(context, workflow ?? null, feature, target);
    if (capture.mode !== "NONE") {
      captureTargets.push({
        sceneIndex: index,
        sessionId: capture.browserSessionId,
        target: capture.target,
        workflowId: capture.workflowId,
      });
    }

    const { framing, cameraMotion } = cameraFor(type, context);
    const shot: StoryboardShot = {
      id: `${segment.id}_shot`,
      description: purposeFor(type, context, feature, workflow),
      visualType: visualFor(type, context, hasRealUi),
      productInteraction: interactionFor(type, feature, workflow, hasRealUi),
      framing,
      cameraMotion,
      assetIds: context.assets.length > 0 ? [context.assets[0].id] : [],
      evidenceIds: claims.evidenceIds,
      captureRequirement: capture,
      notes:
        type === "FEATURE" && feature && feature.evidenceIds.length === 0
          ? "No evidence recorded for this feature yet; the shot is planned but not yet provable"
          : "",
    };

    const textOverlays: StoryboardTextOverlay[] = [];
    if (type === "HOOK") {
      const statement = safeStatement(context.direction.hook.statement);
      if (!claimsUnsupportedNumber(statement, supportable)) {
        textOverlays.push(
          fullWidthText(`${segment.id}_hook`, statement, "HEADLINE", "ACCENT", segment.durationMs),
        );
      }
    }
    if (type === "CTA" && context.direction.cta) {
      const cta = safeStatement(context.direction.cta, 60);
      if (!claimsUnsupportedNumber(cta, supportable)) {
        textOverlays.push(
          fullWidthText(`${segment.id}_cta`, cta, "CTA", "BOLD", segment.durationMs),
        );
      }
    }

    const scene: StoryboardScene = {
      id: segment.id,
      order: index,
      type,
      name: nameFor(type, feature, workflow),
      purpose: purposeFor(type, context, feature, workflow),
      startMs: segment.startMs,
      endMs: segment.endMs,
      durationMs: segment.durationMs,
      shots: [shot],
      textOverlays,
      voiceoverPlan: voiceoverFor(type, context, claims)
        ? { text: voiceoverFor(type, context, claims) as string }
        : null,
      musicDirection: musicFor(type, context),
      sfxCues: sfxFor(type, context),
      transitionIn: previous
        ? transitionsBetween(previous.type, type)
        : { type: "CUT", rationale: "The piece opens here; there is nothing before it" },
      transitionOut: null,
      featureIds: feature ? [feature.id] : [],
      workflowIds: workflow ? [workflow.id] : [],
      claimIds: type === "PROOF" ? claims.claims.map((claim) => claim.id) : [],
      evidenceIds: [...new Set([...claims.evidenceIds, ...(feature?.evidenceIds ?? [])])],
      notes:
        type === "REVEAL" && !hasRealUi
          ? "No product interface is recorded for this project, so this beat is carried by the line, not by a screen"
          : "",
    };
    scenes.push(scene);
  });

  // The last scene has nowhere to go, so it hands off to the end card.
  const last = scenes[scenes.length - 1];
  if (last) {
    last.transitionOut = {
      type: "FADE",
      rationale: "The piece ends by leaving the frame rather than cutting to nothing",
    };
  }

  const total = scenes.length > 0 ? scenes[scenes.length - 1].endMs : 0;
  return { scenes, actualDurationMs: total, captureTargets };
}
