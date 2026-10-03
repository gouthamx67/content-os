import type { GraphicTemplate, GraphicTemplateBuildInput } from "./types";
import {
  FALLBACK_PALETTE,
  headlineFor,
  imageElement,
  pickColor,
  pickFont,
  rectElement,
  circleElement,
  textElement,
  truncate,
} from "./support";

export const productHeroTemplate: GraphicTemplate = {
  type: "PRODUCT_HERO",
  label: "Product hero",
  description: "A headline, supporting line and accent shape for a product focus.",
  defaultWidth: 1080,
  defaultHeight: 1080,
  supportsTransparency: false,
  defaultFormat: "PNG",
  build({ context, width, height, transparent }: GraphicTemplateBuildInput) {
    const brand = context.brand;
    const background = transparent
      ? FALLBACK_PALETTE.surface
      : pickColor(brand, ["BACKGROUND", "SURFACE", "PRIMARY"], FALLBACK_PALETTE.background);
    const primary = pickColor(brand, ["PRIMARY", "ACCENT"], FALLBACK_PALETTE.primary);
    const accent = pickColor(brand, ["ACCENT", "SECONDARY"], FALLBACK_PALETTE.accent);
    const text = pickColor(brand, ["TEXT", "FOREGROUND"], FALLBACK_PALETTE.text);
    const font = pickFont(brand, ["HEADING", "PRIMARY"], "sans-serif");

    const margin = Math.round(width * 0.08);
    const size = Math.round(Math.min(width, height) * 0.34);
    const elements = [];

    if (!transparent) {
      elements.push(
        circleElement({
          id: "accent-circle",
          x: width - size - Math.round(width * 0.06),
          y: Math.round(height * 0.06),
          size,
          zIndex: 1,
          style: { fill: accent, opacity: 0.9 },
        }),
      );
      elements.push(
        rectElement({
          id: "hero-band",
          x: 0,
          y: Math.round(height * 0.5),
          width,
          height: Math.round(height * 0.5),
          zIndex: 2,
          style: { fill: FALLBACK_PALETTE.surface, opacity: 0.72 },
        }),
      );
    }

    if (context.sourceAssetIds.length > 0) {
      elements.push(
        imageElement({
          id: "hero-image",
          x: margin,
          y: Math.round(height * 0.1),
          width: width - margin * 2,
          height: Math.round(height * 0.36),
          zIndex: 3,
          assetRef: `product:${context.sourceAssetIds[0]}`,
        }),
      );
    }

    elements.push(
      textElement({
        id: "hero-kicker",
        x: margin,
        y: Math.round(height * 0.53),
        width: width - margin * 2,
        height: Math.round(height * 0.08),
        text: truncate((brand.tone[0] ?? context.product.name) || "Featured", 48),
        zIndex: 4,
        style: {
          fill: accent,
          fontFamily: font,
          fontSize: Math.round(height * 0.03),
          fontWeight: 600,
          align: "left",
        },
      }),
      textElement({
        id: "hero-headline",
        x: margin,
        y: Math.round(height * 0.6),
        width: width - margin * 2,
        height: Math.round(height * 0.16),
        text: truncate(headlineFor(context), 72),
        zIndex: 5,
        style: {
          fill: text,
          fontFamily: font,
          fontSize: Math.round(height * 0.075),
          fontWeight: 800,
          align: "left",
          lineHeight: 1.1,
        },
      }),
      textElement({
        id: "hero-subline",
        x: margin,
        y: Math.round(height * 0.79),
        width: width - margin * 2,
        height: Math.round(height * 0.12),
        text: truncate(
          context.directionVisualStyle ??
            context.product.valueProposition ??
            context.product.shortDescription ??
            context.userRequest,
          160,
        ),
        zIndex: 6,
        style: {
          fill: FALLBACK_PALETTE.muted,
          fontFamily: font,
          fontSize: Math.round(height * 0.032),
          fontWeight: 400,
          align: "left",
          lineHeight: 1.3,
        },
      }),
      textElement({
        id: "hero-brand",
        x: margin,
        y: height - margin - Math.round(height * 0.04),
        width: width - margin * 2,
        height: Math.round(height * 0.04),
        text: truncate(brand.name || context.product.name || "Brand", 48),
        zIndex: 7,
        style: {
          fill: primary,
          fontFamily: font,
          fontSize: Math.round(height * 0.026),
          fontWeight: 600,
          align: "left",
        },
      }),
    );

    return {
      contractVersion: 1,
      width,
      height,
      background: transparent
        ? { kind: "TRANSPARENT" }
        : { kind: "COLOR", color: background },
      elements,
    };
  },
};
