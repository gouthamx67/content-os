/**
 * The single source of truth for what an image job may ask for. The validator
 * reads these, the API surfaces them, and the renderer refuses to allocate past
 * them, so a large request is rejected once rather than re-litigated per layer.
 */
export const IMAGE_GENERATION_LIMITS = {
  maxWidth: 4096,
  maxHeight: 4096,
  maxPixels: 16_000_000,
  maxElements: 100,
  maxPromptLength: 4000,
  maxTextLength: 2000,
  maxVariants: 8,
} as const;

export type ImageGenerationLimits = typeof IMAGE_GENERATION_LIMITS;
