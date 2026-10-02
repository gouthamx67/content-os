import {
  visualCompositionService,
  visualLayerService,
} from "../../../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../../../lib/http";
import { visualErrorResponse as visualError } from "../../../../../../../../../../lib/visual-http";
import {
  optionalEnum,
  readJsonObject,
  requiredEnum,
  requiredNumber,
} from "../../../../../../../../../../lib/visual-api";
import { buildSceneGraph } from "../../../../../../../../../../modules/visual-motion-engine/serialization/scene-graph";
import {
  MOTION_EASINGS,
  MOTION_PROPERTIES,
} from "../../../../../../../../../../modules/visual-motion-engine/domain/types";

type RouteContext = {
  params: Promise<{ id: string; compositionId: string; layerId: string }>;
};

/**
 * Upserts a keyframe on a layer.
 *
 * A keyframe is addressed by (property, timeMs), so re-sending the same pair
 * edits the segment rather than stacking a second one at the same instant.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, compositionId, layerId } = await context.params;
    const body = await readJsonObject(request);

    await visualLayerService.addKeyframe({
      projectId: id,
      compositionId,
      layerId,
      userId: user.id,
      property: requiredEnum(body, "property", MOTION_PROPERTIES),
      timeMs: requiredNumber(body, "timeMs"),
      fromValue: requiredNumber(body, "fromValue"),
      toValue: requiredNumber(body, "toValue"),
      easing: optionalEnum(body, "easing", MOTION_EASINGS),
    });

    const composition = await visualCompositionService.getComposition({
      projectId: id,
      compositionId,
      userId: user.id,
    });

    return Response.json(
      { composition: buildSceneGraph(composition) },
      { status: 201 },
    );
  } catch (error) {
    return visualError(error);
  }
}
