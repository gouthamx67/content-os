import type { ValidationFinding } from "./types";

/**
 * Validation findings are data, not exceptions: a publication stores exactly
 * what was checked and what failed, so a reader can see why READY was refused
 * instead of inferring it from an error string.
 */

export const VALIDATION_CODES = {
  SOURCE_NOT_FOUND: "SOURCE_NOT_FOUND",
  SOURCE_GROUNDING_UNSUPPORTED: "SOURCE_GROUNDING_UNSUPPORTED",
  SOURCE_GROUNDING_NOT_EVALUATED: "SOURCE_GROUNDING_NOT_EVALUATED",
  SOURCE_NOT_APPROVED: "SOURCE_NOT_APPROVED",
  SOURCE_LINKS_AMBIGUOUS: "SOURCE_LINKS_AMBIGUOUS",
  CONTENT_EMPTY: "CONTENT_EMPTY",
  CONTENT_TOO_LONG: "CONTENT_TOO_LONG",
  CONNECTION_NOT_CONNECTED: "CONNECTION_NOT_CONNECTED",
  CONNECTION_REVOKED: "CONNECTION_REVOKED",
  CONNECTION_AUTH_REQUIRED: "CONNECTION_AUTH_REQUIRED",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
} as const;
export type ValidationCode = (typeof VALIDATION_CODES)[keyof typeof VALIDATION_CODES];

export function findingError(
  code: string,
  message: string,
  remediation: string | null = null,
): ValidationFinding {
  return { code, severity: "ERROR", message, remediation };
}

export function findingWarning(
  code: string,
  message: string,
  remediation: string | null = null,
): ValidationFinding {
  return { code, severity: "WARNING", message, remediation };
}

export function hasBlockingError(
  findings: readonly ValidationFinding[],
): boolean {
  return findings.some((finding) => finding.severity === "ERROR");
}
