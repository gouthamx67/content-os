import type { Claim, Feature, Product } from "../../../core/domain/intelligence";
import type { GenerationProductContext } from "../domain/types";

/**
 * Flattens real CP06 intelligence into the product half of a snapshot. Claims
 * that CP06 has marked as conflicting are dropped rather than printed, because
 * a graphic is a push surface and should not ship a claim the intelligence layer
 * itself has not resolved.
 */
export function toGenerationProduct(
  product: Product | null,
  features: Feature[],
  claims: Claim[],
): GenerationProductContext {
  const safeClaims = claims.filter(
    (claim) => claim.verification !== "CONFLICTING",
  );

  return {
    productId: product?.id ?? null,
    name: product?.name ?? "",
    shortDescription: product?.shortDescription ?? "",
    longDescription: product?.longDescription ?? "",
    valueProposition: product?.valueProposition ?? "",
    targetUserSummary: product?.targetUserSummary ?? "",
    features: features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      description: feature.description ?? "",
      importance: feature.importance,
    })),
    claims: safeClaims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      verification: claim.verification,
    })),
    confidence: product?.confidence ?? null,
  };
}
