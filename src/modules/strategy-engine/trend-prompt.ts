import type { RecommendationContext } from "../../core/domain/recommendation-context";
import { isGenericSubjectLabel } from "./domain/labels";
import type { TrendArticle } from "./trend-source";

export type TrendPlatformChoice = {
  id: string;
  name: string;
};

export type TrendAdaptationDraft = {
  articleUrl: string;
  whyNow: string;
  contentAngle: string;
  hook: string;
  platformId: string;
  format: string;
  proofNeeded: string;
};

export type TrendAdaptation = {
  summary: string;
  trends: TrendAdaptationDraft[];
};

export const TREND_SYSTEM_PROMPT = [
  "You are a social media strategist adapting recent public signals into content for one product.",
  "You may only use the articles supplied by the user. Never add a trend, statistic, source, date, platform result or product claim that is not in the supplied material.",
  "Every articleUrl must be copied exactly from the supplied list.",
  "Use only product capabilities that are explicitly listed in the supplied product context. If a trend needs a capability the product does not have, put the gap in proofNeeded instead of asserting the capability.",
  "Never name a product feature, module or workflow that is not in the supplied Features or Workflows list. If those lists are empty, do not name any.",
  "A recent article is a signal, not proof. Do not claim that a trend is guaranteed, measured, or proven.",
  "If no supplied article is relevant to the product and its audience, return an empty trends array.",
  "Prefer concrete tensions, format shifts and audience questions over generic 'AI is changing everything' commentary.",
  "Return only one JSON object using the allowed fields and nothing else.",
].join(" ");

export function buildTrendPrompt(
  context: RecommendationContext,
  articles: readonly TrendArticle[],
  platforms: readonly TrendPlatformChoice[],
  asOf: Date,
): string {
  const product = context.product;
  const audience = context.audienceSignals.map((signal) => signal.segment);
  const features = context.features
    .filter((feature) => !isGenericSubjectLabel(feature.name))
    .map((feature) => feature.name)
    .slice(0, 10);
  const workflows = context.workflows.map((workflow) => workflow.name).slice(0, 6);
  const problems = context.problems.map((problem) => problem.name).slice(0, 6);
  const benefits = context.benefits.map((benefit) => benefit.name).slice(0, 6);

  return [
    `Current date: ${asOf.toISOString().slice(0, 10)}`,
    "",
    "Product context:",
    product
      ? [
          `- Name: ${product.name}`,
          product.category ? `- Category: ${product.category}` : null,
          product.description ? `- Description: ${product.description}` : null,
          product.valueProposition
            ? `- Value proposition: ${product.valueProposition}`
            : null,
        ]
          .filter(Boolean)
          .join("\n")
      : "- No product record.",
    audience.length > 0 ? `- Audience: ${audience.join(", ")}` : "- Audience: not recorded",
    features.length > 0 ? `- Features: ${features.join(", ")}` : "- Features: not recorded",
    workflows.length > 0 ? `- Workflows: ${workflows.join(", ")}` : "- Workflows: not recorded",
    problems.length > 0 ? `- Problems: ${problems.join(", ")}` : "- Problems: not recorded",
    benefits.length > 0 ? `- Benefits: ${benefits.join(", ")}` : "- Benefits: not recorded",
    "",
    "Available platforms:",
    platforms.map((platform) => `- ${platform.id}: ${platform.name}`).join("\n") ||
      "- None recorded",
    "",
    "Recent public signals:",
    articles
      .map(
        (article, index) =>
          [
            `${index + 1}. ${article.title}`,
            `   source: ${article.source}`,
            `   publishedAt: ${article.publishedAt ?? "unknown"}`,
            `   url: ${article.url}`,
            article.summary ? `   summary: ${article.summary}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
      )
      .join("\n"),
    "",
    "Task: choose at most four signals that a real strategist could turn into content for this product now.",
    "For each chosen signal, explain why it is timely, the content angle, one opening hook, the platform, the format and the proof the team must capture before publishing.",
    "The angle is an argument, not a product claim. If the product capability is unproven or absent, the proofNeeded field must say so.",
    "Do not force a fit. Returning fewer items is better than inventing relevance.",
    "",
    "Response shape:",
    "{",
    '  "summary": "<one or two sentences about the pattern across the chosen signals>",',
    '  "trends": [',
    "    {",
    '      "articleUrl": "<exact url from the list>",',
    '      "whyNow": "<why this signal matters now>",',
    '      "contentAngle": "<the argument, not a topic>",',
    '      "hook": "<one opening line>",',
    '      "platformId": "<one available platform id>",',
    '      "format": "<short format name>",',
    '      "proofNeeded": "<what the team must capture or verify>"',
    "    }",
    "  ]",
    "}",
  ].join("\n");
}

export function parseTrendAdaptation(
  text: string,
  articles: readonly TrendArticle[],
  platforms: readonly TrendPlatformChoice[],
): TrendAdaptation {
  const parsed = extractJsonObject(text);
  const record = isRecord(parsed) ? parsed : {};
  const rawTrends = Array.isArray(record["trends"]) ? record["trends"] : [];
  const articleByUrl = new Map(
    articles.map((article) => [normalizeUrl(article.url), article]),
  );
  const platformIds = new Set(platforms.map((platform) => platform.id));
  const seen = new Set<string>();
  const trends: TrendAdaptationDraft[] = [];

  for (const raw of rawTrends) {
    if (!isRecord(raw)) continue;
    const articleUrl = readText(raw["articleUrl"], 2_000);
    const whyNow = readText(raw["whyNow"], 600);
    const contentAngle = readText(raw["contentAngle"], 600);
    const hook = readText(raw["hook"], 400);
    const platformId = readText(raw["platformId"], 80);
    const format = readText(raw["format"], 120);
    const proofNeeded = readText(raw["proofNeeded"], 500);
    if (
      !articleUrl ||
      !whyNow ||
      !contentAngle ||
      !hook ||
      !platformId ||
      !format ||
      !proofNeeded ||
      !platformIds.has(platformId)
    ) {
      continue;
    }

    const article = articleByUrl.get(normalizeUrl(articleUrl));
    if (!article || seen.has(article.url)) continue;
    if (
      hasUnsupportedNumericClaim(
        { whyNow, contentAngle, hook },
        article,
      )
    ) {
      continue;
    }
    seen.add(article.url);
    trends.push({
      articleUrl: article.url,
      whyNow,
      contentAngle,
      hook,
      platformId,
      format,
      proofNeeded,
    });
    if (trends.length >= 4) break;
  }

  return {
    summary: readText(record["summary"], 500) ?? "",
    trends,
  };
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error("Trend model did not return a JSON object");
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

const NUMERIC_CLAIM =
  /\b\d+(?:[.,]\d+)?\s?%|\b\d+(?:[.,]\d+)?\s?[x×]\b|\$\s?\d[\d,.]*\s?[kmb]?\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|hundred|thousand)\s?[x×]\b/gi;

function hasUnsupportedNumericClaim(
  draft: Pick<TrendAdaptationDraft, "whyNow" | "contentAngle" | "hook">,
  article: TrendArticle,
): boolean {
  const material = numericKey(
    `${article.title} ${article.summary ?? ""}`,
  );
  const text = `${draft.whyNow} ${draft.contentAngle} ${draft.hook}`;
  return [...text.matchAll(NUMERIC_CLAIM)].some(
    (match) => !material.includes(numericKey(match[0])),
  );
}

function numericKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}
