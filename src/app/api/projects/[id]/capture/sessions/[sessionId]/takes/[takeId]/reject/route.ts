import { captureService } from "../../../../../../../../../../infrastructure/services";
import { HttpError, isSameOrigin } from "../../../../../../../../../../lib/http";
import { requireUser } from "../../../../../../../../../../lib/require-auth";
import { captureErrorResponse as captureError } from "../../../../../../../../../../lib/capture-http";

type RouteContext = {
  params: Promise<{ id: string; sessionId: string; takeId: string }>;
};

/**
 * Rejects a take.
 *
 * The take and its bytes are kept: a rejection records that this recording was
 * not the one wanted, which is different from never having captured it. A
 * retake is a new take, not an overwrite of this one.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, sessionId, takeId } = await context.params;

    const take = await captureService.rejectTake({
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
