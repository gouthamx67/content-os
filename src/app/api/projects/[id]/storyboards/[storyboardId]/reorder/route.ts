import { storyboardService } from "../../../../../../../infrastructure/services";
import {
  isSameOrigin,
  HttpError,
  parseJsonBody,
} from "../../../../../../../lib/http";
import {
  parseReorderStoryboardSceneRequest,
  serializeStoryboard,
  wrapStoryboardHttpError,
} from "../../../../../../../lib/storyboard-api";
import { requireUser } from "../../../../../../../lib/require-auth";

type ReorderRouteContext = {
  params: Promise<{ id: string; storyboardId: string }>;
};

/**
 * Moves a scene. The response is the whole plan because a move re-times every span
 * after it, and a move that would break the piece's shape — taking the hook off
 * the top or the ask off the end — is refused with the reason rather than applied.
 */
export async function POST(request: Request, context: ReorderRouteContext) {
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

    const input = parseReorderStoryboardSceneRequest(body);
    const storyboard = await storyboardService.reorderScene({
      projectId: id,
      userId: user.id,
      storyboardId,
      sceneId: input.sceneId,
      toIndex: input.toIndex,
    });

    return Response.json({ storyboard: serializeStoryboard(storyboard) });
  } catch (error) {
    return wrapStoryboardHttpError(error);
  }
}
