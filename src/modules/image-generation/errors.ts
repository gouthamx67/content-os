/**
 * Image failures are typed because the API has to distinguish "the caller asked
 * for something impossible" (400/422) from "the renderer or provider broke"
 * (500). A machine-readable code travels alongside the message so a log line or
 * an error row can be grouped without parsing English.
 */
export class ImageGenerationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ImageGenerationError";
    this.code = code;
    this.status = status;
  }
}

/** The request is well-formed but describes a graphic this engine refuses. */
export class ImageFeatureError extends ImageGenerationError {
  constructor(code: string, message: string) {
    super(code, message, 422);
    this.name = "ImageFeatureError";
  }
}

/** The provider itself failed; the message is sanitized before it is stored. */
export class ImageExecutionError extends ImageGenerationError {
  constructor(message: string) {
    super("IMAGE_GENERATION_FAILED", message, 500);
    this.name = "ImageExecutionError";
  }
}

/** A job was cancelled while the provider was running. */
export class ImageCancelledError extends Error {
  readonly code = "IMAGE_GENERATION_CANCELLED";

  constructor(message = "Image generation was cancelled") {
    super(message);
    this.name = "ImageCancelledError";
  }
}

export const IMAGE_ERROR_CODES = [
  "IMAGE_INVALID_REQUEST",
  "IMAGE_TEMPLATE_NOT_FOUND",
  "IMAGE_PROVIDER_UNAVAILABLE",
  "IMAGE_SOURCE_NOT_FOUND",
  "IMAGE_SOURCE_PROJECT_MISMATCH",
  "IMAGE_PROJECT_MISMATCH",
  "IMAGE_OUTPUT_INVALID",
  "IMAGE_STORAGE_FAILED",
  "IMAGE_GENERATION_FAILED",
  "IMAGE_GENERATION_CANCELLED",
  "IMAGE_DOCUMENT_NOT_FOUND",
  "IMAGE_ASSET_NOT_FOUND",
  "IMAGE_JOB_NOT_FOUND",
] as const;
export type ImageErrorCode = (typeof IMAGE_ERROR_CODES)[number];

export const IMAGE_ERRORS: Record<ImageErrorCode, string> = {
  IMAGE_INVALID_REQUEST: "The image request is invalid",
  IMAGE_TEMPLATE_NOT_FOUND: "The requested graphic template does not exist",
  IMAGE_PROVIDER_UNAVAILABLE: "The requested image provider is not configured",
  IMAGE_SOURCE_NOT_FOUND: "A referenced image source could not be found",
  IMAGE_SOURCE_PROJECT_MISMATCH: "A referenced image source belongs to another project",
  IMAGE_PROJECT_MISMATCH: "The image resource belongs to another project",
  IMAGE_OUTPUT_INVALID: "The generated image failed validation",
  IMAGE_STORAGE_FAILED: "The generated image could not be stored",
  IMAGE_GENERATION_FAILED: "Image generation failed",
  IMAGE_GENERATION_CANCELLED: "Image generation was cancelled",
  IMAGE_DOCUMENT_NOT_FOUND: "The graphic document could not be found",
  IMAGE_ASSET_NOT_FOUND: "The generated image asset could not be found",
  IMAGE_JOB_NOT_FOUND: "The image generation job could not be found",
};
