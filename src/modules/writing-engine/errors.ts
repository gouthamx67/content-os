export const WRITING_ERROR_CODES = [
  "WRITING_INVALID_INPUT",
  "WRITING_PROJECT_NOT_FOUND",
  "WRITING_FORBIDDEN",
  "WRITING_DOCUMENT_NOT_FOUND",
  "WRITING_JOB_NOT_FOUND",
  "WRITING_PROVIDER_UNAVAILABLE",
  "WRITING_NO_GROUNDED_VARIANTS",
  "WRITING_GENERATION_FAILED",
  "WRITING_UNSUPPORTED_BLOCK_TYPE",
  "WRITING_UNSUPPORTED_TONE",
  "WRITING_UNSUPPORTED_LENGTH",
  "WRITING_UNSUPPORTED_OBJECTIVE",
  "WRITING_UNSUPPORTED_INSTRUCTION",
  "WRITING_SOURCE_ID_INVALID",
  "WRITING_CLAIM_UNSUPPORTED",
  "WRITING_ILLEGAL_TRANSITION",
  "WRITING_RECIPE_INVALID",
] as const;
export type WritingErrorCode = (typeof WRITING_ERROR_CODES)[number];

/**
 * A writing failure is either the caller's (an impossible length, a source from
 * another project) or the engine's. The status travels with the error so the API
 * layer can return it verbatim.
 */
export class WritingError extends Error {
  override readonly name = "WritingError";

  constructor(
    readonly code: WritingErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
