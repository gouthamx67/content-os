import { projectService } from "../../../../../infrastructure/services";
import { requireUser } from "../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody, wrapHttpError } from "../../../../../lib/http";

type WorkspaceProjectsRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: WorkspaceProjectsRouteContext,
) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id } = await context.params;

    const projects =
      await projectService.listForWorkspace(id, user.id);

    return Response.json({ projects });
  } catch (error) {
    return wrapHttpError(error);
  }
}

export async function POST(
  request: Request,
  context: WorkspaceProjectsRouteContext,
) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id } = await context.params;

    const body = await parseJsonBody(request);

    const project = await projectService.createForWorkspace(
      id,
      {
        name:
          typeof body?.name === "string" ? body.name : undefined,
      },
      user.id,
    );

    return Response.json({ project }, { status: 201 });
  } catch (error) {
    return wrapHttpError(error);
  }
}