import { Readable } from "node:stream";
import type { CaptureRepository } from "../../../core/ports/capture-repository";
import type { AssetRepository } from "../../../core/ports/asset-repository";
import type { StorageProvider } from "../../../core/ports/storage-provider";
import type { CaptureStorage } from "../../capture-engine/storage/capture-storage";
import { AudioFeatureError } from "../errors";

export type ResolvedAudioSource = {
  /** A logical reference the caller already owns; never a filesystem path. */
  sourceRef: string;
  mimeType: string;
  byteSize: number | null;
  originalName: string | null;
  /** Opens a fresh readable stream over the source bytes. */
  open: () => Readable;
};

export type AudioSourceDependencies = {
  captures: CaptureRepository;
  assets: AssetRepository;
  captureStorage: CaptureStorage;
  storage: StorageProvider;
};

const STORAGE_URI_PREFIX = "content-os-storage://local/";

/**
 * Turns a logical `capture:` / `asset:` reference into a readable stream.
 *
 * The reference is resolved against the job's project, so a reference naming an
 * id from another project resolves to nothing rather than to bytes the project
 * does not own. Only accepted captures are usable: a rejected or deleted take is
 * a source that no longer exists, and silently mixing it would produce a render
 * missing content the user thought they had.
 */
export class AudioSourceResolver {
  constructor(private readonly deps: AudioSourceDependencies) {}

  async resolve(projectId: string, sourceRef: string): Promise<ResolvedAudioSource> {
    const [kind, id] = splitRef(sourceRef);

    if (kind === "capture") {
      return this.resolveCapture(projectId, id, sourceRef);
    }

    if (kind === "asset") {
      return this.resolveAsset(projectId, id, sourceRef);
    }

    throw new AudioFeatureError(
      "AUDIO_SOURCE_NOT_FOUND",
      `Unsupported audio source reference: ${sourceRef}`,
    );
  }

  private async resolveCapture(
    projectId: string,
    takeId: string,
    sourceRef: string,
  ): Promise<ResolvedAudioSource> {
    const take = await this.deps.captures.getTake(projectId, takeId);

    if (!take || take.status === "DELETED" || take.status === "REJECTED") {
      throw new AudioFeatureError(
        "AUDIO_SOURCE_NOT_FOUND",
        `Capture ${takeId} is not available to this project`,
      );
    }

    if (take.status !== "ACCEPTED") {
      throw new AudioFeatureError(
        "AUDIO_SOURCE_NOT_FOUND",
        `Capture ${takeId} has not been accepted`,
      );
    }

    assertAudioBearing(take.mimeType);

    return {
      sourceRef,
      mimeType: take.mimeType,
      byteSize: take.byteSize,
      originalName: take.originalName,
      open: () => this.deps.captureStorage.read(take.storageKey),
    };
  }

  private async resolveAsset(
    projectId: string,
    assetId: string,
    sourceRef: string,
  ): Promise<ResolvedAudioSource> {
    const asset = await this.deps.assets.getById(assetId);

    if (!asset || asset.projectId !== projectId) {
      throw new AudioFeatureError(
        "AUDIO_SOURCE_PROJECT_MISMATCH",
        `Asset ${assetId} is not available to this project`,
      );
    }

    if (!asset.uri.startsWith(STORAGE_URI_PREFIX)) {
      throw new AudioFeatureError(
        "AUDIO_SOURCE_NOT_FOUND",
        `Asset ${assetId} is not stored locally and cannot be rendered`,
      );
    }

    const key = decodeURIComponent(asset.uri.slice(STORAGE_URI_PREFIX.length));
    if (!key) {
      throw new AudioFeatureError(
        "AUDIO_SOURCE_NOT_FOUND",
        `Asset ${assetId} has no storage key`,
      );
    }

    const mimeType = guessMime(asset.name);
    assertAudioBearing(mimeType);

    return {
      sourceRef,
      mimeType,
      byteSize: null,
      originalName: asset.name,
      open: () => {
        const pending = this.deps.storage.get(key);
        return Readable.from(
          (async function* () {
            yield Buffer.from(await pending);
          })(),
        );
      },
    };
  }
}

function splitRef(sourceRef: string): [string, string] {
  const separator = sourceRef.indexOf(":");
  if (separator <= 0) {
    throw new AudioFeatureError(
      "AUDIO_SOURCE_NOT_FOUND",
      `Invalid audio source reference: ${sourceRef}`,
    );
  }
  return [sourceRef.slice(0, separator), sourceRef.slice(separator + 1)];
}

function assertAudioBearing(mimeType: string): void {
  if (mimeType.startsWith("audio/") || mimeType.startsWith("video/")) {
    return;
  }
  throw new AudioFeatureError(
    "AUDIO_STREAM_MISSING",
    `Source ${mimeType || "unknown"} carries no audio stream`,
  );
}

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (/\.(wav)$/.test(lower)) return "audio/wav";
  if (/\.(mp3)$/.test(lower)) return "audio/mpeg";
  if (/\.(m4a|aac)$/.test(lower)) return "audio/mp4";
  if (/\.(ogg|oga)$/.test(lower)) return "audio/ogg";
  if (/\.(flac)$/.test(lower)) return "audio/flac";
  if (/\.(mp4|webm|mov|m4v|mkv)$/.test(lower)) return "video/mp4";
  throw new AudioFeatureError(
    "AUDIO_STREAM_MISSING",
    `Cannot infer an audio media type for asset ${name}`,
  );
}
