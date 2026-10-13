import { adaptationService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import {
  adaptationBatchDetailView,
  adaptationErrorResponse,
} from "../../../../../../../../lib/multiformat-http";

type RouteContext = {
  params: Promise<{ id: string; batchId: string }>;
};

/**
 * Cancels a batch and everything still open inside it.
 *
 * A video job parked on a CP15 render has that render cancelled too — leaving
 * FFmpeg running to produce output nobody will ever see wastes a core for minutes.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id: projectId, batchId } = await context.params;

    const detail = await adaptationService.cancelBatch({
      projectId,
      batchId,
      userId: user.id,
    });

    return Response.json(adaptationBatchDetailView(detail));
  } catch (error) {
    return adaptationErrorResponse(error);
  }
}
