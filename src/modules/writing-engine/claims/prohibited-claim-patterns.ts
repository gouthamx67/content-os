/**
 * The conservative patterns a writing claim is screened against.
 *
 * This is an engineering guard, not a universal legal policy: it catches the
 * shapes that most often smuggle an unsupported assertion into copy — a
 * superlative, an absolute, a guarantee, a measured speed-up, a discount. A
 * matched phrase is only allowed through when the project's own facts contain it
 * verbatim.
 */
export const PROHIBITED_CLAIM_PATTERNS: ReadonlyArray<{
  id: string;
  pattern: RegExp;
}> = [
  { id: "superlative_best", pattern: /\b(?:best|#1|number one|world'?s leading|market leader)\b/i },
  { id: "guarantee", pattern: /\bguarantee(?:d|s)?\b/i },
  { id: "absolute_always", pattern: /\balways\b/i },
  { id: "absolute_never", pattern: /\bnever\b/i },
  { id: "percent_absolute", pattern: /\b100\s?%|\bzero[- ]risk\b/i },
  { id: "instant", pattern: /\binstantly\b|\bimmediately\b/i },
  { id: "proven", pattern: /\b(?:scientifically|clinically|proven)\b/i },
  { id: "money_saved", pattern: /\bsave\s*\$\s?\d+/i },
  { id: "measured_comparison", pattern: /\b\d+(?:\.\d+)?\s?%\s?(?:better|faster|more|less|cheaper|higher|lower)\b/i },
  { id: "multiplier", pattern: /\b\d+(?:\.\d+)?\s?x\s?(?:better|faster|more|less|cheaper|higher|lower|results?)\b/i },
];

export type ProhibitedClaimMatch = {
  id: string;
  match: string;
};

/** The first prohibited shape in the text, or null. */
export function matchProhibitedClaim(text: string): ProhibitedClaimMatch | null {
  for (const entry of PROHIBITED_CLAIM_PATTERNS) {
    const match = entry.pattern.exec(text);
    if (match) return { id: entry.id, match: match[0].trim() };
  }
  return null;
}

export function hasProhibitedClaimPattern(text: string): boolean {
  return matchProhibitedClaim(text) !== null;
}
