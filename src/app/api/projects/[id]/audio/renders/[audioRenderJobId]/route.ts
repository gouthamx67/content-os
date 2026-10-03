import { audioRenderJobService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import {
  audioArtifactView,
  audioErrorResponse,
  audioRenderJobView,
  muxedArtifactView,
} from "../../../../../../../lib/audio-http";

type RouteContext = {
  params: Promise<{ id: string; audioRenderJobId: string }>;
};

/**
 * Returns an audio job with whatever artifacts exist so far.
 *
 * The client polls this while the worker runs. Artifacts are attached as they
 * appear, so a WAV-only job reports its audio artifact and a muxed job reports
 * both; a job from another project reads as not found.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, audioRenderJobId } = await context.params;

    const job = await audioRenderJobService.get({
      projectId: id,
      audioRenderJobId,
      userId: user.id,
    });

    const [audio, muxed] = await Promise.all([
      audioRenderJobService.audioArtifact({
        projectId: id,
        audioRenderJobId,
        userId: user.id,
      }),
      audioRenderJobService.muxedArtifact({
        projectId: id,
        audioRenderJobId,
        userId: user.id,
      }),
    ]);

    return Response.json({
      audioRenderJob: audioRenderJobView(job),
      audioArtifact: audio ? audioArtifactView(audio) : null,
      muxedArtifact: muxed ? muxedArtifactView(muxed) : null,
    });
  } catch (error) {
    return audioErrorResponse(error);
  }
}
