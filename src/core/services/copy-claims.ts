/**
 * The rule that copy may not state a number the project has not recorded.
 *
 * It lives in one place because two layers now depend on it: a direction, in
 * prose, and a storyboard, as the words that will actually be read on screen and
 * spoken. A scene caption is the same kind of promise as a thesis, only harder to
 * walk back, and two copies of the pattern list would drift until one of them
 * stopped checking.
 *
 * A number in creative copy has to be traceable. It may come from a claim the
 * project supports, or from the brief itself - the duration and quantity the
 * user asked for are facts about the request, not claims about the product.
 */

/** Quantities a piece of creative copy might assert, matched conservatively. */
export const QUANTIFIED_CLAIM_PATTERNS: readonly RegExp[] = [
  // "10x", "3 x", "2x faster": a multiplier is the most persuasive form of an
  // invented number, so it is checked on its own rather than only with a unit.
  /\b\d+(?:\.\d+)?\s?x\b/i,
  /\b\d+(?:\.\d+)?\s?%/,
  /\b\d+(?:\.\d+)?\s?(?:percent|per cent)\b/i,
  /\b\d+(?:\.\d+)?\s?(?:k|m|bn|b)\b/i,
  /\b\d+(?:\.\d+)?\s?(?:times|faster|cheaper|more|less|hours?|minutes?|seconds?|days?|weeks?|months?|years?)\b/i,
  /\$\s?\d+/,
  /\b\d+(?:\.\d+)?\s?(?:gb|tb|mb)\b/i,
];

/** The digits a number inside a piece of text, for loose comparison. */
function bareNumber(needle: string): string {
  return needle.toLowerCase().replace(/\s+/g, "").replace(/[^0-9.,]/g, "");
}

/** Numbers pulled out of supported text, in a comparable form. */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => match[0]);
}

/**
 * Builds the set of numbers copy is allowed to state: everything a supported
 * claim mentions, plus whatever the brief itself fixed.
 */
export function supportableNumbers(
  claimTexts: readonly string[],
  briefNumbers: readonly (number | null | undefined)[] = [],
): Set<string> {
  const allowed = new Set<string>();
  for (const text of claimTexts) {
    for (const number of numbersIn(text)) allowed.add(number);
  }
  for (const value of briefNumbers) {
    if (value === null || value === undefined) continue;
    allowed.add(String(value));
  }
  return allowed;
}

/**
 * Whether a matched quantity is one the project can stand behind. Compared on
 * the digits alone as well as verbatim, so "30 seconds" is covered by a brief
 * that asked for 30.
 */
export function isQuantifiedClaimSupported(
  match: string,
  allowed: ReadonlySet<string>,
): boolean {
  const needle = match.toLowerCase().replace(/\s+/g, "");
  if (allowed.has(needle)) return true;
  const bare = bareNumber(needle);
  if (!bare) return false;
  for (const known of allowed) {
    if (bareNumber(known) === bare) return true;
  }
  return false;
}

/** The first unsupported quantity in a piece of text, or null when it holds up. */
export function unsupportedQuantifiedClaim(
  text: string,
  allowed: ReadonlySet<string>,
): string | null {
  for (const pattern of QUANTIFIED_CLAIM_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (!isQuantifiedClaimSupported(match[0], allowed)) return match[0].trim();
  }
  return null;
}
