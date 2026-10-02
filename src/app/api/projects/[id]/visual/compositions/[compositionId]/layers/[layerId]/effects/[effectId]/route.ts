import {
  visualCompositionService,
  visualLayerService,
} from "../../../../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../../../../lib/http";
import { visualErrorResponse as visualError } from "../../../../../../../../../../../lib/visual-http";
import { buildSceneGraph } from "../../../../../../../../../../../modules/visual-motion-engine/serialization/scene-graph";

type RouteContext = {
  params: Promise<{
    id: string;
    compositionId: string;
    layerId: string;
    effectId: string;
  }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, compositionId, layerId, effectId } = await context.params;

    await visualLayerService.deleteEffect({
      projectId: id,
      compositionId,
      layerId,
      effectId,
      userId: user.id,
    });

    const composition = await visualCompositionService.getComposition({
      projectId: id,
      compositionId,
      userId: user.id,
    });

    return Response.json({ composition: buildSceneGraph(composition) });
  } catch (error) {
    return visualError(error);
  }
}
