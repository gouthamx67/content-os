import { storyboardService } from "../../../../../infrastructure/services";
import {
  parseStatusFilter,
  serializeStoryboard,
  storyboardRegistry,
  wrapStoryboardHttpError,
} from "../../../../../lib/storyboard-api";
import { requireUser } from "../../../../../lib/require-auth";

type StoryboardRouteContext = {
  params: Promise<{ id: string }>;
};

/** Every plan stored for this project, newest first. */
export async function GET(request: Request, context: StoryboardRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const url = new URL(request.url);

    const intentId = url.searchParams.get("intentId") ?? undefined;
    const status = parseStatusFilter(url.searchParams.get("status"));
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam === null ? undefined : Number(limitParam);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
      return Response.json(
        { error: "limit must be a whole number between 1 and 100", code: "BAD_REQUEST" },
        { status: 400 },
      );
    }

    const boards = await storyboardService.list(id, user.id, {
      ...(intentId ? { intentId } : {}),
      ...(status ? { status } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });

    return Response.json({
      storyboards: boards.map(serializeStoryboard),
      registry: storyboardRegistry(),
    });
  } catch (error) {
    return wrapStoryboardHttpError(error);
  }
}
