import { captureService } from "../../../../../../../../../../infrastructure/services";
import { HttpError, isSameOrigin } from "../../../../../../../../../../lib/http";
import { requireUser } from "../../../../../../../../../../lib/require-auth";
import { captureErrorResponse as captureError } from "../../../../../../../../../../lib/capture-http";

type RouteContext = {
  params: Promise<{ id: string; sessionId: string; takeId: string }>;
};

/**
 * Accepts a take.
 *
 * This records a decision, not bytes: the file is already persisted and its
 * checksum unchanged, so accepting cannot alter what was captured. What it
 * changes is which take the manifest names for its shot.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, sessionId, takeId } = await context.params;

    const take = await captureService.acceptTake({
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
