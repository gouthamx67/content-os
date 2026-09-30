import { storyboardService } from "../../../../../../infrastructure/services";
import {
  serializeStoryboard,
  storyboardRegistry,
  wrapStoryboardHttpError,
} from "../../../../../../lib/storyboard-api";
import { requireUser } from "../../../../../../lib/require-auth";

type StoryboardRouteContext = {
  params: Promise<{ id: string; storyboardId: string }>;
};

/** One plan, with the vocabularies the editor offers. */
export async function GET(request: Request, context: StoryboardRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, storyboardId } = await context.params;

    const storyboard = await storyboardService.get(id, user.id, storyboardId);

    return Response.json({
      storyboard: serializeStoryboard(storyboard),
      registry: storyboardRegistry(),
    });
  } catch (error) {
    return wrapStoryboardHttpError(error);
  }
}
