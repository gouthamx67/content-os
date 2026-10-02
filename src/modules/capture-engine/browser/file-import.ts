import {
  ALLOWED_MIME_TYPES,
  CaptureValidationError,
  MAX_CAPTURE_BYTES,
  normalizeMimeType,
} from "../capture-validation";

/**
 * Client-side pre-flight for an imported file.
 *
 * This mirrors the server check so an obviously wrong file is refused without
 * uploading 200 MB first. It is not a substitute: the server validates again,
 * because anything the client decides can be skipped by not using the client.
 */
export function validateImportedFile(file: File): void {
  const mimeType = normalizeMimeType(file.type);

  if (mimeType.length === 0) {
    throw new CaptureValidationError(
      "The file has no type; choose a supported image, video or audio file",
    );
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new CaptureValidationError(`Unsupported file type: ${file.type}`);
  }

  if (file.size <= 0) {
    throw new CaptureValidationError("File is empty");
  }

  if (file.size > MAX_CAPTURE_BYTES) {
    throw new CaptureValidationError("File exceeds the 250 MB limit");
  }
}

/**
 * Reads dimensions and duration from the file where the browser can report them.
 *
 * Best-effort by design: a file whose metadata cannot be read is still a valid
 * capture, so a decode failure yields no measurements rather than a rejection.
 * Reporting nothing is honest here; inventing a duration would not be.
 */
export async function probeImportedFile(file: File): Promise<{
  width?: number;
  height?: number;
  durationMs?: number;
}> {
  const mimeType = normalizeMimeType(file.type);

  if (mimeType.startsWith("image/")) {
    const dimensions = await probeImage(file);
    return dimensions;
  }

  if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) {
    const duration = await probeMediaDuration(file, mimeType);
    return duration;
  }

  return {};
}

async function probeImage(
  file: File,
): Promise<{ width?: number; height?: number }> {
  if (typeof createImageBitmap !== "function") {
    return {};
  }

  try {
    const bitmap = await createImageBitmap(file);
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  } catch {
    return {};
  }
}

async function probeMediaDuration(
  file: File,
  mimeType: string,
): Promise<{ width?: number; height?: number; durationMs?: number }> {
  const url = URL.createObjectURL(file);

  try {
    const element = document.createElement(
      mimeType.startsWith("video/") ? "video" : "audio",
    ) as HTMLVideoElement;

    element.preload = "metadata";
    element.src = url;

    const metadata = await new Promise<{
      durationMs?: number;
      width?: number;
      height?: number;
    } | null>((resolve) => {
      const done = (value: { durationMs?: number; width?: number; height?: number } | null) =>
        resolve(value);

      element.onloadedmetadata = () => {
        const durationMs = Number.isFinite(element.duration)
          ? Math.max(1, Math.round(element.duration * 1000))
          : undefined;

        done({
          durationMs,
          width: element.videoWidth || undefined,
          height: element.videoHeight || undefined,
        });
      };

      element.onerror = () => done(null);

      // A metadata read that never fires would hang the upload silently, so it
      // is bounded. The file still uploads; it just uploads without measurements.
      setTimeout(() => done(null), 5000);
    });

    return metadata ?? {};
  } finally {
    URL.revokeObjectURL(url);
  }
}
