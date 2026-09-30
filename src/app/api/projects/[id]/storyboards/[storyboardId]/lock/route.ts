import { storyboardService } from "../../../../../../../infrastructure/services";
import { isSameOrigin, HttpError } from "../../../../../../../lib/http";
import {
  serializeStoryboard,
  wrapStoryboardHttpError,
} from "../../../../../../../lib/storyboard-api";
import { requireUser } from "../../../../../../../lib/require-auth";

type LockRouteContext = {
  params: Promise<{ id: string; storyboardId: string }>;
};

/**
 * Locks the decided plan. This is one-way: there is no unlock, because a decision
 * that can be silently un-decided is not one. Anything else that was selected for
 * the intent is archived in the same write, and the response carries both so the
 * panel shows what it displaced.
 */
export async function POST(request: Request, context: LockRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, storyboardId } = await context.params;

    const outcome = await storyboardService.lock(id, user.id, storyboardId);

    return Response.json({
      storyboard: serializeStoryboard(outcome.storyboard),
      archived: outcome.archived.map(serializeStoryboard),
    });
  } catch (error) {
    return wrapStoryboardHttpError(error);
  }
}
