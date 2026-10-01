import { contentRecommendationService } from "../../../../../infrastructure/services";
import {
  parseStatusFilter,
  recommendationRegistry,
  serializeOpportunities,
  wrapRecommendationHttpError,
} from "../../../../../lib/recommendation-api";
import { requireUser } from "../../../../../lib/require-auth";

type RecommendationRouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * What the project has been told it could make.
 *
 * This is a read. Nothing is derived on the way in, so the panel loads fast and
 * a user who only wants to browse the suggestions pays nothing for them.
 */
export async function GET(request: Request, context: RecommendationRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const url = new URL(request.url);
    const status = parseStatusFilter(url.searchParams.get("status"));

    const opportunities = await contentRecommendationService.list(
      id,
      user.id,
      status ? { status } : undefined,
    );

    return Response.json({
      recommendations: serializeOpportunities(opportunities),
      registry: recommendationRegistry(),
    });
  } catch (error) {
    return wrapRecommendationHttpError(error);
  }
}
