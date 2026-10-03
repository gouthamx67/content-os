import { imageGenerationService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import {
  imageErrorResponse,
  imageGenerationJobView,
} from "../../../../../../../../lib/image-http";

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>;
};

/**
 * Requests cancellation.
 *
 * A queued job is cancelled outright; a running job is marked so the worker
 * stops after its current step. A finished job is returned unchanged.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, jobId } = await context.params;

    const job = await imageGenerationService.cancel({
      projectId: id,
      jobId,
      userId: user.id,
    });

    return Response.json({ imageGenerationJob: imageGenerationJobView(job) });
  } catch (error) {
    return imageErrorResponse(error);
  }
}
