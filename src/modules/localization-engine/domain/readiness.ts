import type {
  LocalizationFinding,
  LocalizationReadiness,
  LocalizationSegment,
} from "./types";

/**
 * Readiness is a verdict *with reasons*. A job is ready when it holds at least
 * one segment and validation produced no `ERROR`. Warnings are surfaced but do
 * not block approval — a reviewer may accept an intentionally unchanged string.
 */
export function evaluateReadiness(
  segments: readonly LocalizationSegment[],
  findings: readonly LocalizationFinding[],
): LocalizationReadiness {
  const readinessFindings: LocalizationFinding[] = [];

  if (segments.length === 0) {
    readinessFindings.push({
      code: "NO_SEGMENTS",
      severity: "ERROR",
      segmentId: null,
      message: "The source produced no localizable segments",
    });
  }

  readinessFindings.push(...findings);

  const ready = readinessFindings.every(
    (finding) => finding.severity !== "ERROR",
  );

  return { ready, findings: readinessFindings };
}
