import { projectService, sourceService } from "../../../../../infrastructure/services";
import { requireUser } from "../../../../../lib/require-auth";
import {
  HttpError,
  parseJsonBody,
  wrapHttpError,
} from "../../../../../lib/http";
import { isSourceType } from "../../../../../lib/enums";
import { serializeSource } from "../../../../../lib/input-api";
import { normalizeMetadata } from "../../../../../lib/metadata";

type SourcesRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: SourcesRouteContext,
) {
  try {
    const { user } = await requireUser(request);

    const { id } = await context.params;

    const sources = await sourceService.list(id, user.id);

    return Response.json({ sources: sources.map(serializeSource) });
  } catch (error) {
    return wrapHttpError(error);
  }
}

export async function POST(
  request: Request,
  context: SourcesRouteContext,
) {
  try {
    const { user } = await requireUser(request);

    const { id } = await context.params;
    await projectService.getAuthorized(id, user.id);

    const body = await parseJsonBody(request);

    if (!body) {
      return wrapHttpError(new HttpError(400, "Invalid request body"));
    }

    const source = await sourceService.create(
      id,
      {
        type: isSourceType(body.type) ? body.type : "OTHER",
        name: typeof body.name === "string" ? body.name : "",
        uri: typeof body.uri === "string" ? body.uri : null,
        metadata: normalizeMetadata(body.metadata) ?? null,
      },
      user.id,
    );

    return Response.json({ source: serializeSource(source) }, { status: 201 });
  } catch (error) {
    return wrapHttpError(error);
  }
}