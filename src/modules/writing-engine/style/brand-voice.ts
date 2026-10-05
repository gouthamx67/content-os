import type { WritingBrandContext } from "../domain/types";

/**
 * The brand's own words about how it sounds, in the order they should be read.
 * `voiceSummary` leads; the individual signals add detail.
 */
export function brandVoiceGuidance(brand: WritingBrandContext): string[] {
  const guidance: string[] = [];
  if (brand.voiceSummary && brand.voiceSummary.trim()) {
    guidance.push(brand.voiceSummary.trim());
  }
  for (const signal of brand.voiceSignals) {
    const value = signal.trim();
    if (value) guidance.push(value);
  }
  return guidance;
}

/** A single sentence a provider can prepend to its prompt, or null when unknown. */
export function brandVoiceNote(brand: WritingBrandContext): string | null {
  const guidance = brandVoiceGuidance(brand);
  return guidance.length > 0 ? guidance.join(" ") : null;
}
