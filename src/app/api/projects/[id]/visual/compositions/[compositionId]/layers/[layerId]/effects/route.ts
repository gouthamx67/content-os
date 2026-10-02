import {
  visualCompositionService,
  visualLayerService,
} from "../../../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../../../lib/http";
import { visualErrorResponse as visualError } from "../../../../../../../../../../lib/visual-http";
import {
  optionalBoolean,
  readJsonObject,
  requiredEnum,
  requiredNumber,
} from "../../../../../../../../../../lib/visual-api";
import { buildSceneGraph } from "../../../../../../../../../../modules/visual-motion-engine/serialization/scene-graph";
import { VISUAL_EFFECT_TYPES } from "../../../../../../../../../../modules/visual-motion-engine/domain/types";

type RouteContext = {
  params: Promise<{ id: string; compositionId: string; layerId: string }>;
};

/**
 * Upserts one effect per type on a layer: setting GRAYSCALE twice adjusts the
 * same effect instead of tinting the layer twice.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, compositionId, layerId } = await context.params;
    const body = await readJsonObject(request);

    await visualLayerService.setEffect({
      projectId: id,
      compositionId,
      layerId,
      userId: user.id,
      type: requiredEnum(body, "type", VISUAL_EFFECT_TYPES),
      amount: requiredNumber(body, "amount"),
      enabled: optionalBoolean(body, "enabled"),
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
