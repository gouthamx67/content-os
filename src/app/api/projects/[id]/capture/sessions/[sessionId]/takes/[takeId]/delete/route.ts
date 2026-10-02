import { captureService } from "../../../../../../../../../../infrastructure/services";
import { HttpError, isSameOrigin } from "../../../../../../../../../../lib/http";
import { requireUser } from "../../../../../../../../../../lib/require-auth";
import { captureErrorResponse as captureError } from "../../../../../../../../../../lib/capture-http";

type RouteContext = {
  params: Promise<{ id: string; sessionId: string; takeId: string }>;
};

/**
 * Deletes a take's bytes and marks the row DELETED.
 *
 * The row survives on purpose: it is the only record that the shot was attempted
 * and that a take existed. Dropping it would make a delete indistinguishable
 * from a capture that never happened.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, sessionId, takeId } = await context.params;

    const take = await captureService.deleteTake({
      projectId: id,
      sessionId,
      takeId,
      userId: user.id,
    });

    return Response.json({
      take: {
        id: take.id,
        shotId: take.shotId,
        status: take.status,
        acceptedAt: take.acceptedAt,
        rejectedAt: take.rejectedAt,
        deletedAt: take.deletedAt,
      },
    });
  } catch (error) {
    return captureError(error);
  }
}
