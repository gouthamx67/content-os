import { adaptationService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { adaptationErrorResponse } from "../../../../../../../lib/multiformat-http";
import { adaptationJobView } from "../../../../../../../lib/multiformat-http";

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>;
};

/**
 * One adaptation job.
 *
 * This is the poll target for a single target — the same shape the batch listing
 * returns, so a client that started from a batch never has to switch formats.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id: projectId, jobId } = await context.params;

    const job = await adaptationService.getJob({
      projectId,
      jobId,
      userId: user.id,
    });

    return Response.json({ job: adaptationJobView(job) });
  } catch (error) {
    return adaptationErrorResponse(error);
  }
}
