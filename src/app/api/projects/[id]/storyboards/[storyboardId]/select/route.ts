import { storyboardService } from "../../../../../../../infrastructure/services";
import { isSameOrigin, HttpError } from "../../../../../../../lib/http";
import {
  serializeStoryboard,
  wrapStoryboardHttpError,
} from "../../../../../../../lib/storyboard-api";
import { requireUser } from "../../../../../../../lib/require-auth";

type SelectRouteContext = {
  params: Promise<{ id: string; storyboardId: string }>;
};

/**
 * Choosing a plan drops the intent to exactly one selection. The response carries
 * what the choice displaced, so the panel can move its own state without a second
 * request.
 */
export async function POST(request: Request, context: SelectRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, storyboardId } = await context.params;

    const outcome = await storyboardService.select(id, user.id, storyboardId);

    return Response.json({
      storyboard: serializeStoryboard(outcome.storyboard),
      demoted: outcome.demoted.map(serializeStoryboard),
    });
  } catch (error) {
    return wrapStoryboardHttpError(error);
  }
}
