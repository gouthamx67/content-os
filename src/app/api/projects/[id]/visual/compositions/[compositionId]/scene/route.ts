import { visualCompositionService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { visualErrorResponse as visualError } from "../../../../../../../../lib/visual-http";
import { readTimeMs } from "../../../../../../../../lib/visual-api";

type RouteContext = {
  params: Promise<{ id: string; compositionId: string }>;
};

/**
 * The versioned renderer scene at `?timeMs=`.
 *
 * This is the CP15 boundary: a renderer consumes exactly this, and
 * `contractVersion` is the promise that its shape only grows additively.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, compositionId } = await context.params;

    const scene = await visualCompositionService.rendererScene({
      projectId: id,
      compositionId,
      userId: user.id,
      timeMs: readTimeMs(request),
    });

    return Response.json({ scene });
  } catch (error) {
    return visualError(error);
  }
}
