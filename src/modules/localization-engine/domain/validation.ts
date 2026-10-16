import { glossaryViolations, type GlossaryEntry } from "./glossary";
import {
  extraPlaceholders,
  missingPlaceholders,
} from "./placeholders";
import type {
  LocalizationFinding,
  LocalizationSegment,
  TextDirection,
} from "./types";

export type ValidationContext = {
  entries: readonly GlossaryEntry[];
  targetDirection: TextDirection;
};

/**
 * Validate a segment list against everything a reviewer would catch.
 *
 * Findings are data with a stable code, so the UI can group them and the
 * acceptance matrix can assert on them. The pass is pure: the same segments and
 * glossary always produce the same findings in the same order.
 */
export function validateSegments(
  segments: readonly LocalizationSegment[],
  context: ValidationContext = { entries: [], targetDirection: "LTR" },
): LocalizationFinding[] {
  const findings: LocalizationFinding[] = [];

  const seen = new Set<string>();
  for (const segment of segments) {
    if (seen.has(segment.id)) {
      findings.push({
        code: "DUPLICATE_SEGMENT_ID",
        severity: "ERROR",
        segmentId: segment.id,
        message: `Segment ${segment.id} appears more than once`,
      });
      continue;
    }
    seen.add(segment.id);
  }

  for (const segment of segments) {
    findings.push(...validateSegment(segment, context));
  }

  return findings;
}

function validateSegment(
  segment: LocalizationSegment,
  context: ValidationContext,
): LocalizationFinding[] {
  const findings: LocalizationFinding[] = [];

  if (segment.sourceText.trim().length === 0) {
    return findings;
  }

  if (segment.targetText === null) {
    findings.push({
      code: "MISSING_TRANSLATION",
      severity: "ERROR",
      segmentId: segment.id,
      message: `Segment ${segment.path} has no translation`,
    });
    return findings;
  }

  if (segment.targetText.trim().length === 0) {
    findings.push({
      code: "EMPTY_TRANSLATION",
      severity: "ERROR",
      segmentId: segment.id,
      message: `Segment ${segment.path} has an empty translation`,
    });
    return findings;
  }

  if (segment.targetText === segment.sourceText) {
    findings.push({
      code: "UNCHANGED_TRANSLATION",
      severity: "WARNING",
      segmentId: segment.id,
      message: `Segment ${segment.path} is identical to its source`,
    });
  }

  const missing = missingPlaceholders(
    segment.sourceText,
    segment.targetText,
  );
  if (missing.length > 0) {
    findings.push({
      code: "PLACEHOLDER_MISSING",
      severity: "ERROR",
      segmentId: segment.id,
      message: `Segment ${segment.path} is missing placeholders: ${missing.join(", ")}`,
    });
  }

  const extra = extraPlaceholders(segment.sourceText, segment.targetText);
  if (extra.length > 0) {
    findings.push({
      code: "PLACEHOLDER_ADDED",
      severity: "ERROR",
      segmentId: segment.id,
      message: `Segment ${segment.path} introduces placeholders: ${extra.join(", ")}`,
    });
  }

  for (const violation of glossaryViolations(
    segment.sourceText,
    segment.targetText,
    context.entries,
  )) {
    findings.push({
      code: "GLOSSARY_VIOLATION",
      severity: "ERROR",
      segmentId: segment.id,
      message: `Segment ${segment.path} must render "${violation.term}" as "${violation.expected}"`,
    });
  }

  return findings;
}
