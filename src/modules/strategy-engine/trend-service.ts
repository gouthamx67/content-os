import type { ProjectService } from "../../core/services/project-service";
import type { RecommendationContextBuilder } from "../../core/services/recommendation-context-builder";
import type { RecommendationContext } from "../../core/domain/recommendation-context";
import { getPlatform } from "../../core/domain/platform";
import type { AIProvider } from "../../core/ports/ai-provider";
import type { StrategyTrendItem, StrategyTrendLayer } from "./domain/types";
import type { TrendArticle, TrendArticleSource } from "./trend-source";
import {
  buildTrendPrompt,
  parseTrendAdaptation,
  TREND_SYSTEM_PROMPT,
  type TrendPlatformChoice,
} from "./trend-prompt";

export type SocialTrendServiceDeps = {
  projectService: Pick<ProjectService, "getAuthorized">;
  contextBuilder: Pick<RecommendationContextBuilder, "build">;
  source: TrendArticleSource;
  ai: AIProvider | null;
  now?: () => Date;
};

const FALLBACK_PLATFORMS: TrendPlatformChoice[] = [
  { id: "linkedin", name: "LinkedIn" },
  { id: "x", name: "X" },
  { id: "youtube", name: "YouTube" },
];

export class SocialTrendService {
  constructor(private readonly deps: SocialTrendServiceDeps) {}

  async get(userId: string, projectId: string): Promise<StrategyTrendLayer> {
    await this.deps.projectService.getAuthorized(projectId, userId);
    const context = await this.deps.contextBuilder.build(projectId);
    const now = (this.deps.now ?? (() => new Date()))();

    if (!this.deps.ai) {
      return {
        status: "DISABLED",
        asOf: now.toISOString(),
        summary:
          "AI trend adaptation is not configured. The strategy is still grounded in the project's own evidence.",
        items: [],
      };
    }

    const platforms = resolvePlatforms(context);
    let articles: TrendArticle[];
    try {
      articles = await this.deps.source.latest(
        buildTrendQuery(context, now),
        now,
      );
    } catch {
      return unavailable(
        now,
        "Recent public signals could not be loaded. No trend was inferred.",
      );
    }

    if (articles.length === 0) {
      return unavailable(
        now,
        "No recent public signal matched this project. No trend was inferred.",
      );
    }

    try {
      const response = await this.deps.ai.generate({
        model: undefined,
        temperature: 0.2,
        messages: [
          { role: "system", content: TREND_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildTrendPrompt(context, articles, platforms, now),
          },
        ],
        metadata: { purpose: "social-trend-adaptation", projectId },
      });
      const adaptation = parseTrendAdaptation(
        response.text,
        articles,
        platforms,
      );
      const articleByUrl = new Map(
        articles.map((article) => [article.url, article]),
      );

      const items: StrategyTrendItem[] = adaptation.trends.flatMap(
        (trend, index) => {
          const article = articleByUrl.get(trend.articleUrl);
          const platform = platforms.find(
            (candidate) => candidate.id === trend.platformId,
          );
          if (!article || !platform) return [];
          return [
            {
              id: `trend_${index + 1}`,
              title: article.title,
              source: article.source,
              sourceUrl: article.url,
              publishedAt: article.publishedAt,
              whyNow: trend.whyNow,
              contentAngle: trend.contentAngle,
              hook: trend.hook,
              platformId: platform.id,
              platformName: platform.name,
              format: trend.format,
              proofNeeded: trend.proofNeeded,
            },
          ];
        },
      );

      return {
        status: "READY",
        asOf: now.toISOString(),
        summary:
          adaptation.summary ||
          (items.length > 0
            ? `${items.length} recent signal(s) adapted into content plays.`
            : "No recent signal was relevant enough to adapt."),
        items,
      };
    } catch {
      return unavailable(
        now,
        "The trend model did not return a usable adaptation. No trend was inferred.",
      );
    }
  }
}

function resolvePlatforms(
  context: RecommendationContext,
): TrendPlatformChoice[] {
  const configured = context.availablePlatforms.flatMap((id) => {
    const platform = getPlatform(id);
    return platform ? [{ id: platform.id, name: platform.name }] : [];
  });
  return configured.length > 0 ? configured : FALLBACK_PLATFORMS;
}

function buildTrendQuery(context: RecommendationContext, asOf: Date): string {
  const audience = context.audienceSignals[0]?.segment;
  const terms = [
    context.product?.category,
    audience,
    "social media marketing",
    `${asOf.getUTCFullYear()} trends`,
  ].filter((term): term is string => Boolean(term?.trim()));
  return terms.join(" ").slice(0, 180);
}

function unavailable(now: Date, summary: string): StrategyTrendLayer {
  return {
    status: "UNAVAILABLE",
    asOf: now.toISOString(),
    summary,
    items: [],
  };
}
