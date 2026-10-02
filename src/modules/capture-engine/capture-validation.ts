export const MAX_CAPTURE_BYTES = 250 * 1024 * 1024;
export const MAX_DURATION_MS = 10 * 60 * 1000;

/**
 * The MIME types the engine will accept. A browser recording arrives as one of
 * these, and so does a file a user drags in. The list is deliberately explicit
 * rather than a prefix match: `image/svg+xml` and `text/html` would sail through
 * a `startsWith("image")` or `startsWith("text")` check and then be served back
 * from our own origin as an active document.
 */
export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "audio/wav",
  "audio/x-wav",
]);

export interface CaptureMetadata {
  width?: number;
  height?: number;
  durationMs?: number;
  frameRate?: number;
  deviceLabel?: string;
}

export class CaptureValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureValidationError";
  }
}

function fail(message: string): never {
  throw new CaptureValidationError(message);
}

export function validateCaptureInput(input: {
  mimeType: string;
  byteSize: number;
  metadata?: CaptureMetadata;
}): void {
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    fail(`Unsupported capture MIME type: ${input.mimeType}`);
  }

  if (!Number.isInteger(input.byteSize) || input.byteSize <= 0) {
    fail("Capture must contain bytes");
  }

  if (input.byteSize > MAX_CAPTURE_BYTES) {
    fail("Capture exceeds the 250 MB limit");
  }

  const durationMs = input.metadata?.durationMs;

  if (
    durationMs !== undefined &&
    (!Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      durationMs > MAX_DURATION_MS)
  ) {
    fail("Capture duration is invalid");
  }

  const width = input.metadata?.width;
  const height = input.metadata?.height;

  for (const dimension of [width, height]) {
    if (
      dimension !== undefined &&
      (!Number.isInteger(dimension) || dimension <= 0 || dimension > 16_000)
    ) {
      fail("Capture dimensions are invalid");
    }
  }

  const frameRate = input.metadata?.frameRate;

  if (
    frameRate !== undefined &&
    (!Number.isFinite(frameRate) || frameRate <= 0 || frameRate > 1000)
  ) {
    fail("Capture frame rate is invalid");
  }
}

/**
 * Narrows parsed metadata to what the columns can actually hold.
 *
 * A client sends its own JSON, so every field is untrusted and some will be
 * absent, `null`, or the wrong type. `undefined` is dropped rather than stored,
 * because a `null` in `durationMs` reads back as "measured and found to be zero
 * duration" instead of "never measured".
 */
export function sanitizeCaptureMetadata(
  raw: unknown,
): CaptureMetadata | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }

  const source = raw as Record<string, unknown>;
  const metadata: CaptureMetadata = {};

  const positive = (value: unknown): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }
    return value;
  };

  const width = positive(source["width"]);
  const height = positive(source["height"]);
  const durationMs = positive(source["durationMs"]);
  const frameRate = positive(source["frameRate"]);

  if (width !== undefined) metadata.width = width;
  if (height !== undefined) metadata.height = height;
  if (durationMs !== undefined) metadata.durationMs = durationMs;
  if (frameRate !== undefined) metadata.frameRate = frameRate;

  const deviceLabel = source["deviceLabel"];
  if (typeof deviceLabel === "string" && deviceLabel.trim().length > 0) {
    // A device label is free text from the client and is shown back to the user
    // in the take list, so it is length-capped rather than trusted whole.
    metadata.deviceLabel = deviceLabel.trim().slice(0, 120);
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/**
 * Strips a codec suffix so `video/webm;codecs=vp9` is validated as `video/webm`.
 * `MediaRecorder` reports the codec it actually chose in the type it hands back,
 * and rejecting that would mean rejecting every real browser recording.
 */
export function normalizeMimeType(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return base === "audio/wave" ? "audio/wav" : base;
}
