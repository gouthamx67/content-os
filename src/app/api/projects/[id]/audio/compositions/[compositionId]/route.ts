import { audioService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import {
  audioCompositionView,
  audioErrorResponse,
} from "../../../../../../../lib/audio-http";

type RouteContext = {
  params: Promise<{ id: string; compositionId: string }>;
};

/**
 * Returns the audio composition behind a visual composition, creating an empty
 * one on first open.
 *
 * The compositionId in the path is the *visual* composition id: the client works
 * in terms of the video it is editing, and the audio timeline is looked up (or
 * created) from there. The project guard runs before the lookup, so a
 * composition from another project reads as not found.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, compositionId } = await context.params;

    const composition = await audioService.ensure({
      projectId: id,
      compositionId,
      userId: user.id,
    });

    return Response.json({
      audioComposition: audioCompositionView(composition),
    });
  } catch (error) {
    return audioErrorResponse(error);
  }
}
