import {
  imageRepository,
  projectService,
} from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../lib/http";
import {
  generatedImageAssetView,
  imageErrorResponse,
} from "../../../../../../../lib/image-http";
import { deleteGeneratedAsset } from "../../../../../../../modules/image-generation/delete-asset";

type RouteContext = {
  params: Promise<{ id: string; assetId: string }>;
};

const authorizeProject = async (projectId: string, userId: string) => {
  await projectService.getAuthorized(projectId, userId);
};

/** Reads one generated asset's metadata. The bytes live on the stream route. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, assetId } = await context.params;

    await authorizeProject(id, user.id);

    const asset = await imageRepository.getAsset(id, assetId);
    if (!asset) {
      throw new HttpError(404, "Generated image asset not found");
    }

    return Response.json({ asset: generatedImageAssetView(asset) });
  } catch (error) {
    return imageErrorResponse(error);
  }
}

/** Soft-deletes the asset; the row remains for audit but becomes unreachable. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, assetId } = await context.params;

    await deleteGeneratedAsset(
      { repository: imageRepository, authorizeProject },
      { projectId: id, assetId, userId: user.id },
    );

    return Response.json({ ok: true });
  } catch (error) {
    return imageErrorResponse(error);
  }
}
