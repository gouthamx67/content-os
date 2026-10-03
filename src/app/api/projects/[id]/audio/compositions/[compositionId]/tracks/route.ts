import { audioCompositionService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import {
  audioErrorResponse,
  audioTrackView,
} from "../../../../../../../../lib/audio-http";

type RouteContext = {
  params: Promise<{ id: string; compositionId: string }>;
};

/**
 * Adds a track to the audio composition behind a visual composition.
 *
 * The path names the visual composition so the client never has to learn the
 * audio composition's id. Any field the client omits keeps its neutral default
 * (silence at full length is not possible — duration is required), and the
 * service validates the whole track before it is persisted.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
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

    const track = await audioCompositionService.addTrack({
      projectId: id,
      audioCompositionId: composition.id,
      userId: user.id,
      kind: body["kind"] as string,
      name: body["name"] as string,
      sourceRef: body["sourceRef"] as string,
      startMs: numberOr(body["startMs"], 0),
      sourceOffsetMs: numberOr(body["sourceOffsetMs"], 0),
      durationMs: numberOr(body["durationMs"], 0),
      gainDb: numberOr(body["gainDb"], 0),
      pan: numberOr(body["pan"], 0),
      fadeInMs: numberOr(body["fadeInMs"], 0),
      fadeOutMs: numberOr(body["fadeOutMs"], 0),
      mute: booleanOr(body["mute"], false),
      solo: booleanOr(body["solo"], false),
      duckVoiceoverDb: nullableNumberOr(body["duckVoiceoverDb"]),
    });

    return Response.json({ track: audioTrackView(track) }, { status: 201 });
  } catch (error) {
    return audioErrorResponse(error);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumberOr(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
