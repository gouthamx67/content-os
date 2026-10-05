export const ADAPTATION_ERROR_CODES = [
  "ADAPTATION_INVALID_REQUEST",
  "ADAPTATION_PROJECT_NOT_FOUND",
  "ADAPTATION_FORBIDDEN",
  "ADAPTATION_SOURCE_NOT_FOUND",
  "ADAPTATION_SOURCE_TYPE_UNSUPPORTED",
  "ADAPTATION_FORMAT_UNKNOWN",
  "ADAPTATION_FORMAT_KIND_MISMATCH",
  "ADAPTATION_NO_COMPATIBLE_TARGETS",
  "ADAPTATION_PLATFORM_UNSUPPORTED",
  "ADAPTATION_PLATFORM_UNKNOWN",
  "ADAPTATION_PLATFORM_KIND_UNSUPPORTED",
  "ADAPTATION_PLATFORM_NOT_IN_PROJECT",
  "ADAPTATION_SOURCE_CHANGED",
  "ADAPTATION_SOURCE_CHANGED_SINCE_SNAPSHOT",
  "ADAPTATION_BATCH_NOT_FOUND",
  "ADAPTATION_JOB_NOT_FOUND",
  "ADAPTATION_BATCH_NOT_CANCELLABLE",
  "ADAPTATION_JOB_NOT_CANCELLABLE",
  "ADAPTATION_TARGET_COUNT_EXCEEDED",
  "ADAPTATION_COPY_TOO_SHORT",
  "ADAPTATION_IMAGE_TOO_LARGE",
  "ADAPTATION_IMAGE_INVALID",
  "ADAPTATION_IMAGE_ALPHA_LOST",
  "ADAPTATION_IMAGE_SOURCE_OPAQUE",
  "ADAPTATION_VIDEO_COMPOSITION_INVALID",
  "ADAPTATION_RENDER_FAILED",
  "ADAPTATION_RENDER_NOT_FOUND",
  "ADAPTATION_OUTPUT_INVALID",
  "ADAPTATION_STORAGE_FAILED",
  "ADAPTATION_OUTPUT_UNAVAILABLE",
  "ADAPTATION_FAILED",
] as const;
export type AdaptationErrorCode = (typeof ADAPTATION_ERROR_CODES)[number];

export const ADAPTATION_ERRORS: Record<AdaptationErrorCode, string> = {
  ADAPTATION_INVALID_REQUEST: "The adaptation request is invalid",
  ADAPTATION_PROJECT_NOT_FOUND: "The project could not be found",
  ADAPTATION_FORBIDDEN: "You do not have access to this project",
  ADAPTATION_SOURCE_NOT_FOUND: "The adaptation source could not be found",
  ADAPTATION_SOURCE_TYPE_UNSUPPORTED:
    "That source cannot be adapted into the requested format",
  ADAPTATION_FORMAT_UNKNOWN: "The requested format does not exist",
  ADAPTATION_FORMAT_KIND_MISMATCH:
    "The requested format cannot be produced from this source",
  ADAPTATION_NO_COMPATIBLE_TARGETS:
    "No requested format can be produced from this source",
  ADAPTATION_PLATFORM_UNSUPPORTED: "The platform cannot be adapted for",
  ADAPTATION_PLATFORM_UNKNOWN: "The platform is not known",
  ADAPTATION_PLATFORM_KIND_UNSUPPORTED:
    "The platform does not carry this kind of content",
  ADAPTATION_PLATFORM_NOT_IN_PROJECT:
    "The platform is not part of this project's platform set",
  ADAPTATION_SOURCE_CHANGED: "The adaptation source changed before it was frozen",
  ADAPTATION_SOURCE_CHANGED_SINCE_SNAPSHOT:
    "The adaptation source changed after the request was created",
  ADAPTATION_BATCH_NOT_FOUND: "The adaptation batch could not be found",
  ADAPTATION_JOB_NOT_FOUND: "The adaptation job could not be found",
  ADAPTATION_BATCH_NOT_CANCELLABLE:
    "The adaptation batch is already finished",
  ADAPTATION_JOB_NOT_CANCELLABLE: "The adaptation job is already finished",
  ADAPTATION_TARGET_COUNT_EXCEEDED:
    "Too many targets were requested for one batch",
  ADAPTATION_COPY_TOO_SHORT: "The source text is too short to fill this format",
  ADAPTATION_IMAGE_TOO_LARGE:
    "The requested image format exceeds the pixel budget",
  ADAPTATION_IMAGE_INVALID: "The adapted image failed validation",
  ADAPTATION_IMAGE_ALPHA_LOST: "The adapted image lost its alpha channel",
  ADAPTATION_IMAGE_SOURCE_OPAQUE:
    "A transparent variant cannot be produced from a source with no transparency",
  ADAPTATION_VIDEO_COMPOSITION_INVALID:
    "The composition cannot be adapted to this format",
  ADAPTATION_RENDER_FAILED: "The video render failed",
  ADAPTATION_RENDER_NOT_FOUND: "The render this job depends on is missing",
  ADAPTATION_OUTPUT_INVALID: "The adapted output failed validation",
  ADAPTATION_STORAGE_FAILED: "The adapted output could not be stored",
  ADAPTATION_OUTPUT_UNAVAILABLE: "The adapted output is not ready yet",
  ADAPTATION_FAILED: "Adaptation failed",
};

/**
 * Every adaptation failure is typed, because the caller has to be able to tell
 * "you asked for something impossible" (422) from "the engine broke" (500) and
 * from "the source moved under you" (409 — retry against a fresh snapshot). The
 * status travels with the error so the API returns it verbatim.
 */
export class AdaptationError extends Error {
  override readonly name = "AdaptationError";

  constructor(
    readonly code: AdaptationErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** The batch or job was cancelled while it was running. */
export class AdaptationCancelledError extends Error {
  override readonly name = "AdaptationCancelledError";
  readonly code = "ADAPTATION_CANCELLED";

  constructor(message = "Adaptation was cancelled") {
    super(message);
  }
}