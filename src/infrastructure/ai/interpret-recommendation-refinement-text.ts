import { RecommendationError } from "../../core/domain/content-opportunity";
import type { ContentOpportunity } from "../../core/domain/content-opportunity";
import type { RecommendationContext } from "../../core/domain/recommendation-context";

export const RECOMMENDATION_REFINEMENT_SYSTEM_PROMPT = [
  "You sharpen advisory content recommendations that were already derived from a product's own intelligence.",
  "You may reorder the list and reword each item's title, rationale and reasons.",
  "You must not add, remove, merge or split items: return exactly the same keys you were given, each exactly once.",
  "The key identifies which recommendation to reword. It is opaque to you: copy it back character for character and never rewrite it.",
  "You must not change or invent any fact: no feature, claim, metric, benefit, platform, channel or subject.",
  "Every recommendation must stay grounded in the product facts provided; if you cannot ground a reason, omit the reasons field rather than guessing.",
  "Return only a JSON array of objects using the allowed fields and nothing else.",
].join(" ");

export function extractRecommendationJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Models often wrap JSON in prose; retry with the outermost brackets.
  }

  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end <= start) {
    throw new RecommendationError(
      "RECOMMENDATION_INVALID_INPUT",
      "Refinement model did not return a JSON array",
    );
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (cause) {
    throw new RecommendationError(
      "RECOMMENDATION_INVALID_INPUT",
      `Refinement model returned malformed JSON: ${
        cause instanceof Error ? cause.message : "unparseable"
      }`,
    );
  }
}

function summarizeContext(context: RecommendationContext): string {
  const lines: string[] = [];
  if (context.product) {
    const parts = [context.product.name];
    if (context.product.category) parts.push(`(${context.product.category})`);
    lines.push(`Product: ${parts.join(" ")}`);
    if (context.product.valueProposition) {
      lines.push(`Value proposition: ${context.product.valueProposition}`);
    }
  }
  if (context.audienceSignals.length > 0) {
    lines.push(
      `Audience: ${context.audienceSignals
        .map((item) => item.segment)
        .join(", ")}`,
    );
  }
  if (context.features.length > 0) {
    lines.push(
      `Features: ${context.features.slice(0, 12).map((item) => item.name).join(", ")}`,
    );
  }
  if (context.benefits.length > 0) {
    lines.push(
      `Benefits: ${context.benefits.slice(0, 12).map((item) => item.name).join(", ")}`,
    );
  }
  return lines.join("\n") || "- (none)";
}

export function buildRecommendationRefinementPrompt(
  context: RecommendationContext,
  current: readonly ContentOpportunity[],
): string {
  const items = current
    .map(
      (opportunity) =>
        [
          `- key: ${opportunity.key}`,
          `  title: ${opportunity.title}`,
          `  rationale: ${opportunity.rationale}`,
          `  reasons: ${opportunity.reasons.join("; ")}`,
        ].join("\n"),
    )
    .join("\n");

  return [
    "Task: sharpen and reorder the recommendations below. Keep every key exactly once and change nothing but the title, rationale and reasons.",
    "",
    "Product facts (grounding; do not contradict or extend):",
    summarizeContext(context),
    "",
    "Current recommendations:",
    items,
    "",
    "Response shape (return every key once; omit a field to keep its current value):",
    "[",
    '  { "key": "<key>", "title": "<title>", "rationale": "<rationale>", "reasons": ["<reason>"] }',
    "]",
  ].join("\n");
}