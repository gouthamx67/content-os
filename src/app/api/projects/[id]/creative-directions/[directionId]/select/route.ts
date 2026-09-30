import { creativeDirectorService } from "../../../../../../../infrastructure/services";
import { HttpError, isSameOrigin } from "../../../../../../../lib/http";
import {
  serializeCreativeDirection,
  wrapCreativeHttpError,
} from "../../../../../../../lib/creative-direction-api";
import { requireUser } from "../../../../../../../lib/require-auth";

type SelectRouteContext = {
  params: Promise<{ id: string; directionId: string }>;
};

/**
 * Choosing a direction drops the intent to exactly one selection. The response
 * carries what the choice displaced so the panel can move its own state without
 * a second request.
 */
export async function POST(request: Request, context: SelectRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, directionId } = await context.params;

    const outcome = await creativeDirectorService.select(id, user.id, directionId);

    return Response.json({
      direction: serializeCreativeDirection(outcome.selected),
      demoted: outcome.demoted.map(serializeCreativeDirection),
    });
  } catch (error) {
    return wrapCreativeHttpError(error);
  }
}
