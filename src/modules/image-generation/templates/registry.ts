import type { GraphicTemplateType } from "../domain/types";
import { ImageGenerationError } from "../errors";
import type { GraphicTemplate } from "./types";
import { productHeroTemplate } from "./product-hero";
import { featureCalloutTemplate } from "./feature-callout";
import { quoteCardTemplate } from "./quote-card";
import { socialPostTemplate } from "./social-post";
import { promoCardTemplate } from "./promo-card";

/**
 * The template registry is closed and keyed by the persisted template enum, so
 * a stored document can always be rendered again and an unknown key fails
 * loudly rather than silently falling back to some default look.
 */
export const GRAPHIC_TEMPLATES = {
  PRODUCT_HERO: productHeroTemplate,
  FEATURE_CALLOUT: featureCalloutTemplate,
  QUOTE_CARD: quoteCardTemplate,
  SOCIAL_POST: socialPostTemplate,
  PROMO_CARD: promoCardTemplate,
} satisfies Record<GraphicTemplateType, GraphicTemplate>;

export function getGraphicTemplate(type: GraphicTemplateType): GraphicTemplate {
  const template = GRAPHIC_TEMPLATES[type];
  if (!template) {
    throw new ImageGenerationError(
      "IMAGE_TEMPLATE_NOT_FOUND",
      `Unknown graphic template: ${String(type)}`,
      400,
    );
  }
  return template;
}

export type { GraphicTemplate, GraphicTemplateBuildInput } from "./types";
