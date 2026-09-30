/**
 * The prompt an AI storyboard planner receives.
 *
 * It is deliberately not "write a storyboard". The deterministic planner has
 * already chosen the beat sequence — that shape is a product decision — so the
 * model is told which beats exist and asked to fill them in. Handing a model the
 * beat list is the difference between a plan that reads well and a plan that is
 * structurally sound and dramatically dull, because a model left to invent the
 * shape will produce one that validates and misses the point.
 *
 * The grounded-id rules are the same ones the creative prompt uses, extended to
 * the references a scene actually carries: features, workflows, claims, evidence
 * and assets. A scene that cites something the project does not have is worse than
 * a scene that says less.
 */

import type { StoryboardContext } from "../../core/domain/storyboard-context";
import type { StoryboardSceneType } from "../../core/domain/storyboard";
import {
  STORYBOARD_TEXT_ROLES,
  STORYBOARD_TEXT_POSITIONS,
  STORYBOARD_TEXT_EMPHASIS,
  STORYBOARD_VISUAL_TYPES,
} from "../../core/domain/storyboard";

export function storyboardSystemPrompt(mode: StoryboardContext["mode"]): string {
  return [
    `You are a storyboard planner working in ${mode} mode. You fill in beats, you do not decide them.`,
    "Return JSON only. No commentary, no markdown fences.",
    "",
    "Hard rules:",
    "- The beat sequence is given to you and is already decided. Fill in each beat in order.",
    "- Return exactly one scene per given beat, in the same order. Do not add, drop, or merge beats.",
    "- Do NOT state timings. Do not return startMs, endMs, or durationMs. Timing is derived from relativeWeight.",
    "- Do NOT return ids. Identity is assigned by the system.",
    "- featureIds, workflowIds, claimIds and evidenceIds may only contain ids listed under the project facts.",
    "- Never invent a capability, a metric, a customer, a testimonial, or a feature. If the project does not record it, it does not exist.",
    "- Never state a number that is not present in a supported claim or in the brief.",
    "- Write plain, specific sentences. No hype, no 'revolutionary', no 'game-changing'.",
    "- Only include a field when you have something real to say about it. An omitted field keeps what the beat already has.",
    "",
    "Return this shape:",
    "{",
    '  "scenes": [',
    "    {",
    '      "name": "what this beat does",',
    '      "purpose": "why the viewer needs this beat here",',
    '      "shots": [',
    "        {",
    '          "description": "what is on screen",',
    `          "visualType": one of ${STORYBOARD_VISUAL_TYPES.join(", ")},`,
    '          "cameraMovement": "how the camera behaves"',
    "        }",
    "      ],",
    '      "textOverlays": [',
    "        {",
    '          "text": "the words, verbatim, as they appear",',
    `          "role": one of ${STORYBOARD_TEXT_ROLES.join(", ")},`,
    `          "position": one of ${STORYBOARD_TEXT_POSITIONS.join(", ")},`,
    `          "emphasis": one of ${STORYBOARD_TEXT_EMPHASIS.join(", ")},`,
    '          "startOffsetMs": 0,',
    '          "endOffsetMs": 1200',
    "        }",
    "      ],",
    '      "voiceoverPlan": { "text": "the narration for this beat" },',
    '      "musicDirection": "how the music behaves here",',
    '      "transitionIn": { "type": "CUT", "rationale": "why this cut is hard here" },',
    '      "relativeWeight": 1.2',
    "    }",
    "  ]",
    "}",
  ].join("\n");
}

/** The project facts a scene is allowed to cite, and nothing else. */
function projectFacts(context: StoryboardContext): string {
  const lines: string[] = [];

  if (context.product.features.length > 0) {
    lines.push("features:");
    for (const feature of context.product.features) {
      lines.push(`  ${feature.id} — ${feature.name}: ${feature.description ?? "no description"}`);
    }
  }
  if (context.product.workflows.length > 0) {
    lines.push("workflows:");
    for (const workflow of context.product.workflows) {
      const steps = workflow.steps.map((step) => step.action).join("; ");
      lines.push(`  ${workflow.id} — ${workflow.name}: ${steps}`);
    }
  }
  if (context.product.claims.length > 0) {
    lines.push("supported claims:");
    for (const claim of context.product.claims) {
      lines.push(`  ${claim.id} — ${claim.text}`);
    }
  }
  if (context.product.problems.length > 0) {
    lines.push("problems:");
    for (const problem of context.product.problems) {
      lines.push(`  ${problem.id} — ${problem.description}`);
    }
  }
  if (context.product.benefits.length > 0) {
    lines.push("benefits:");
    for (const benefit of context.product.benefits) {
      lines.push(`  ${benefit.id} — ${benefit.description}`);
    }
  }
  if (context.assets.length > 0) {
    lines.push("assets:");
    for (const asset of context.assets) {
      lines.push(`  ${asset.id} — ${asset.name} (${asset.type})`);
    }
  }
  if (lines.length === 0) {
    return "The project has no recorded features, workflows, claims or assets. Do not cite any ids.";
  }
  return lines.join("\n");
}

export function buildStoryboardPrompt(
  context: StoryboardContext,
  sceneTypes: readonly StoryboardSceneType[],
): string {
  const seconds = Math.round(context.requirements.targetDurationMs / 1000);

  return [
    `Plan a ${seconds} second ${context.requirements.contentTypeName} for ${context.requirements.platforms.join(", ")}.`,
    "",
    `The brief: ${context.requirements.rawRequest}`,
    `The audience: ${context.requirements.audience}`,
    `Tone: ${context.requirements.tone}`,
    context.requirements.cta
      ? `The piece must end on this ask: "${context.requirements.cta}"`
      : "The piece does not end on a call to action.",
    "",
    `The chosen direction is "${context.direction.name}" and it argues:`,
    context.direction.thesis,
    `It opens with: "${context.direction.hook.statement}"`,
    context.direction.narrativeSummary,
    "",
    `Fill in these ${sceneTypes.length} beats, in this order:`,
    sceneTypes.map((type, index) => `  ${index + 1}. ${type}`).join("\n"),
    "",
    "relativeWeight is how much of the piece this beat wants, relative to the",
    "others. A hook and the closing ask want more than a supporting beat. Use a",
    "number roughly between 0.5 and 3.",
    "",
    "Project facts you may cite:",
    projectFacts(context),
  ].join("\n");
}

/**
 * Pulls the scene list out of a response.
 *
 * The beat sequence is checked here rather than left to the service, because a
 * model that returned three scenes for a five-beat plan has misunderstood the
 * task, and quietly accepting the first three would store a plan missing its
 * argument. Raising lets the service fall back to the deterministic plan and say
 * why.
 */
export function extractStoryboardScenes(
  text: string,
  expectedBeats: number,
): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch (error) {
    throw new Error(
      `Storyboard planner returned unreadable output: ${
        error instanceof Error ? error.message : "not JSON"
      }`,
    );
  }

  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.scenes)
      ? parsed.scenes
      : null;

  if (!list || list.length === 0) {
    throw new Error("Storyboard planner response held no scenes");
  }
  if (list.length !== expectedBeats) {
    throw new Error(
      `Storyboard planner returned ${list.length} scenes for ${expectedBeats} beats`,
    );
  }
  if (!list.every(isRecord)) {
    throw new Error("Storyboard planner returned a scene that was not an object");
  }

  return list as Record<string, unknown>[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON, with or without a fence, with a bracket scan for a truncated reply. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(body);
  } catch {
    // fall through to a bracket scan
  }

  const objectStart = body.indexOf("{");
  const objectEnd = body.lastIndexOf("}");
  if (objectStart === -1 || objectEnd <= objectStart) {
    throw new Error("no JSON object in the response");
  }
  return JSON.parse(body.slice(objectStart, objectEnd + 1));
}
