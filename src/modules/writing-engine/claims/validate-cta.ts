import type { WritingContext } from "../domain/types";
import { matchProhibitedClaim } from "./prohibited-claim-patterns";
import { screenBrandTerms } from "./screen-text";
import { validateVariant, type VariantValidation } from "./validate-variant";

/**
 * A CTA gets the same grounding as any other variant, plus a check that it is
 * actually an ask: it must not be an empty command, and it must not smuggle a
 * quantified promise in as if it were a button label.
 */
export function validateCta(
  text: string,
  context: WritingContext,
): VariantValidation {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { accepted: false, reason: "empty_cta", claims: [] };
  }

  const brandTerm = screenBrandTerms(trimmed, context.brand);
  if (brandTerm) {
    return { accepted: false, reason: `brand_prohibited_term:${brandTerm}`, claims: [] };
  }

  const prohibited = matchProhibitedClaim(trimmed);
  if (prohibited && /\d/.test(prohibited.match)) {
    return {
      accepted: false,
      reason: `prohibited_cta_claim:${prohibited.id}`,
      claims: [],
    };
  }

  return validateVariant(trimmed, context);
}
