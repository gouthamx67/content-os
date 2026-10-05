import type { ClaimStatus, WritingContext } from "../domain/types";
import { groundClaim } from "./grounding-validator";
import { screenBrandTerms } from "./screen-text";
import { extractClaimCandidates } from "./validate-claim";

export type ValidatedClaim = {
  text: string;
  status: ClaimStatus;
  sourceIds: string[];
  reasoning: string;
};

export type VariantValidation = {
  accepted: boolean;
  reason: string | null;
  claims: ValidatedClaim[];
};

/**
 * The one gate every generated variant passes through.
 *
 * A variant is rejected outright if it uses a brand-forbidden term. Otherwise its
 * claims are extracted and grounded; a single unsupported claim rejects the
 * variant, because a piece of copy that states one thing the project cannot back
 * is worse than no copy at all.
 */
export function validateVariant(
  text: string,
  context: WritingContext,
): VariantValidation {
  const brandTerm = screenBrandTerms(text, context.brand);
  if (brandTerm) {
    return {
      accepted: false,
      reason: `brand_prohibited_term:${brandTerm}`,
      claims: [],
    };
  }

  const claims: ValidatedClaim[] = extractClaimCandidates(text, context).map(
    (candidate) => {
      const verdict = groundClaim(candidate, context);
      return {
        text: candidate,
        status: verdict.status,
        sourceIds: verdict.sourceIds,
        reasoning: verdict.reasoning,
      };
    },
  );

  const unsupported = claims.find((claim) => claim.status === "UNSUPPORTED");
  if (unsupported) {
    return {
      accepted: false,
      reason: `unsupported_claim:${unsupported.text}`,
      claims,
    };
  }

  return { accepted: true, reason: null, claims };
}
