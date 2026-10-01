import { contentRecommendationService } from "../../../../../../../infrastructure/services";
import {
  serializeOpportunity,
  wrapRecommendationHttpError,
} from "../../../../../../../lib/recommendation-api";

import { requireUser } from "../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../lib/http";

type RecommendationRouteContext = {
  params: Promise<{ id: string; recommendationId: string }>;
};

/**
 * Takes a recommendation up: creates a CP09 content intent from it.
 *
 * The intent is resolved by CP09 itself, not written here. This route hands over
 * a phrasing the parser can read and lets the intent pipeline own the content
 * type, platforms and subjects — duplicating those decisions here is how the two
 * halves would drift apart.
 *
 * Safe to call twice: the second call returns the intent the first one created
 * rather than making a second copy of the same request.
 */
export async function POST(request: Request, context: RecommendationRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, recommendationId } = await context.params;

    const { recommendation, intentId } = await contentRecommendationService.select(
      id,
      user.id,
      recommendationId,
    );

    return Response.json({
      recommendation: serializeOpportunity(recommendation),
      intentId,
    });
  } catch (error) {
    return wrapRecommendationHttpError(error);
  }
}
