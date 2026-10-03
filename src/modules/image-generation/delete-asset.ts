import type { ImageGenerationRepository } from "../../core/ports/image-generation-repository";
import { ImageGenerationError } from "./errors";

export type DeleteGeneratedAssetDeps = {
  repository: ImageGenerationRepository;
  authorizeProject: (projectId: string, userId: string) => Promise<void>;
};

/**
 * Soft-deletes an asset: the row stays so a job's history remains auditable, but
 * every project-scoped read filters it out and the stream route can no longer
 * reach the bytes.
 */
export async function deleteGeneratedAsset(
  deps: DeleteGeneratedAssetDeps,
  args: { projectId: string; assetId: string; userId: string },
): Promise<void> {
  await deps.authorizeProject(args.projectId, args.userId);

  const asset = await deps.repository.getAsset(args.projectId, args.assetId);
  if (!asset) {
    throw new ImageGenerationError(
      "IMAGE_ASSET_NOT_FOUND",
      "Generated image asset not found",
      404,
    );
  }

  await deps.repository.softDeleteAsset(
    args.projectId,
    asset.id,
    new Date().toISOString(),
  );
}
