import { projectService } from "../../../../../infrastructure/services";
import { requireUser } from "../../../../../lib/require-auth";
import { HttpError, isSameOrigin, wrapHttpError } from "../../../../../lib/http";

type ArchiveRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
  request: Request,
  context: ArchiveRouteContext,
) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id } = await context.params;

    const project = await projectService.archive(id, user.id);

    return Response.json({ project });
  } catch (error) {
    return wrapHttpError(error);
  }
}