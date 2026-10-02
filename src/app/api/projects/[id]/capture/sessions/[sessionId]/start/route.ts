import { captureService } from "../../../../../../../../infrastructure/services";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { CAPTURE_MODES } from "../../../../../../../../modules/capture-engine/capture-types";
import { captureErrorResponse as captureError } from "../../../../../../../../lib/capture-http";

type RouteContext = {
  params: Promise<{ id: string; sessionId: string }>;
};

/**
 * Starts a capture session.
 *
 * The body is a storyboard id and nothing else. A caller cannot name a status,
 * a creator or a project: the project is the route's own, the creator is the
 * session's user, and a status is reached only by the transitions this engine
 * allows.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, sessionId } = await context.params;

    const session = await captureService.startSession({
      projectId: id,
      sessionId,
      userId: user.id,
    });

    return Response.json({
      session: {
        id: session.id,
        projectId: session.projectId,
        storyboardId: session.storyboardId,
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
      },
      modes: CAPTURE_MODES,
    });
  } catch (error) {
    return captureError(error);
  }
}
