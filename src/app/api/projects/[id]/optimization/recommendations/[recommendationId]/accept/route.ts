import { optimizationService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import { publishingErrorResponse } from "../../../../../../../../lib/publishing-http";

type RouteContext = {
  params: Promise<{ id: string; recommendationId: string }>;
};

/**
 * Accepting creates a new DRAFT cloned from the recommendation's source. It
 * never validates, schedules or publishes: those stay explicit human steps.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }
    const { id, recommendationId } = await context.params;
    const result = await optimizationService.accept(
      user.id,
      id,
      recommendationId,
    );
    return Response.json(result, { status: 201 });
  } catch (error) {
    return publishingErrorResponse(error);
  }
}
