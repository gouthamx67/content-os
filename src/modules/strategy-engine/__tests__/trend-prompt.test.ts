import { describe, expect, it } from "vitest";
import { emptyRecommendationContext } from "../../../core/domain/recommendation-context";
import type { RecommendationContext } from "../../../core/domain/recommendation-context";
import type { TrendArticle } from "../trend-source";
import { buildTrendPrompt, parseTrendAdaptation, TREND_SYSTEM_PROMPT } from "../trend-prompt";

const ARTICLES: TrendArticle[] = [
  {
    title: "Short-form demos are replacing feature tours",
    url: "https://news.example.com/demo",
    source: "Google News",
    publishedAt: "2026-10-21T10:00:00.000Z",
    summary: "Buyers want to see the work happen.",
  },
  {
    title: "Marketing teams are asking for proof",
    url: "https://news.example.com/proof",
    source: "Hacker News",
    publishedAt: "2026-10-20T10:00:00.000Z",
    summary: "AI content volume is losing trust.",
  },
];

const PLATFORMS = [
  { id: "linkedin", name: "LinkedIn" },
  { id: "tiktok", name: "TikTok" },
];

describe("parseTrendAdaptation", () => {
  it("keeps only adaptations anchored to a supplied article and platform", () => {
    const parsed = parseTrendAdaptation(
      JSON.stringify({
        summary: "Demos and proof are converging.",
        trends: [
          {
            articleUrl: "https://news.example.com/demo",
            whyNow: "Feature tours are losing attention.",
            contentAngle: "Show the finished job before the interface.",
            hook: "The feature tour is dead. Show the output.",
            platformId: "tiktok",
            format: "Short video",
            proofNeeded: "Capture the output before and after.",
          },
          {
            articleUrl: "https://news.example.com/invented",
            whyNow: "Invented.",
            contentAngle: "Invented.",
            hook: "Invented.",
            platformId: "linkedin",
            format: "Text post",
            proofNeeded: "None.",
          },
          {
            articleUrl: "https://news.example.com/proof",
            whyNow: "Volume is no longer a moat.",
            contentAngle: "Make the evidence the creative.",
            hook: "Nobody needs another AI post. Show the proof.",
            platformId: "instagram",
            format: "Carousel",
            proofNeeded: "Link a measured result.",
          },
        ],
      }),
      ARTICLES,
      PLATFORMS,
    );

    expect(parsed.summary).toBe("Demos and proof are converging.");
    expect(parsed.trends).toHaveLength(1);
    expect(parsed.trends[0]?.articleUrl).toBe("https://news.example.com/demo");
    expect(parsed.trends[0]?.platformId).toBe("tiktok");
  });

  it("accepts fenced JSON without weakening the article check", () => {
    const parsed = parseTrendAdaptation(
      "```json\n" +
        JSON.stringify({
          summary: "",
          trends: [
            {
              articleUrl: "https://news.example.com/demo",
              whyNow: "Weak fit.",
              contentAngle: "Weak.",
              hook: "Weak.",
              platformId: "linkedin",
              format: "Text post",
              proofNeeded: "None.",
            },
          ],
        }) +
        "\n```",
      ARTICLES,
      PLATFORMS,
    );

    expect(parsed.trends).toHaveLength(1);
  });
});

describe("buildTrendPrompt", () => {
  it("does not present document headings as product capabilities", () => {
    const context: RecommendationContext = emptyRecommendationContext("project_1");
    context.product = {
      name: "Content OS",
      description: "Turns a product brief into social content.",
      confidence: 80,
      category: "Content marketing",
      valueProposition: "One brief, a week of content.",
      sourceIds: ["source_1"],
      evidenceIds: ["evidence_1"],
    };
    context.features = [
      {
        id: "feature_heading",
        name: "Workflow",
        description: null,
        category: "capability",
        importance: "core",
        confidence: 70,
        sourceIds: [],
        evidenceIds: [],
      },
      {
        id: "feature_specific",
        name: "Campaign calendar",
        description: null,
        category: "capability",
        importance: "core",
        confidence: 70,
        sourceIds: [],
        evidenceIds: [],
      },
    ];

    const prompt = buildTrendPrompt(context, ARTICLES, PLATFORMS, new Date("2026-10-22T00:00:00.000Z"));

    expect(prompt).toContain("Features: Campaign calendar");
    expect(prompt).not.toContain("Features: Workflow");
    expect(TREND_SYSTEM_PROMPT).toContain("If those lists are empty, do not name any.");
  });
});

describe("numeric claim guard", () => {
  const draft = (hook: string, articleUrl = "https://news.example.com/demo") => ({
    summary: "",
    trends: [
      {
        articleUrl,
        whyNow: "Attention is shifting.",
        contentAngle: "Show the evidence instead of the interface.",
        hook,
        platformId: "linkedin",
        format: "Text post",
        proofNeeded: "Capture the before and after.",
      },
    ],
  });

  it("drops a percentage the supplied article does not contain", () => {
    const parsed = parseTrendAdaptation(
      JSON.stringify(draft("70% of teams are already doing this.")),
      ARTICLES,
      PLATFORMS,
    );

    expect(parsed.trends).toHaveLength(0);
  });

  it("keeps a numeric claim that appears in the cited article", () => {
    const articleWithStat = ARTICLES.map((article, index) =>
      index === 0
        ? { ...article, summary: "70% of teams are already doing this." }
        : article,
    );
    const parsed = parseTrendAdaptation(
      JSON.stringify(draft("70% of teams are already doing this.")),
      articleWithStat,
      PLATFORMS,
    );

    expect(parsed.trends).toHaveLength(1);
  });
});
