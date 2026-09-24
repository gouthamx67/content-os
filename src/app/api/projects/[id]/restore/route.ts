import { projectService } from "../../../../../infrastructure/services";
import { requireUser } from "../../../../../lib/require-auth";
import { wrapHttpError } from "../../../../../lib/http";

type RestoreRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(
  request: Request,
  context: RestoreRouteContext,
) {
  try {
    const { user } = await requireUser(request);

    const { id } = await context.params;

    const project = await projectService.restore(id, user.id);

    return Response.json({ project });
  } catch (error) {
    return wrapHttpError(error);
  }
}