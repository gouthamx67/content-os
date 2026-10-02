import {
  visualCompositionService,
  visualLayerService,
} from "../../../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../../../lib/http";
import { visualErrorResponse as visualError } from "../../../../../../../../../../lib/visual-http";
import { readJsonObject, requiredString } from "../../../../../../../../../../lib/visual-api";
import { buildSceneGraph } from "../../../../../../../../../../modules/visual-motion-engine/serialization/scene-graph";

type RouteContext = {
  params: Promise<{ id: string; compositionId: string; layerId: string }>;
};

/**
 * Replaces a layer's motion with the keyframes of a named preset.
 *
 * The preset ids are a closed vocabulary, so a caller that sends a misspelling
 * gets a 400 instead of a layer that silently keeps its old motion.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, compositionId, layerId } = await context.params;
    const body = await readJsonObject(request);

    await visualLayerService.applyPreset({
      projectId: id,
      compositionId,
      layerId,
      userId: user.id,
      presetId: requiredString(body, "presetId"),
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
