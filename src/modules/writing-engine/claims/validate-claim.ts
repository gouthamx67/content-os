import type { WritingContext } from "../domain/types";
import { matchProhibitedClaim } from "./prohibited-claim-patterns";
import { factsSupporting } from "./grounding-validator";

/**
 * Words that tend to introduce an assertion rather than a description. A
 * sentence carrying one is treated as a claim and checked, even when it does not
 * overlap a known fact.
 */
const CLAIM_TRIGGERS =
  /\b(?:guarantee(?:d|s)?|proven|best|fastest|cheapest|always|never|only|instantly|immediately|save|saves|reduce[sd]?|increase[sd]?|boost[sd]?|double[sd]?|triple[sd]?|cut[s]?|eliminate[sd]?)\b/i;

const MAX_CLAIMS = 12;

/**
 * Whether a sentence is worth checking as a claim.
 *
 * Marketing lines that merely describe are not claims; a line that states a
 * number, a superlative, a guarantee, or echoes a project fact is. Keeping this
 * conservative is what stops a headline from being rejected for the crime of
 * being a headline.
 */
export function isClaimCandidate(
  sentence: string,
  context: WritingContext,
): boolean {
  const text = sentence.trim();
  if (text.length < 4) return false;
  if (matchProhibitedClaim(text)) return true;
  if (/\d/.test(text)) return true;
  if (CLAIM_TRIGGERS.test(text)) return true;
  if (factsSupporting(text, context).length > 0) return true;
  return false;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/^[\s\-*•]+/, "").trim())
    .filter((sentence) => sentence.length > 0);
}

/** The candidate claims in a piece of copy, in order and de-duplicated. */
export function extractClaimCandidates(
  text: string,
  context: WritingContext,
): string[] {
  const claims: string[] = [];
  const seen = new Set<string>();

  for (const sentence of splitSentences(text)) {
    if (!isClaimCandidate(sentence, context)) continue;
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push(sentence);
    if (claims.length >= MAX_CLAIMS) break;
  }

  return claims;
}
