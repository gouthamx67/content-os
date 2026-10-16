import { sha256Hex } from "../serialization/canonical";
import { extractPlaceholders } from "./placeholders";
import type { LocalizationSegment, LocalizationSegmentKind } from "./types";

/**
 * A segment id derived from its path, not from insertion order.
 *
 * Re-extracting the same source yields the same ids, so a reviewer's edits and a
 * translation-memory hit survive a re-extract, and a diff between two revisions
 * shows real changes rather than every id shifting.
 */
export function segmentIdForPath(path: string): string {
  return `seg_${sha256Hex(path).slice(0, 24)}`;
}

export function createSegment(input: {
  path: string;
  kind: LocalizationSegmentKind;
  sourceText: string;
  metadata?: Record<string, string>;
}): LocalizationSegment {
  return {
    id: segmentIdForPath(input.path),
    kind: input.kind,
    path: input.path,
    sourceText: input.sourceText,
    targetText: null,
    placeholders: extractPlaceholders(input.sourceText),
    glossary: {},
    metadata: input.metadata ?? {},
  };
}
