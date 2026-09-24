import { assetService } from "../../../../../infrastructure/services";
import { requireUser } from "../../../../../lib/require-auth";
import {
  parseJsonBody,
  wrapHttpError,
} from "../../../../../lib/http";
import { isAssetType } from "../../../../../lib/enums";
import { normalizeMetadata } from "../../../../../lib/metadata";

type AssetsRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: AssetsRouteContext,
) {
  try {
    const { user } = await requireUser(request);

    const { id } = await context.params;

    const assets = await assetService.list(id, user.id);

    return Response.json({ assets });
  } catch (error) {
    return wrapHttpError(error);
  }
}

export async function POST(
  request: Request,
  context: AssetsRouteContext,
) {
  try {
    const { user } = await requireUser(request);

    const { id } = await context.params;

    const body = await parseJsonBody(request);

    if (!body) {
      return wrapHttpError(new Error("Invalid request body"));
    }

    const asset = await assetService.create(
      id,
      {
        type: isAssetType(body.type) ? body.type : "OTHER",
        name: typeof body.name === "string" ? body.name : "",
        uri: typeof body.uri === "string" ? body.uri : "",
        metadata: normalizeMetadata(body.metadata),
      },
      user.id,
    );

    return Response.json({ asset }, { status: 201 });
  } catch (error) {
    return wrapHttpError(error);
  }
}