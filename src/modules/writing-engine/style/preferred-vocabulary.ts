import type { WritingBrandContext } from "../domain/types";

export function preferredTerms(brand: WritingBrandContext): string[] {
  return brand.preferredTerms;
}

export function prohibitedTerms(brand: WritingBrandContext): string[] {
  return brand.prohibitedTerms;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTerm(text: string, terms: readonly string[]): string | null {
  for (const term of terms) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(trimmed)}([^\\p{L}\\p{N}]|$)`,
      "iu",
    );
    if (pattern.test(text)) return trimmed;
  }
  return null;
}

/** The first brand term the copy is forbidden to use, or null. */
export function findProhibitedTerm(
  text: string,
  brand: WritingBrandContext,
): string | null {
  return findTerm(text, brand.prohibitedTerms);
}

/** The first brand term the copy should avoid, or null. */
export function findAvoidedTerm(
  text: string,
  brand: WritingBrandContext,
): string | null {
  return findProhibitedTerm(text, brand);
}

/**
 * Restores a preferred term's canonical casing when it appears in a different
 * case. Only terms that carry an uppercase letter (acronyms, product names) are
 * rewritten, so ordinary words are left alone.
 */
export function applyPreferredVocabulary(
  text: string,
  brand: WritingBrandContext,
): { text: string; applied: string[] } {
  const applied: string[] = [];
  let value = text;

  for (const term of brand.preferredTerms) {
    const trimmed = term.trim();
    if (!trimmed || trimmed === trimmed.toLowerCase()) continue;
    const pattern = new RegExp(escapeRegExp(trimmed), "gi");
    value = value.replace(pattern, (match) => {
      if (match !== trimmed) applied.push(trimmed);
      return trimmed;
    });
  }

  return { text: value, applied };
}
