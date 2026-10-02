import {
  visualCompositionService,
  visualLayerService,
} from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import { visualErrorResponse as visualError } from "../../../../../../../../lib/visual-http";
import {
  optionalBoolean,
  optionalCount,
  optionalEnum,
  optionalNullableNumber,
  optionalNullableString,
  optionalNumber,
  optionalString,
  readJsonObject,
  requiredEnum,
} from "../../../../../../../../lib/visual-api";
import { buildSceneGraph } from "../../../../../../../../modules/visual-motion-engine/serialization/scene-graph";
import {
  VISUAL_FIT_MODES,
  VISUAL_LAYER_TYPES,
} from "../../../../../../../../modules/visual-motion-engine/domain/types";

type RouteContext = {
  params: Promise<{ id: string; compositionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, compositionId } = await context.params;
    const body = await readJsonObject(request);

    await visualLayerService.addLayer({
      projectId: id,
      compositionId,
      userId: user.id,
      name: optionalString(body, "name"),
      type: requiredEnum(body, "type", VISUAL_LAYER_TYPES),
      assetRef: optionalString(body, "assetRef"),
      textContent: optionalNullableString(body, "textContent"),
      x: optionalNumber(body, "x"),
      y: optionalNumber(body, "y"),
      width: optionalCount(body, "width"),
      height: optionalCount(body, "height"),
      rotation: optionalNumber(body, "rotation"),
      opacity: optionalNumber(body, "opacity"),
      fit: optionalEnum(body, "fit", VISUAL_FIT_MODES),
      cropX: optionalNumber(body, "cropX"),
      cropY: optionalNumber(body, "cropY"),
      cropWidth: optionalNullableNumber(body, "cropWidth"),
      cropHeight: optionalNullableNumber(body, "cropHeight"),
      zIndex: optionalCount(body, "zIndex"),
      visible: optionalBoolean(body, "visible"),
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
