import { storyboardService } from "../../../../../../../infrastructure/services";
import {
  isSameOrigin,
  HttpError,
  parseJsonBody,
} from "../../../../../../../lib/http";
import {
  parseUpdateStoryboardScenesRequest,
  serializeStoryboard,
  wrapStoryboardHttpError,
} from "../../../../../../../lib/storyboard-api";
import { requireUser } from "../../../../../../../lib/require-auth";

type ScenesRouteContext = {
  params: Promise<{ id: string; storyboardId: string }>;
};

/**
 * Edits scenes in place. The response is the whole re-timed plan rather than only
 * the edits that were applied: a change to one scene moves every span after it,
 * so returning the edited scene alone would leave the panel showing a timeline
 * that no longer exists.
 */
export async function POST(request: Request, context: ScenesRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, storyboardId } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "A JSON body is required");
    }

    const input = parseUpdateStoryboardScenesRequest(body);
    const storyboard = await storyboardService.updateScenes({
      projectId: id,
      userId: user.id,
      storyboardId,
      scenes: input.scenes,
    });

    return Response.json({ storyboard: serializeStoryboard(storyboard) });
  } catch (error) {
    return wrapStoryboardHttpError(error);
  }
}
