/**
 * Placeholder handling.
 *
 * A localized string that drops, renames or invents a token is silently broken
 * at render time — the classic `%s`/`{brand}` failure. We find every token the
 * source carries, require the target to carry exactly the same multiset, and
 * refuse the rest. `target === null` (a not-yet-localized segment) is not a
 * violation; it is simply not yet translated.
 */
const PLACEHOLDER_PATTERN =
  /\{\{?[a-zA-Z0-9_.:-]+\}?\}|\$\{[a-zA-Z0-9_.:-]+\}|%(?:\d+\$)?[sd]/g;

export function extractPlaceholders(text: string): string[] {
  const found = text.match(PLACEHOLDER_PATTERN) ?? [];
  return [...new Set(found)].sort();
}

export function missingPlaceholders(
  sourceText: string,
  targetText: string,
): string[] {
  const target = new Set(extractPlaceholders(targetText));
  return extractPlaceholders(sourceText).filter((token) => !target.has(token));
}

export function extraPlaceholders(
  sourceText: string,
  targetText: string,
): string[] {
  const source = new Set(extractPlaceholders(sourceText));
  return extractPlaceholders(targetText).filter((token) => !source.has(token));
}

export function placeholdersMatch(
  sourceText: string,
  targetText: string,
): boolean {
  const source = extractPlaceholders(sourceText);
  const target = extractPlaceholders(targetText);
  return (
    source.length === target.length &&
    source.every((token, index) => token === target[index])
  );
}
