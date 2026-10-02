import { visualCompositionService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { visualErrorResponse as visualError } from "../../../../../../../../lib/visual-http";
import { readTimeMs } from "../../../../../../../../lib/visual-api";

type RouteContext = {
  params: Promise<{ id: string; compositionId: string }>;
};

/**
 * The evaluated frame at `?timeMs=`.
 *
 * Evaluation is pure and deterministic, so the preview scrubber and the CP15
 * renderer can both call this and agree on every layer's transform to the pixel.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, compositionId } = await context.params;

    const frame = await visualCompositionService.evaluateFrame({
      projectId: id,
      compositionId,
      userId: user.id,
      timeMs: readTimeMs(request),
    });

    return Response.json({ frame });
  } catch (error) {
    return visualError(error);
  }
}
