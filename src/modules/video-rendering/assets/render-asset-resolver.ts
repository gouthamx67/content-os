import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { CaptureRepository } from "../../../core/ports/capture-repository";
import type { AssetRepository } from "../../../core/ports/asset-repository";
import type { ImageGenerationRepository } from "../../../core/ports/image-generation-repository";
import type { StorageProvider } from "../../../core/ports/storage-provider";
import type { CaptureStorage } from "../../capture-engine/storage/capture-storage";
import type { ImageStorage } from "../../image-generation/storage/image-storage";
import { RenderFeatureError } from "../errors";
import type { CompilerAsset } from "../ffmpeg/compile-scene";

export type RenderAssetDependencies = {
  captures: CaptureRepository;
  assets: AssetRepository;
  images: ImageGenerationRepository;
  captureStorage: CaptureStorage;
  imageStorage: ImageStorage;
  storage: StorageProvider;
  probe?: (filePath: string) => Promise<{ width: number | null; height: number | null }>;
};

const STORAGE_URI_PREFIX = "content-os-storage://local/";

/**
 * Turns a logical `capture:` / `asset:` reference into a local file inside the
 * render work directory.
 *
 * The reference is resolved against the job's project, so a reference that
 * names an id from another project resolves to nothing rather than to bytes the
 * project does not own. A reference this engine cannot resolve is a hard
 * failure: silently dropping a media layer would produce a render that looks
 * finished but is missing content.
 */
export class RenderAssetResolver {
  constructor(private readonly deps: RenderAssetDependencies) {}

  async resolve(
    projectId: string,
    assetRef: string,
    workDir: string,
    index: number,
  ): Promise<CompilerAsset> {
    const [kind, id] = splitRef(assetRef);

    if (kind === "capture") {
      return this.resolveCapture(projectId, id, workDir, index);
    }

    if (kind === "asset") {
      return this.resolveAsset(projectId, id, workDir, index);
    }

    if (kind === "generated") {
      return this.resolveGenerated(projectId, id, workDir, index);
    }

    throw new RenderFeatureError(
      "UNSUPPORTED_ASSET_REF",
      `Unsupported asset reference: ${assetRef}`,
    );
  }

  private async resolveGenerated(
    projectId: string,
    assetId: string,
    workDir: string,
    index: number,
  ): Promise<CompilerAsset> {
    const asset = await this.deps.images.getAsset(projectId, assetId);

    if (!asset) {
      throw new RenderFeatureError(
        "ASSET_NOT_FOUND",
        `Generated image ${assetId} is not available to this project`,
      );
    }

    const kind = mediaKindFor(asset.mimeType);
    const filePath = path.join(
      workDir,
      `asset-${index}-${safeName(assetId)}${extensionFor(kind)}`,
    );

    await mkdir(workDir, { recursive: true });
    await writeStreamToFile(this.deps.imageStorage.read(asset.storageKey), filePath);

    const probed = await this.probe(filePath);
    return { path: filePath, kind, ...probed };
  }

  private async resolveCapture(
    projectId: string,
    takeId: string,
    workDir: string,
    index: number,
  ): Promise<CompilerAsset> {
    const take = await this.deps.captures.getTake(projectId, takeId);

    if (!take || take.status === "DELETED" || take.status === "REJECTED") {
      throw new RenderFeatureError(
        "CAPTURE_NOT_FOUND",
        `Capture ${takeId} is not available to this project`,
      );
    }

    const kind = mediaKindFor(take.mimeType);
    const filePath = path.join(workDir, `asset-${index}-${safeName(takeId)}${extensionFor(kind)}`);

    await mkdir(workDir, { recursive: true });
    await writeStreamToFile(this.deps.captureStorage.read(take.storageKey), filePath);

    const probed = await this.probe(filePath);
    return { path: filePath, kind, ...probed };
  }

  private async resolveAsset(
    projectId: string,
    assetId: string,
    workDir: string,
    index: number,
  ): Promise<CompilerAsset> {
    const asset = await this.deps.assets.getById(assetId);

    if (!asset || asset.projectId !== projectId) {
      throw new RenderFeatureError(
        "ASSET_NOT_FOUND",
        `Asset ${assetId} is not available to this project`,
      );
    }

    if (!asset.uri.startsWith(STORAGE_URI_PREFIX)) {
      throw new RenderFeatureError(
        "ASSET_NOT_LOCAL",
        `Asset ${assetId} is not stored locally and cannot be rendered`,
      );
    }

    const key = decodeURIComponent(asset.uri.slice(STORAGE_URI_PREFIX.length));
    if (!key) {
      throw new RenderFeatureError("ASSET_NOT_LOCAL", `Asset ${assetId} has no storage key`);
    }

    const bytes = await this.deps.storage.get(key);
    const kind = mediaKindForMime(guessMime(asset.name));
    const filePath = path.join(workDir, `asset-${index}-${safeName(assetId)}${extensionFor(kind)}`);

    await mkdir(workDir, { recursive: true });
    await writeFile(filePath, bytes);

    const probed = await this.probe(filePath);
    return { path: filePath, kind, ...probed };
  }

  private async probe(
    filePath: string,
  ): Promise<{ width: number | null; height: number | null }> {
    if (!this.deps.probe) return { width: null, height: null };
    try {
      return await this.deps.probe(filePath);
    } catch {
      return { width: null, height: null };
    }
  }
}

function splitRef(assetRef: string): [string, string] {
  const separator = assetRef.indexOf(":");
  if (separator <= 0) {
    throw new RenderFeatureError("UNSUPPORTED_ASSET_REF", `Invalid asset reference: ${assetRef}`);
  }
  return [assetRef.slice(0, separator), assetRef.slice(separator + 1)];
}

function mediaKindFor(mimeType: string): "image" | "video" {
  return mediaKindForMime(mimeType);
}

function mediaKindForMime(mimeType: string): "image" | "video" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  throw new RenderFeatureError(
    "UNSUPPORTED_MEDIA_TYPE",
    `Only image and video layers can be rendered, got ${mimeType || "unknown"}`,
  );
}

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp)$/.test(lower)) return "image/png";
  if (/\.(mp4|webm|mov|m4v|mkv)$/.test(lower)) return "video/mp4";
  throw new RenderFeatureError(
    "UNSUPPORTED_MEDIA_TYPE",
    `Cannot infer a media type for asset ${name}`,
  );
}

function extensionFor(kind: "image" | "video"): string {
  return kind === "image" ? ".png" : ".mp4";
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
}

function writeStreamToFile(source: Readable, target: string): Promise<void> {
  return pipeline(source, createWriteStream(target));
}
