import { captureService } from "../../../../../../../../infrastructure/services";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { captureErrorResponse as captureError } from "../../../../../../../../lib/capture-http";

type RouteContext = {
  params: Promise<{ id: string; sessionId: string }>;
};

/**
 * Completes a capture session.
 *
 * Completion requires at least one accepted take, checked in the service rather
 * than here: the count comes from persisted rows, so a client cannot talk its way
 * past it. The transition itself goes through the same state machine every other
 * status change does, so a completed session cannot be reopened.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, sessionId } = await context.params;

    const session = await captureService.completeSession({
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

