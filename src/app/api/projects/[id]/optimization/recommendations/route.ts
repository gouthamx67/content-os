import { optimizationService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../lib/http";
import { publishingErrorResponse } from "../../../../../../lib/publishing-http";
import type { RecommendationStatus } from "../../../../../../modules/publishing-engine/domain/types";
import { RECOMMENDATION_STATUSES } from "../../../../../../modules/publishing-engine/domain/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const recommendations = await optimizationService.listRecommendations(
      user.id,
      id,
      status && RECOMMENDATION_STATUSES.includes(status as RecommendationStatus)
        ? { status: status as RecommendationStatus }
        : undefined,
    );
    return Response.json({ recommendations });
  } catch (error) {
    return publishingErrorResponse(error);
  }
}

/** Generates recommendations; below the minimum sample it reports the count. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }
    const { id } = await context.params;
    const result = await optimizationService.generate(user.id, id);
    return Response.json(result);
  } catch (error) {
    return publishingErrorResponse(error);
  }
}
