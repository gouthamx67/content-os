import { audioRenderJobService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import {
  audioErrorResponse,
  audioRenderJobView,
} from "../../../../../../../../lib/audio-http";

type RouteContext = {
  params: Promise<{ id: string; audioRenderJobId: string }>;
};

/**
 * Requests cancellation of an audio render.
 *
 * A queued job is cancelled outright; a running one is marked CANCEL_REQUESTED
 * and the worker aborts its FFmpeg process. A terminal job is returned
 * unchanged, so cancellation is idempotent and never rewrites a finished row.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, audioRenderJobId } = await context.params;

    const job = await audioRenderJobService.cancel({
      projectId: id,
      audioRenderJobId,
      userId: user.id,
    });

    return Response.json({ audioRenderJob: audioRenderJobView(job) });
  } catch (error) {
    return audioErrorResponse(error);
  }
}
