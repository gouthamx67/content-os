import type { AssetType } from "../core/domain/asset";

export const MAX_ASSET_UPLOAD_BYTES = 10 * 1024 * 1024;

const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

const VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

const AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
] as const;

const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

const MIME_TYPES_BY_ASSET: Record<AssetType, readonly string[]> = {
  IMAGE: IMAGE_MIME_TYPES,
  SCREENSHOT: IMAGE_MIME_TYPES,
  UI_CAPTURE: IMAGE_MIME_TYPES,
  LOGO: IMAGE_MIME_TYPES,
  VIDEO: VIDEO_MIME_TYPES,
  AUDIO: AUDIO_MIME_TYPES,
  DOCUMENT: DOCUMENT_MIME_TYPES,
  OTHER: [
    ...IMAGE_MIME_TYPES,
    ...VIDEO_MIME_TYPES,
    "application/pdf",
    "text/plain",
  ],
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/webm": "weba",
  "audio/ogg": "ogg",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

export function isImageAssetType(type: AssetType): boolean {
  return (
    type === "IMAGE" ||
    type === "SCREENSHOT" ||
    type === "UI_CAPTURE" ||
    type === "LOGO"
  );
}

export function isAllowedAssetUpload(
  type: AssetType,
  mimeType: string,
): boolean {
  return MIME_TYPES_BY_ASSET[type].includes(mimeType);
}

export function assetExtensionForMime(mimeType: string): string | null {
  return EXTENSION_BY_MIME[mimeType] ?? null;
}

/**
 * A project asset's name is also how the image resolver guesses its type, so a
 * friendly name without an extension would be read as PNG. Keep the name the
 * user asked for, then make the real extension explicit.
 */
export function assetUploadName(
  requestedName: string,
  originalName: string,
  extension: string,
): string {
  const requested = requestedName.trim();
  const source = requested
    ? requested
    : originalName.trim().replace(/\.[a-z0-9]{1,10}$/i, "");
  const base = (source || "Asset").replace(/[\\/\0]/g, "_").trim();
  const name = base || "Asset";
  const lower = name.toLowerCase();
  const alreadyNamed =
    lower.endsWith(`.${extension}`) ||
    (extension === "jpg" && lower.endsWith(".jpeg"));
  return alreadyNamed ? name : `${name}.${extension}`;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

/**
 * The client's `file.type` is only a declaration. For image assets the bytes
 * must actually be one of the formats we accept before they are stored.
 */
export function imageBytesMatchMime(
  mimeType: string,
  bytes: Uint8Array,
): boolean {
  switch (mimeType) {
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a";
    case "image/webp":
      return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
    default:
      return false;
  }
}
