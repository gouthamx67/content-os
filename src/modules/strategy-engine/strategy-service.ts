import type { ProjectService } from "../../core/services/project-service";
import type { RecommendationContextBuilder } from "../../core/services/recommendation-context-builder";
import type { AnalyticsService } from "../publishing-engine/analytics-service";
import type { OptimizationService } from "../publishing-engine/optimization-service";
import { buildSocialStrategy } from "./strategy-engine";
import type { SocialStrategy } from "./domain/types";

export type SocialStrategyServiceDeps = {
  projectService: Pick<ProjectService, "getAuthorized">;
  contextBuilder: Pick<RecommendationContextBuilder, "build">;
  analytics: Pick<AnalyticsService, "getOverview">;
  optimization: Pick<OptimizationService, "listRecommendations">;
  now?: () => string;
};

export class SocialStrategyService {
  constructor(private readonly deps: SocialStrategyServiceDeps) {}

  async get(userId: string, projectId: string): Promise<SocialStrategy> {
    await this.deps.projectService.getAuthorized(projectId, userId);

    const [context, overview, recommendations] = await Promise.all([
      this.deps.contextBuilder.build(projectId),
      this.deps.analytics.getOverview(userId, projectId).catch(() => null),
      this.deps.optimization
        .listRecommendations(userId, projectId)
        .catch(() => []),
    ]);

    return buildSocialStrategy({
      context,
      performance: {
        publishedCount: overview?.totals.publishedCount ?? 0,
        measuredCount: overview?.totals.measuredCount ?? 0,
        timingRecommendations: recommendations.filter(
          (recommendation) => recommendation.category === "TIMING_WINDOW",
        ),
      },
      now: (this.deps.now ?? (() => new Date().toISOString()))(),
    });
  }
}
