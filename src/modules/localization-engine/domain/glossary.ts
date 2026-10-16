import type { LocaleGlossaryRecord } from "./types";

export type GlossaryEntry = Pick<
  LocaleGlossaryRecord,
  "term" | "translation" | "doNotTranslate"
>;

export type GlossaryViolation = {
  term: string;
  expected: string;
};

function containsTerm(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Checks a translated string against the project glossary.
 *
 * A pinned term whose source appears must appear in the target in the form the
 * glossary dictates; a `doNotTranslate` term must survive verbatim. A missing
 * target is not a violation — validation of untranslated segments is the
 * readiness pass's job, not the glossary's.
 */
export function glossaryViolations(
  sourceText: string,
  targetText: string,
  entries: readonly GlossaryEntry[],
): GlossaryViolation[] {
  const violations: GlossaryViolation[] = [];
  if (targetText.trim().length === 0) return violations;

  for (const entry of entries) {
    const term = entry.term.trim();
    if (term.length === 0) continue;
    if (!containsTerm(sourceText, term)) continue;

    const expected = entry.doNotTranslate ? term : entry.translation;
    if (expected.trim().length === 0) continue;
    if (!containsTerm(targetText, expected)) {
      violations.push({ term, expected });
    }
  }

  return violations;
}

/**
 * The pinned `source -> target` pairs a segment should carry, so a reviewer can
 * see which terms constrained the translation.
 */
export function pinnedTerms(
  sourceText: string,
  entries: readonly GlossaryEntry[],
): Record<string, string> {
  const pinned: Record<string, string> = {};

  for (const entry of entries) {
    const term = entry.term.trim();
    if (term.length === 0) continue;
    if (!containsTerm(sourceText, term)) continue;
    pinned[term] = entry.doNotTranslate ? term : entry.translation;
  }

  return pinned;
}
