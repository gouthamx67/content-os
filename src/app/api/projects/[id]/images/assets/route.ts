import {
  imageRepository,
  projectService,
} from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import {
  generatedImageAssetView,
  imageErrorResponse,
} from "../../../../../../lib/image-http";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Lists the project's generated assets, newest first.
 *
 * The library shows real rows only: a row exists because a worker wrote bytes
 * and a checksum, not because a request was accepted.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;

    await projectService.getAuthorized(id, user.id);

    const assets = await imageRepository.listAssets(id);

    return Response.json({
      assets: assets.map(generatedImageAssetView),
    });
  } catch (error) {
    return imageErrorResponse(error);
  }
}
