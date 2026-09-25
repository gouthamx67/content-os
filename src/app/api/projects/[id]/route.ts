import { assetService, projectService, sourceService } from "../../../../infrastructure/services";
import { requireUser } from "../../../../lib/require-auth";
import { serializeSource } from "../../../../lib/input-api";
import {
  parseJsonBody,
  wrapHttpError,
} from "../../../../lib/http";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
) {
  try {
    const { user } = await requireUser(request);

    const { id } = await context.params;

    const project = await projectService.getAuthorized(
      id,
      user.id,
    );

    const [sources, assets] = await Promise.all([
      sourceService.list(project.id, user.id),
      assetService.list(project.id, user.id),
    ]);

    return Response.json({
      project: { ...project, sources: sources.map(serializeSource), assets },
    });
  } catch (error) {
    return wrapHttpError(error);
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
  try {
    const { user } = await requireUser(request);

    const { id } = await context.params;

    const body = await parseJsonBody(request);

    const project = await projectService.updateAuthorized(
      id,
      {
        name:
          typeof body?.name === "string" ? body.name : undefined,
      },
      user.id,
    );

    return Response.json({ project });
  } catch (error) {
    return wrapHttpError(error);
  }
}