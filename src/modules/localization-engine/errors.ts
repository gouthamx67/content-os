/**
 * One error shape for every localization failure.
 *
 * Readiness and validation findings are reported as data, not thrown, so the
 * codes here are the hard refusals: a state transition that is not allowed, a
 * locale that is not configured, a provider that cannot be reached, a source
 * that belongs to another project, or a write against a stale head.
 */
export const LOCALIZATION_ERROR_CODES = [
  "LOCALIZATION_NOT_FOUND",
  "LOCALE_NOT_FOUND",
  "GLOSSARY_TERM_NOT_FOUND",
  "LOCALIZATION_INVALID_INPUT",
  "INVALID_LOCALE",
  "LOCALE_ALREADY_CONFIGURED",
  "LOCALE_NOT_TARGET",
  "LOCALE_NOT_SOURCE",
  "SOURCE_NOT_FOUND",
  "SOURCE_LOCALE_MISMATCH",
  "TARGET_LOCALE_MISMATCH",
  "LOCALIZATION_INVALID_TRANSITION",
  "LOCALIZATION_NOT_READY",
  "LOCALIZATION_APPROVAL_REQUIRED",
  "LOCALIZATION_APPROVAL_STALE",
  "LOCALIZATION_REVISION_CONFLICT",
  "LOCALIZATION_NO_SEGMENTS",
  "LOCALIZATION_PROVIDER_UNAVAILABLE",
  "LOCALIZATION_PROVIDER_INVALID_OUTPUT",
  "LOCALIZATION_PLACEHOLDER_MISMATCH",
  "LOCALIZATION_GLOSSARY_VIOLATION",
  "LOCALIZATION_NOT_APPROVED",
  "LOCALIZATION_CROSS_PROJECT_SOURCE",
] as const;
export type LocalizationErrorCode = (typeof LOCALIZATION_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<LocalizationErrorCode, number> = {
  LOCALIZATION_NOT_FOUND: 404,
  LOCALE_NOT_FOUND: 404,
  GLOSSARY_TERM_NOT_FOUND: 404,
  LOCALIZATION_INVALID_INPUT: 400,
  INVALID_LOCALE: 400,
  LOCALE_ALREADY_CONFIGURED: 409,
  LOCALE_NOT_TARGET: 400,
  LOCALE_NOT_SOURCE: 400,
  SOURCE_NOT_FOUND: 404,
  SOURCE_LOCALE_MISMATCH: 400,
  TARGET_LOCALE_MISMATCH: 400,
  LOCALIZATION_INVALID_TRANSITION: 409,
  LOCALIZATION_NOT_READY: 409,
  LOCALIZATION_APPROVAL_REQUIRED: 409,
  LOCALIZATION_APPROVAL_STALE: 409,
  LOCALIZATION_REVISION_CONFLICT: 409,
  LOCALIZATION_NO_SEGMENTS: 400,
  LOCALIZATION_PROVIDER_UNAVAILABLE: 503,
  LOCALIZATION_PROVIDER_INVALID_OUTPUT: 502,
  LOCALIZATION_PLACEHOLDER_MISMATCH: 422,
  LOCALIZATION_GLOSSARY_VIOLATION: 422,
  LOCALIZATION_NOT_APPROVED: 409,
  LOCALIZATION_CROSS_PROJECT_SOURCE: 404,
};

export class LocalizationError extends Error {
  readonly code: LocalizationErrorCode;
  readonly status: number;
  readonly extras: Record<string, unknown>;

  constructor(
    code: LocalizationErrorCode,
    message: string,
    extras: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LocalizationError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.extras = extras;
  }
}

export function isLocalizationError(
  error: unknown,
): error is LocalizationError {
  return error instanceof LocalizationError;
}
