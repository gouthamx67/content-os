import { audioCompositionService } from "../../../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../../../lib/require-auth";
import {
  audioAutomationView,
  audioErrorResponse,
} from "../../../../../../../../../../lib/audio-http";

type RouteContext = {
  params: Promise<{ id: string; compositionId: string; trackId: string }>;
};

/**
 * Upserts a single automation point on a track.
 *
 * The point is identified by (track, property, time), so posting the same time
 * twice edits the existing point instead of stacking two points at the same
 * instant. Only VOLUME_DB is accepted today.
 */
export async function POST(request: Request, context: RouteContext) {
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

    const point = await audioCompositionService.upsertAutomation({
      projectId: id,
      audioCompositionId: composition.id,
      trackId,
      userId: user.id,
      property: (body["property"] ?? "VOLUME_DB") as string,
      timeMs: body["timeMs"] as number,
      value: body["value"] as number,
      easing: (body["easing"] ?? "LINEAR") as string,
    });

    return Response.json({ automation: audioAutomationView(point) }, { status: 201 });
  } catch (error) {
    return audioErrorResponse(error);
  }
}
