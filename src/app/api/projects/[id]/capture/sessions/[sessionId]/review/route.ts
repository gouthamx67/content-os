import { captureService } from "../../../../../../../../infrastructure/services";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { captureErrorResponse as captureError } from "../../../../../../../../lib/capture-http";

type RouteContext = {
  params: Promise<{ id: string; sessionId: string }>;
};

/**
 * Moves an active session into review.
 *
 * Review is a real state rather than a UI flag: it is the point where takes stop
 * arriving and decisions start, and the manifest a reviewer reads is built from
 * whatever the session held at that moment.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, sessionId } = await context.params;

    const session = await captureService.beginReview({
      projectId: id,
      sessionId,
      userId: user.id,
    });

    return Response.json({
      session: {
        id: session.id,
        projectId: session.projectId,
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
      },
    });
  } catch (error) {
    return captureError(error);
  }
}

