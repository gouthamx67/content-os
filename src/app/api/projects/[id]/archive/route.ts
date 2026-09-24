import { projectService } from "../../../../../infrastructure/services";
import { requireUser } from "../../../../../lib/require-auth";
import { wrapHttpError } from "../../../../../lib/http";

type ArchiveRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
  request: Request,
  context: ArchiveRouteContext,
) {
  try {
    const { user } = await requireUser(request);

    const { id } = await context.params;

    const project = await projectService.archive(id, user.id);

    return Response.json({ project });
  } catch (error) {
    return wrapHttpError(error);
  }
}