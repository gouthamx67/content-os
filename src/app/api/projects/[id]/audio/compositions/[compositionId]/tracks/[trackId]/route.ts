import { audioCompositionService } from "../../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../../lib/require-auth";
import {
  audioErrorResponse,
  audioTrackView,
} from "../../../../../../../../../lib/audio-http";
import type { UpdateAudioTrackInput } from "../../../../../../../../../core/ports/audio-repository";

type RouteContext = {
  params: Promise<{ id: string; compositionId: string; trackId: string }>;
};

const MUTABLE_FIELDS = [
  "kind",
  "name",
  "sourceRef",
  "startMs",
  "sourceOffsetMs",
  "durationMs",
  "gainDb",
  "pan",
  "fadeInMs",
  "fadeOutMs",
  "mute",
  "solo",
  "duckVoiceoverDb",
] as const;

/**
 * Edits one track.
 *
 * Only the fields on the allow-list can be changed. In particular neither the
 * owning composition nor the composition id is ever taken from the body, so a
 * track cannot be moved to another composition or project.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, compositionId, trackId } = await context.params;

    const composition = await audioCompositionService.getByVisual(
      id,
      compositionId,
      user.id,
    );

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const changes: Record<string, unknown> = {};
    for (const field of MUTABLE_FIELDS) {
      if (field in body) changes[field] = body[field];
    }

    const track = await audioCompositionService.updateTrack({
      projectId: id,
      audioCompositionId: composition.id,
      trackId,
      userId: user.id,
      changes: changes as UpdateAudioTrackInput,
    });

    return Response.json({ track: audioTrackView(track) });
  } catch (error) {
    return audioErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, compositionId, trackId } = await context.params;

    const composition = await audioCompositionService.getByVisual(
      id,
      compositionId,
      user.id,
    );

    await audioCompositionService.deleteTrack({
      projectId: id,
      audioCompositionId: composition.id,
      trackId,
      userId: user.id,
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    return audioErrorResponse(error);
  }
}
