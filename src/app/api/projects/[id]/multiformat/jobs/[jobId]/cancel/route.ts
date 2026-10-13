import { adaptationService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import {
  adaptationErrorResponse,
  adaptationJobView,
} from "../../../../../../../../lib/multiformat-http";

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>;
};

/** Cancels a single target, leaving its siblings running. */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id: projectId, jobId } = await context.params;

    const job = await adaptationService.cancelJob({
      projectId,
      jobId,
      userId: user.id,
    });

    return Response.json({ job: adaptationJobView(job) });
  } catch (error) {
    return adaptationErrorResponse(error);
  }
}
