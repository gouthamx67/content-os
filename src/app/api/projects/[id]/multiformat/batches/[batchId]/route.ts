import { adaptationService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import {
  adaptationBatchDetailView,
  adaptationErrorResponse,
} from "../../../../../../../lib/multiformat-http";

type RouteContext = {
  params: Promise<{ id: string; batchId: string }>;
};

/**
 * One batch with all of its jobs.
 *
 * Polling this is how a client follows a run: the batch's `progressPct` and each
 * job's status come straight from the rows the worker is writing.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id: projectId, batchId } = await context.params;

    const detail = await adaptationService.getBatch({
      projectId,
      batchId,
      userId: user.id,
    });

    return Response.json(adaptationBatchDetailView(detail));
  } catch (error) {
    return adaptationErrorResponse(error);
  }
}
