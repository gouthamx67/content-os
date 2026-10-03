import {
  audioCompositionService,
  audioRenderJobService,
} from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import {
  audioErrorResponse,
  audioRenderJobView,
} from "../../../../../../../../lib/audio-http";

type RouteContext = {
  params: Promise<{ id: string; compositionId: string }>;
};

/**
 * Enqueues an audio render, optionally muxing it with a finished video render.
 *
 * With no video job the result is a standalone WAV. With one, the job's output
 * format becomes MP4 and the worker muxes the two; the video render must belong
 * to this project and must already have succeeded.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, compositionId } = await context.params;

    const composition = await audioCompositionService.getByVisual(
      id,
      compositionId,
      user.id,
    );

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const videoRenderJobId =
      typeof body["videoRenderJobId"] === "string"
        ? body["videoRenderJobId"]
        : null;

    const job = await audioRenderJobService.enqueue({
      projectId: id,
      audioCompositionId: composition.id,
      userId: user.id,
      videoRenderJobId,
    });

    return Response.json({ audioRenderJob: audioRenderJobView(job) }, { status: 201 });
  } catch (error) {
    return audioErrorResponse(error);
  }
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, compositionId } = await context.params;

    const composition = await audioCompositionService.getByVisual(
      id,
      compositionId,
      user.id,
    );

    const jobs = await audioRenderJobService.list({
      projectId: id,
      userId: user.id,
      audioCompositionId: composition.id,
    });

    return Response.json({
      audioRenderJobs: jobs.map(audioRenderJobView),
    });
  } catch (error) {
    return audioErrorResponse(error);
  }
}
