import { publishingService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { enforceRateLimit, RATE_LIMITS } from "../../../../../../../../lib/rate-limit";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import { publishingErrorResponse } from "../../../../../../../../lib/publishing-http";

type RouteContext = {
  params: Promise<{ id: string; publicationId: string }>;
};

/**
 * Queues a READY publication for the worker. Queuing is not publishing: the
 * confirmed record only exists after the provider actually accepts the post.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const limited = await enforceRateLimit(
      RATE_LIMITS.publishingMutation,
      user.id,
    );
    if (limited) return limited;
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }
    const { id, publicationId } = await context.params;
    const publication = await publishingService.queuePublication(
      user.id,
      id,
      publicationId,
    );
    return Response.json({ publication });
  } catch (error) {
    return publishingErrorResponse(error);
  }
}
