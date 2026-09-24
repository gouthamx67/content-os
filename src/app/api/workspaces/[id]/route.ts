import { workspaceService } from "../../../../infrastructure/services";
import { requireUser } from "../../../../lib/require-auth";
import { wrapHttpError } from "../../../../lib/http";

type WorkspaceRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: WorkspaceRouteContext,
) {
  try {
    const { user } = await requireUser(request);

    const { id } = await context.params;

    const membership = await workspaceService.get(id, user.id);

    return Response.json({ workspace: membership.workspace });
  } catch (error) {
    return wrapHttpError(error);
  }
}