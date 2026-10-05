import type { WritingBrandContext } from "../domain/types";
import { matchProhibitedClaim, type ProhibitedClaimMatch } from "./prohibited-claim-patterns";
import { findProhibitedTerm } from "../style/preferred-vocabulary";

export type TextScreening = {
  brandTerm: string | null;
  prohibitedClaim: ProhibitedClaimMatch | null;
};

/** Screens copy against the brand's forbidden terms and the claim patterns. */
export function screenText(
  text: string,
  brand: WritingBrandContext,
): TextScreening {
  return {
    brandTerm: findProhibitedTerm(text, brand),
    prohibitedClaim: matchProhibitedClaim(text),
  };
}

export function screenBrandTerms(
  text: string,
  brand: WritingBrandContext,
): string | null {
  return findProhibitedTerm(text, brand);
}

export function screenProhibitedClaims(text: string): ProhibitedClaimMatch | null {
  return matchProhibitedClaim(text);
}
