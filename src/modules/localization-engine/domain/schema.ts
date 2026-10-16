import { LocalizationError } from "../errors";
import type { LocalizationSegment } from "./types";

/**
 * The only shape a provider is allowed to answer with.
 *
 * A provider hands back translations keyed by segment id; it never decides where
 * a string goes, never adds a segment and never returns a whole snapshot. That
 * keeps the trust boundary small: whatever the provider says is checked against
 * the segment list the engine already committed to.
 */
export type ProviderSegmentOutput = {
  segmentId: string;
  targetText: string;
};

export function parseProviderOutput(value: unknown): ProviderSegmentOutput[] {
  if (!Array.isArray(value)) {
    throw new LocalizationError(
      "LOCALIZATION_PROVIDER_INVALID_OUTPUT",
      "Provider output must be an array of segments",
    );
  }

  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new LocalizationError(
        "LOCALIZATION_PROVIDER_INVALID_OUTPUT",
        `Provider segment ${index} is not an object`,
      );
    }
    const candidate = entry as { segmentId?: unknown; targetText?: unknown };
    if (typeof candidate.segmentId !== "string") {
      throw new LocalizationError(
        "LOCALIZATION_PROVIDER_INVALID_OUTPUT",
        `Provider segment ${index} has no segmentId`,
      );
    }
    if (typeof candidate.targetText !== "string") {
      throw new LocalizationError(
        "LOCALIZATION_PROVIDER_INVALID_OUTPUT",
        `Provider segment ${segmentIdLabel(candidate.segmentId)} has no targetText`,
      );
    }
    return {
      segmentId: candidate.segmentId,
      targetText: candidate.targetText,
    };
  });
}

/**
 * A provider must answer for every requested segment exactly once. A missing or
 * duplicated id is a provider bug, not a partial success, so it is refused
 * outright rather than merged.
 */
export function assertProviderCoverage(
  outputs: readonly { segmentId: string }[],
  segments: readonly LocalizationSegment[],
): void {
  const expected = new Set(segments.map((segment) => segment.id));
  const seen = new Set<string>();

  for (const output of outputs) {
    if (!expected.has(output.segmentId)) {
      throw new LocalizationError(
        "LOCALIZATION_PROVIDER_INVALID_OUTPUT",
        `Provider returned unknown segment ${output.segmentId}`,
        { segmentId: output.segmentId },
      );
    }
    if (seen.has(output.segmentId)) {
      throw new LocalizationError(
        "LOCALIZATION_PROVIDER_INVALID_OUTPUT",
        `Provider returned segment ${output.segmentId} more than once`,
        { segmentId: output.segmentId },
      );
    }
    seen.add(output.segmentId);
  }

  for (const segment of segments) {
    if (!seen.has(segment.id)) {
      throw new LocalizationError(
        "LOCALIZATION_PROVIDER_INVALID_OUTPUT",
        `Provider omitted segment ${segment.id}`,
        { segmentId: segment.id },
      );
    }
  }
}

function segmentIdLabel(segmentId: string): string {
  return segmentId.length > 0 ? segmentId : "(empty id)";
}
