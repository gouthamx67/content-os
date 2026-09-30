/**
 * The prompt an AI director receives. It states the project's own facts, the
 * mode's limits, and the rule that decides whether an answer is usable: every
 * claim, evidence and asset has to come from the ids it was given.
 */

import type { CreativeContext } from "../../core/domain/creative-context";
import type { CreativeMode } from "../../core/domain/creative-direction";
import { CREATIVE_ANGLES } from "../../core/domain/creative-direction";
import { CREATIVE_STYLE_LIST } from "../../core/domain/creative-style";

/**
 * The mode is named in the system prompt as well as the user prompt: the mode
 * decides what counts as a usable opening and a usable visual, so a system
 * prompt that omits it leaves the model writing in whatever register it
 * defaults to.
 */
export function creativeSystemPrompt(mode: CreativeMode): string {
  return [
    `You are a creative director working in ${mode} mode. You propose concepts, not production plans.`,
    "Return JSON only. No commentary, no markdown fences.",
  "",
  "Hard rules:",
  "- Propose the concept for one piece of content: its angle, thesis, hook, and how it would be shown and proven.",
  "- Do NOT write scenes, shot lists, timings, camera moves, or a production schedule. That is a later step.",
  "- proofStrategy.claimIds and proofStrategy.evidenceIds may only contain ids listed under the project facts.",
  "- visualStrategy.assetIds may only contain ids listed under available assets. Leave it empty if the project has no suitable asset.",
  "- Never invent a capability, a metric, a customer, a testimonial, or a feature. If the project does not record it, it does not exist.",
  "- Never state a number that is not present in a supported claim.",
  "- Write plain, specific sentences. No hype, no 'revolutionary', no 'game-changing'.",
  "",
  "Return this shape for each direction:",
  "{",
  '  "directions": [',
  "    {",
  '      "name": "short descriptive name",',
  `      "angle": one of ${CREATIVE_ANGLES.join(", ")},`,
  '      "thesis": "the one thing this piece argues",',
  '      "hook": {',
  '        "statement": "the opening line",',
  '        "mechanism": "how the opening earns attention",',
  '        "emotionalTrigger": "what the viewer should feel first"',
  "      },",
  '      "audienceAngle": "who this is for and what they care about",',
  '      "emotionalAngle": "the feeling being engineered",',
  '      "narrativeSummary": "the shape of the piece in a paragraph",',
  '      "visualStrategy": {',
  '        "approach": "the look and framing, in words",',
  '        "rationale": "why this look serves the thesis",',
  '        "productMoments": ["what the product should be seen doing"],',
  '        "assetIds": ["ids of real project assets to use"]',
  "      },",
  '      "proofStrategy": {',
  '        "claimIds": ["supported claim ids"],',
  '        "evidenceIds": ["evidence ids backing those claims"],',
  '        "proofPoints": ["how each claim would be shown, not what is claimed"]',
  "      },",
  '      "voiceDirection": "how it should sound",',
  '      "musicDirection": "music direction",',
  '      "soundDirection": "sound direction",',
  '      "cta": "the call to action, or null",',
  '      "rationale": "why this suits this project, honestly"',
  "    }",
  "  ]",
  "}",
  `Remember: you are writing in ${mode} mode. Its limits are binding, not suggestions.`,
].join("\n");
}

function factsBlock(context: CreativeContext): string {
  const product = context.product;
  const lines: string[] = [
    `Product: ${product.name || "(unnamed)"}`,
    `Description: ${product.description || "(none)"}`,
    `Value proposition: ${product.valueProposition || "(none)"}`,
    `Audience: ${product.audienceSummary || context.intent.audience || "(none given)"}`,
    "",
    `Request: ${context.intent.rawRequest}`,
    `Channel: ${context.intent.channel}`,
    `Content type: ${context.intent.contentTypeName}`,
    `Duration: ${context.intent.durationSeconds ? `${context.intent.durationSeconds}s` : "(none)"}`,
    `Platforms: ${context.intent.platforms.join(", ") || "(none)"}`,
    `Tone: ${context.intent.tone ?? "(none)"}`,
    `Call to action: ${context.intent.cta ?? "(none requested)"}`,
  ];

  if (product.features.length > 0) {
    lines.push("", "Features:");
    for (const feature of product.features.slice(0, 12)) {
      lines.push(`- ${feature.id} ${feature.name}: ${feature.description}`);
    }
  }
  if (product.problems.length > 0) {
    lines.push("", "Problems:");
    for (const problem of product.problems.slice(0, 10)) {
      lines.push(`- ${problem.id} ${problem.description}`);
    }
  }
  if (product.benefits.length > 0) {
    lines.push("", "Benefits:");
    for (const benefit of product.benefits.slice(0, 10)) {
      lines.push(`- ${benefit.id} ${benefit.description}`);
    }
  }
  if (product.workflows.length > 0) {
    lines.push("", "Workflows:");
    for (const workflow of product.workflows.slice(0, 6)) {
      lines.push(
        `- ${workflow.id} ${workflow.name}: ${workflow.steps.join(" → ")}`,
      );
    }
  }
  if (product.claims.length > 0) {
    lines.push("", "Claims (usable claim ids and their verification status):");
    for (const claim of product.claims.slice(0, 15)) {
      const usable =
        claim.verification === "SUPPORTED" ||
        claim.verification === "PARTIALLY_SUPPORTED";
      lines.push(
        `- ${claim.id} [${claim.verification}${usable ? "" : " - NOT USABLE"}] ${claim.text}`,
      );
    }
  }

  return lines.join("\n");
}

function assetsBlock(context: CreativeContext): string {
  if (context.assets.length === 0) {
    return "This project has no captured assets. visualStrategy.assetIds must be empty.";
  }
  return [
    "Available assets (use these ids or none):",
    ...context.assets.map(
      (asset) =>
        `- ${asset.id} [${asset.type}${asset.role ? `/${asset.role}` : ""}${
          asset.isProductUi ? ", product UI" : ""
        }] ${asset.name}`,
    ),
  ].join("\n");
}

function evidenceBlock(context: CreativeContext): string {
  if (context.evidence.length === 0) {
    return "This project has no recorded evidence. proofStrategy.evidenceIds must be empty, and no claim may be described as verified or tested.";
  }
  return [
    "Recorded evidence (use these ids or none):",
    ...context.evidence.map(
      (item) =>
        `- ${item.id} [${item.kind}] ${item.locator}${
          item.snippet ? `: ${item.snippet.slice(0, 160)}` : ""
        }`,
    ),
  ].join("\n");
}

function brandBlock(context: CreativeContext): string {
  const brand = context.brand;
  if (!brand.name && !brand.executionSummary) {
    return "No brand profile is recorded. Write in a plain, neutral voice and do not assume a brand tone.";
  }
  return [
    `Brand: ${brand.name || "(unnamed)"}`,
    `Positioning: ${brand.summary || "(none)"}`,
    `Voice: ${brand.executionSummary || "(none)"}`,
    `Tone signals: ${brand.tone.join(", ") || "(none)"}`,
    `Visual style: ${brand.style.join(", ") || "(none)"}`,
  ].join("\n");
}

function policyBlock(context: CreativeContext): string {
  const policy = context.policy;
  return [
    `Mode: ${policy.mode} - ${policy.description}`,
    `Metaphors: ${policy.allowMetaphor ? "allowed" : "not allowed"}`,
    `Experimental openings: ${policy.allowExperimentalHooks ? "allowed" : "not allowed"}`,
    `Real product UI: ${policy.requireProductUi ? "required" : "preferred, not required"}`,
    `Conceptual visuals instead of the product: ${
      policy.allowConceptualVisuals ? "allowed" : "not allowed"
    }`,
    `Angles to consider: ${policy.allowedAngles.join(", ")}`,
    "Unverified claims allowed: 0, in every mode.",
  ].join("\n");
}

function stylesBlock(): string {
  return [
    "Framings to draw from (pick distinct ones):",
    ...CREATIVE_STYLE_LIST.map(
      (style) =>
        `- ${style.id}: ${style.description} Best for: ${style.bestFor} Avoid when: ${style.avoidWhen}`,
    ),
  ].join("\n");
}

export function buildCreativePrompt(
  context: CreativeContext,
  count: number,
): string {
  return [
    `Propose ${count} distinct creative directions for this project.`,
    "",
    "## Mode limits",
    policyBlock(context),
    "",
    "## Project facts",
    factsBlock(context),
    "",
    "## Brand",
    brandBlock(context),
    "",
    "## Assets",
    assetsBlock(context),
    "",
    "## Evidence",
    evidenceBlock(context),
    "",
    "## Framings",
    stylesBlock(),
  ].join("\n");
}

/**
 * Pulls the first JSON value out of a model response. A bare array is read as
 * readily as the wrapped object, because that is what models return when they
 * answer the "directions" shape loosely. Providers also wrap JSON in prose more
 * often than they should, and a response with nothing parseable in it is a
 * provider failure rather than a direction with no content.
 */
export function extractCreativeJson(text: string): unknown {
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
  const arrayStart = body.indexOf("[");
  const arrayEnd = body.lastIndexOf("]");

  // Whichever bracket closes first is the one the model actually wrote, so a
  // truncated list is not completed by a later object mentioned in prose.
  const start = Math.min(
    ...[arrayStart, objectStart].filter((index) => index !== -1),
  );
  const end = Math.max(arrayEnd, objectEnd);
  if (start === Infinity || end <= start) {
    throw new Error(
      "The creative director did not return a JSON object or array in its response",
    );
  }

  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (error) {
    throw new Error(
      `Creative director response was not valid JSON: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
}
