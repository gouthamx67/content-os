import { visualCompositionService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../lib/http";
import { visualErrorResponse as visualError } from "../../../../../../../lib/visual-http";
import {
  optionalCount,
  optionalEnum,
  optionalNullableString,
  optionalString,
  readJsonObject,
} from "../../../../../../../lib/visual-api";
import { buildSceneGraph } from "../../../../../../../modules/visual-motion-engine/serialization/scene-graph";
import { VISUAL_COMPOSITION_STATUSES } from "../../../../../../../modules/visual-motion-engine/domain/types";

type RouteContext = {
  params: Promise<{ id: string; compositionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, compositionId } = await context.params;

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

export async function PATCH(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, compositionId } = await context.params;
    const body = await readJsonObject(request);

    const composition = await visualCompositionService.updateComposition({
      projectId: id,
      compositionId,
      userId: user.id,
      changes: {
        name: optionalString(body, "name"),
        shotId: optionalNullableString(body, "shotId"),
        width: optionalCount(body, "width"),
        height: optionalCount(body, "height"),
        frameRate: optionalCount(body, "frameRate"),
        durationMs: optionalCount(body, "durationMs"),
        status: optionalEnum(body, "status", VISUAL_COMPOSITION_STATUSES),
      },
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
    const { id, compositionId } = await context.params;

    await visualCompositionService.deleteComposition({
      projectId: id,
      compositionId,
      userId: user.id,
    });

    return Response.json({ deleted: true });
  } catch (error) {
    return visualError(error);
  }
}
