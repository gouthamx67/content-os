import { contentRecommendationService } from "../../../../../../infrastructure/services";
import {
  rejectGenerateBody,
  recommendationRegistry,
  serializeOpportunities,
  wrapRecommendationHttpError,
} from "../../../../../../lib/recommendation-api";

import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../lib/http";

type RecommendationRouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Derives the project's recommendations from its own data.
 *
 * The body is refused rather than parsed, because a request that could name a
 * feature, a platform or a subject would be able to decide the answer, and the
 * answer is only worth anything if the project chose it. Re-running is safe: it
 * is a refresh, and anything the user dismissed or selected is carried across.
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

    const opportunities = await contentRecommendationService.generate(id, user.id);

    return Response.json({
      recommendations: serializeOpportunities(opportunities),
      registry: recommendationRegistry(),
    });
  } catch (error) {
    return wrapRecommendationHttpError(error);
  }
}
