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
 * Records that the user is not interested.
 *
 * A dismissal survives every later refresh, because identity is the stable key
 * rather than the row id: the same feature stays dismissed however its wording,
 * its score or the project around it changes.
 */
export async function POST(request: Request, context: RecommendationRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, recommendationId } = await context.params;

    const opportunity = await contentRecommendationService.dismiss(
      id,
      user.id,
      recommendationId,
    );

    return Response.json({ recommendation: serializeOpportunity(opportunity) });
  } catch (error) {
    return wrapRecommendationHttpError(error);
  }
}
