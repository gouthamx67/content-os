import { readFile } from "node:fs/promises";
import type { StorageProvider } from "../../../core/ports/storage-provider";
import { ImageGenerationError } from "../errors";
import type { ImageStorage } from "../storage/image-storage";
import { parseAssetReference } from "./asset-reference";

export type ProjectAssetSource = { uri: string; name: string };
export type GeneratedAssetSource = { storageKey: string; mimeType: string };

export type ImageSourceDependencies = {
  getProjectAsset(
    projectId: string,
    assetId: string,
  ): Promise<ProjectAssetSource | null>;
  getGeneratedAsset(
    projectId: string,
    assetId: string,
  ): Promise<GeneratedAssetSource | null>;
  storage: StorageProvider;
  imageStorage: ImageStorage;
};

export type ResolvedImageSource = { bytes: Buffer; mimeType: string };

const STORAGE_URI_PREFIX = "content-os-storage://local/";

/**
 * Resolves a logical reference against the job's project. A reference that names
 * an id from another project resolves to null and becomes a hard failure, so a
 * graphic can only ever draw bytes the project already owns.
 */
export async function resolveImageSource(
  projectId: string,
  assetRef: string,
  deps: ImageSourceDependencies,
): Promise<ResolvedImageSource> {
  const { kind, id } = parseAssetReference(assetRef);

  if (kind === "product" || kind === "brand") {
    const asset = await deps.getProjectAsset(projectId, id);
    if (!asset) throw notFound(assetRef);
    if (!asset.uri.startsWith(STORAGE_URI_PREFIX)) throw notFound(assetRef);

    const key = decodeURIComponent(asset.uri.slice(STORAGE_URI_PREFIX.length));
    if (!key) throw notFound(assetRef);

    const bytes = Buffer.from(await deps.storage.get(key));
    return { bytes, mimeType: guessMime(asset.name) };
  }

  if (kind === "generated") {
    const asset = await deps.getGeneratedAsset(projectId, id);
    if (!asset) throw notFound(assetRef);
    const bytes = await readFile(deps.imageStorage.absolutePath(asset.storageKey));
    return { bytes, mimeType: asset.mimeType };
  }

  throw notFound(assetRef);
}

function notFound(reference: string): ImageGenerationError {
  return new ImageGenerationError(
    "IMAGE_SOURCE_NOT_FOUND",
    `Image source is not available to this project: ${reference}`,
    422,
  );
}

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}
