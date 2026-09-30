import { creativeDirectorService } from "../../../../../../infrastructure/services";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../lib/http";
import {
  creativeRegistry,
  parseCreativeDirectionEditRequest,
  serializeCreativeDirection,
  wrapCreativeHttpError,
} from "../../../../../../lib/creative-direction-api";
import { requireUser } from "../../../../../../lib/require-auth";

type CreativeRouteContext = {
  params: Promise<{ id: string; directionId: string }>;
};

export async function GET(request: Request, context: CreativeRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, directionId } = await context.params;
    const direction = await creativeDirectorService.get(id, user.id, directionId);

    return Response.json({
      direction: serializeCreativeDirection(direction),
      registry: creativeRegistry(),
    });
  } catch (error) {
    return wrapCreativeHttpError(error);
  }
}

/**
 * An edit re-validates the whole direction against the project's own material,
 * the same rules generation did. A thesis that grows a number no claim backs is
 * rejected here as it would have been on the way in.
 */
export async function PATCH(request: Request, context: CreativeRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, directionId } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "A JSON body is required");
    }

    const edit = parseCreativeDirectionEditRequest(body);
    const direction = await creativeDirectorService.update({
      projectId: id,
      userId: user.id,
      directionId,
      patch: edit,
    });

    return Response.json({
      direction: serializeCreativeDirection(direction),
      registry: creativeRegistry(),
    });
  } catch (error) {
    return wrapCreativeHttpError(error);
  }
}
