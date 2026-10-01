import { contentRecommendationService } from "../../../../../../infrastructure/services";
import {
  recommendationRegistry,
  rejectGenerateBody,
  serializeOpportunities,
  wrapRecommendationHttpError,
} from "../../../../../../lib/recommendation-api";

import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../lib/http";

type RecommendationRouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Re-derives the recommendations after the project changed.
 *
 * Same reconciliation as generate, different intent: this is the panel re-syncing
 * rather than the user asking what they could make. Authorization is the
 * service's job, so the route does not have to remember to do it.
 *
 * The body is refused for the same reason it is on generate: a request that could
 * name what to recommend would be able to decide the answer.
 */
export async function POST(request: Request, context: RecommendationRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id } = await context.params;

    const text = await request.text();
    if (text.trim().length > 0) {
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      rejectGenerateBody(body);
    }

    const opportunities = await contentRecommendationService.refreshForUser(
      id,
      user.id,
    );

    return Response.json({
      recommendations: serializeOpportunities(opportunities),
      registry: recommendationRegistry(),
    });
  } catch (error) {
    return wrapRecommendationHttpError(error);
  }
}
