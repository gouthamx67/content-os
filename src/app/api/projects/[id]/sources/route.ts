import { sourceService } from "../../../../../infrastructure/services";
import { requireUser } from "../../../../../lib/require-auth";
import {
  parseJsonBody,
  wrapHttpError,
} from "../../../../../lib/http";
import { isSourceType } from "../../../../../lib/enums";
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

    return Response.json({ sources });
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

    const body = await parseJsonBody(request);

    if (!body) {
      return wrapHttpError(new Error("Invalid request body"));
    }

    const source = await sourceService.create(
      id,
      {
        type: isSourceType(body.type) ? body.type : "OTHER",
        name: typeof body.name === "string" ? body.name : "",
        uri: typeof body.uri === "string" ? body.uri : undefined,
        metadata: normalizeMetadata(body.metadata),
      },
      user.id,
    );

    return Response.json({ source }, { status: 201 });
  } catch (error) {
    return wrapHttpError(error);
  }
}