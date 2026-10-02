import {
  visualCompositionService,
  visualLayerService,
} from "../../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../../lib/http";
import { visualErrorResponse as visualError } from "../../../../../../../../../lib/visual-http";
import {
  optionalBoolean,
  optionalCount,
  optionalEnum,
  optionalNullableNumber,
  optionalNullableString,
  optionalNumber,
  optionalString,
  readJsonObject,
} from "../../../../../../../../../lib/visual-api";
import { buildSceneGraph } from "../../../../../../../../../modules/visual-motion-engine/serialization/scene-graph";
import { VISUAL_FIT_MODES } from "../../../../../../../../../modules/visual-motion-engine/domain/types";

type RouteContext = {
  params: Promise<{ id: string; compositionId: string; layerId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, compositionId, layerId } = await context.params;
    const body = await readJsonObject(request);

    await visualLayerService.updateLayer({
      projectId: id,
      compositionId,
      layerId,
      userId: user.id,
      changes: {
        name: optionalString(body, "name"),
        x: optionalNumber(body, "x"),
        y: optionalNumber(body, "y"),
        width: optionalCount(body, "width"),
        height: optionalCount(body, "height"),
        rotation: optionalNumber(body, "rotation"),
        opacity: optionalNumber(body, "opacity"),
        fit: optionalEnum(body, "fit", VISUAL_FIT_MODES),
        textContent: optionalNullableString(body, "textContent"),
        cropX: optionalNumber(body, "cropX"),
        cropY: optionalNumber(body, "cropY"),
        cropWidth: optionalNullableNumber(body, "cropWidth"),
        cropHeight: optionalNullableNumber(body, "cropHeight"),
        zIndex: optionalCount(body, "zIndex"),
        visible: optionalBoolean(body, "visible"),
      },
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

export async function DELETE(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, compositionId, layerId } = await context.params;

    await visualLayerService.deleteLayer({
      projectId: id,
      compositionId,
      layerId,
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
