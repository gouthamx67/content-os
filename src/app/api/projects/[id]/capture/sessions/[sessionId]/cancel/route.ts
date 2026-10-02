import { captureService } from "../../../../../../../../infrastructure/services";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { captureErrorResponse as captureError } from "../../../../../../../../lib/capture-http";

type RouteContext = {
  params: Promise<{ id: string; sessionId: string }>;
};

/**
 * Cancels a capture session.
 *
 * Takes and their bytes are left in place: cancelling records that the session
 * produced nothing usable, and a later session can be opened. Deleting what was
 * captured during it is a separate, explicit decision.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, sessionId } = await context.params;

    const session = await captureService.cancelSession({
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
