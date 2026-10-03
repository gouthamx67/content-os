import type { BrandProfile } from "../../../core/domain/brand";
import type { GenerationBrandContext } from "../domain/types";

/** Flattens a real CP08 profile into the brand half of a generation snapshot. */
export function toGenerationBrand(
  brand: BrandProfile | null,
): GenerationBrandContext {
  const terms = brand?.terms ?? [];

  return {
    name: brand?.name ?? "",
    positioning: brand?.positioning ?? "",
    tagline: brand?.tagline ?? "",
    visualStyle: brand?.visualStyle ?? "",
    colors: (brand?.colors ?? []).map((color) => ({
      role: color.role,
      name: color.name,
      hex: color.hex,
    })),
    fonts: (brand?.fonts ?? []).map((font) => ({
      role: font.role,
      family: font.family,
      weight: font.weight,
    })),
    tone: brand?.voiceSummary ? [brand.voiceSummary] : [],
    preferredTerms: terms
      .filter((term) => term.preference === "PREFERRED")
      .map((term) => term.term),
    avoidTerms: terms
      .filter((term) => term.preference === "AVOID")
      .map((term) => term.term),
    version: brand?.version ?? null,
  };
}
