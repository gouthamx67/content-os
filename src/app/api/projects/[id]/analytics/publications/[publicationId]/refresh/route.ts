import { analyticsService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { enforceRateLimit, RATE_LIMITS } from "../../../../../../../../lib/rate-limit";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import { publishingErrorResponse } from "../../../../../../../../lib/publishing-http";

type RouteContext = {
  params: Promise<{ id: string; publicationId: string }>;
};

/**
 * Requests a fresh analytics collection. The request only marks intent; the
 * worker performs the real provider call, so a response here is not a metric.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const limited = await enforceRateLimit(
      RATE_LIMITS.analyticsRefresh,
      user.id,
    );
    if (limited) return limited;
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }
    const { id, publicationId } = await context.params;
    const publication = await analyticsService.refresh(
      user.id,
      id,
      publicationId,
    );
    return Response.json({ publication }, { status: 202 });
  } catch (error) {
    return publishingErrorResponse(error);
  }
}
