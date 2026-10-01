import { contentRecommendationService } from "../../../../../../infrastructure/services";
import {
  parseUpdateOpportunityRequest,
  recommendationRegistry,
  serializeOpportunity,
  wrapRecommendationHttpError,
} from "../../../../../../lib/recommendation-api";

import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../lib/http";

type RecommendationRouteContext = {
  params: Promise<{ id: string; recommendationId: string }>;
};

/**
 * One recommendation with its reasons and its gaps.
 *
 * A request for an id from another project is a 404, not a 403: a 403 would
 * confirm the id exists somewhere.
 */
export async function GET(request: Request, context: RecommendationRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, recommendationId } = await context.params;

    const opportunity = await contentRecommendationService.get(
      id,
      user.id,
      recommendationId,
    );

    return Response.json({
      recommendation: serializeOpportunity(opportunity),
      registry: recommendationRegistry(),
    });
  } catch (error) {
    return wrapRecommendationHttpError(error);
  }
}

/**
 * Records the user's decision about a recommendation.
 *
 * `status` is the only field this accepts. A recommendation whose rationale a
 * client could edit is a recommendation the client could use to make the server
 * say something the product graph does not contain, so every other field is
 * refused by name rather than ignored.
 */
export async function PATCH(request: Request, context: RecommendationRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, recommendationId } = await context.params;

    const changes = parseUpdateOpportunityRequest(await request.json());

    const opportunity = await contentRecommendationService.update(
      id,
      user.id,
      recommendationId,
      changes,
    );

    return Response.json({ recommendation: serializeOpportunity(opportunity) });
  } catch (error) {
    return wrapRecommendationHttpError(error);
  }
}
