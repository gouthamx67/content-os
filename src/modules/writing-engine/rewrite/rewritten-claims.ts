import type { WritingContext } from "../domain/types";
import { validateVariant, type ValidatedClaim } from "../claims/validate-variant";

/**
 * The claims a rewritten variant carries. They are re-derived against the
 * document's frozen context rather than copied from the previous variant, so a
 * rewrite that changes a sentence changes its provenance with it.
 */
export function rewrittenClaims(
  text: string,
  context: WritingContext,
): ValidatedClaim[] {
  return validateVariant(text, context).claims;
}
