import { Readable } from "node:stream";
import type { CaptureRepository } from "../../../core/ports/capture-repository";
import type { AssetRepository } from "../../../core/ports/asset-repository";
import type { ImageGenerationRepository } from "../../../core/ports/image-generation-repository";
import type { AdaptationRepository } from "../../../core/ports/adaptation-repository";
import type { RenderJobRepository } from "../../../core/ports/render-job-repository";
import type { StorageProvider } from "../../../core/ports/storage-provider";
import type { CaptureStorage } from "../../capture-engine/storage/capture-storage";
import type { ImageStorage } from "../../image-generation/storage/image-storage";
import type { AdaptationStorage } from "../../multiformat-engine/storage/adaptation-storage";
import type { RenderStorage } from "../../video-rendering/storage/render-storage";
import { EditorError } from "../errors";
import type { EditorMediaKind } from "../domain/types";
import { parseAssetRef } from "./asset-ref";

/**
 * The only place the editor turns a `prefix:id` reference into bytes.
 *
 * Every branch verifies the artifact belongs to the requested project before it
 * opens a storage stream. A reference that names an id from another project
 * looks exactly like a reference that does not exist — the caller never learns
 * which, and a raw storage key can never reach this module because the input is
 * always a controlled ref, not a path.
 */
export type ResolvedEditorAsset = {
  ref: string;
  assetId: string;
  kind: EditorMediaKind;
  mimeType: string;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** Opens a fresh read stream for this artifact. Safe to call repeatedly. */
  read: () => Readable;
};

export type EditorAssetResolverDeps = {
  captures: CaptureRepository;
  assets: AssetRepository;
  images: ImageGenerationRepository;
  adaptations: AdaptationRepository;
  renderJobs: RenderJobRepository;
  captureStorage: CaptureStorage;
  imageStorage: ImageStorage;
  adaptationStorage: AdaptationStorage;
  renderStorage: RenderStorage;
  storage: StorageProvider;
};

const STORAGE_URI_PREFIX = "content-os-storage://local/";

export class EditorAssetResolver {
  constructor(private readonly deps: EditorAssetResolverDeps) {}

  async resolve(projectId: string, ref: string): Promise<ResolvedEditorAsset> {
    const parsed = parseAssetRef(ref);

    switch (parsed.prefix) {
      case "capture":
        return this.resolveCapture(projectId, parsed.ref, parsed.id);
      case "generated":
        return this.resolveGenerated(projectId, parsed.ref, parsed.id);
      case "brand":
      case "product":
      case "asset":
        return this.resolveSharedAsset(projectId, parsed.ref, parsed.id);
      case "adaptation":
        return this.resolveAdaptation(projectId, parsed.ref, parsed.id);
      case "writing":
        throw unavailable("writing copy has no bytes to stream");
    }
  }

  private async resolveCapture(
    projectId: string,
    ref: string,
    takeId: string,
  ): Promise<ResolvedEditorAsset> {
    const take = await this.deps.captures.getTake(projectId, takeId);
    if (!take || take.status === "DELETED" || take.status === "REJECTED") {
      throw new EditorError(
        "EDITOR_ASSET_UNAVAILABLE",
        `Capture ${takeId} is not available to this project`,
      );
    }

    return {
      ref,
      assetId: take.id,
      kind: mediaKindFor(take.mimeType, ref),
      mimeType: take.mimeType,
      byteSize: take.byteSize,
      width: take.width,
      height: take.height,
      durationMs: take.durationMs,
      read: () => this.deps.captureStorage.read(take.storageKey),
    };
  }

  private async resolveGenerated(
    projectId: string,
    ref: string,
    assetId: string,
  ): Promise<ResolvedEditorAsset> {
    const asset = await this.deps.images.getAsset(projectId, assetId);
    if (!asset || asset.deletedAt !== null) {
      throw new EditorError(
        "EDITOR_ASSET_UNAVAILABLE",
        `Generated image ${assetId} is not available to this project`,
      );
    }

    return {
      ref,
      assetId: asset.id,
      kind: mediaKindFor(asset.mimeType, ref),
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      durationMs: null,
      read: () => this.deps.imageStorage.read(asset.storageKey),
    };
  }

  private async resolveSharedAsset(
    projectId: string,
    ref: string,
    assetId: string,
  ): Promise<ResolvedEditorAsset> {
    const asset = await this.deps.assets.getById(assetId);
    if (!asset || asset.projectId !== projectId) {
      throw new EditorError(
        "EDITOR_CROSS_PROJECT_ASSET",
        `Asset ${assetId} is not available to this project`,
      );
    }

    if (!asset.uri.startsWith(STORAGE_URI_PREFIX)) {
      throw new EditorError(
        "EDITOR_ASSET_UNAVAILABLE",
        `Asset ${assetId} is not stored locally`,
      );
    }

    const storageKey = decodeURIComponent(
      asset.uri.slice(STORAGE_URI_PREFIX.length),
    );
    if (!storageKey) {
      throw new EditorError(
        "EDITOR_ASSET_UNAVAILABLE",
        `Asset ${assetId} has no storage key`,
      );
    }

    const mimeType = mimeForName(asset.name);
    const bytes = await this.deps.storage.get(storageKey);

    return {
      ref,
      assetId: asset.id,
      kind: mediaKindFor(mimeType, ref),
      mimeType,
      byteSize: bytes.length,
      width: null,
      height: null,
      durationMs: null,
      read: () => Readable.from(bytes),
    };
  }

  private async resolveAdaptation(
    projectId: string,
    ref: string,
    jobId: string,
  ): Promise<ResolvedEditorAsset> {
    const job = await this.deps.adaptations.getJob(projectId, jobId);
    if (!job || job.status !== "SUCCEEDED") {
      throw new EditorError(
        "EDITOR_ASSET_UNAVAILABLE",
        `Adaptation ${jobId} has no finished output`,
      );
    }

    if (job.kind === "COPY") {
      throw unavailable("a copy adaptation is text, not a stream");
    }

    if (job.kind === "IMAGE" && job.outputStorageKey) {
      const mimeType = job.outputMimeType ?? "image/png";
      return {
        ref,
        assetId: job.id,
        kind: mediaKindFor(mimeType, ref),
        mimeType,
        byteSize: job.outputByteSize,
        width: job.outputWidth,
        height: job.outputHeight,
        durationMs: null,
        read: () => this.deps.adaptationStorage.read(job.outputStorageKey as string),
      };
    }

    if (job.kind === "VIDEO" && job.renderJobId) {
      const [artifact, renderJob] = await Promise.all([
        this.deps.renderJobs.getArtifactByJob(job.renderJobId),
        this.deps.renderJobs.get(projectId, job.renderJobId),
      ]);
      if (!artifact) {
        throw new EditorError(
          "EDITOR_ASSET_UNAVAILABLE",
          `Video adaptation ${jobId} has no render artifact`,
        );
      }

      return {
        ref,
        assetId: job.id,
        kind: "VIDEO",
        mimeType: artifact.mimeType,
        byteSize: artifact.byteSize,
        width: renderJob?.width ?? null,
        height: renderJob?.height ?? null,
        durationMs: renderJob?.durationMs ?? null,
        read: () => this.deps.renderStorage.read(artifact.storageKey),
      };
    }

    throw unavailable(`adaptation ${jobId} has no output bytes`);
  }
}

function unavailable(message: string): never {
  throw new EditorError("EDITOR_ASSET_UNAVAILABLE", message);
}

function mediaKindFor(mimeType: string, ref: string): EditorMediaKind {
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  throw new EditorError(
    "EDITOR_INVALID_ASSET_REFERENCE",
    `Asset ${ref} has an unsupported media type: ${mimeType}`,
  );
}

function mimeForName(name: string): string {
  const lower = name.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp)$/.test(lower)) return "image/png";
  if (/\.(mp4|webm|mov|m4v|mkv)$/.test(lower)) return "video/mp4";
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(lower)) return "audio/mpeg";
  return "application/octet-stream";
}