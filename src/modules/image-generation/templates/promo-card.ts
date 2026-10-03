import type { GraphicTemplate, GraphicTemplateBuildInput } from "./types";
import {
  FALLBACK_PALETTE,
  headlineFor,
  pickColor,
  pickFont,
  rectElement,
  textElement,
  truncate,
  wrap,
} from "./support";

export const promoCardTemplate: GraphicTemplate = {
  type: "PROMO_CARD",
  label: "Promo card",
  description: "A promotional offer with a call to action drawn from brand terms.",
  defaultWidth: 1080,
  defaultHeight: 1350,
  supportsTransparency: false,
  defaultFormat: "PNG",
  build({ context, width, height, transparent }: GraphicTemplateBuildInput) {
    const brand = context.brand;
    const background = transparent
      ? FALLBACK_PALETTE.surface
      : pickColor(brand, ["BACKGROUND", "SURFACE"], FALLBACK_PALETTE.background);
    const primary = pickColor(brand, ["PRIMARY", "ACCENT"], FALLBACK_PALETTE.primary);
    const accent = pickColor(brand, ["ACCENT", "SECONDARY"], FALLBACK_PALETTE.accent);
    const text = pickColor(brand, ["TEXT", "FOREGROUND"], FALLBACK_PALETTE.text);
    const font = pickFont(brand, ["HEADING", "PRIMARY"], "sans-serif");

    const margin = Math.round(width * 0.09);
    const cta = context.brand.preferredTerms[0] ?? "Learn more";
    const elements = [
      rectElement({
        id: "promo-panel",
        x: 0,
        y: Math.round(height * 0.56),
        width,
        height: Math.round(height * 0.44),
        zIndex: 1,
        style: { fill: primary, opacity: 0.16 },
      }),
      textElement({
        id: "promo-kicker",
        x: margin,
        y: Math.round(height * 0.14),
        width: width - margin * 2,
        height: Math.round(height * 0.05),
        text: truncate(context.product.name || "Special offer", 48),
        zIndex: 2,
        style: {
          fill: accent,
          fontFamily: font,
          fontSize: Math.round(height * 0.024),
          fontWeight: 700,
          align: "left",
          letterSpacing: 2,
        },
      }),
      textElement({
        id: "promo-headline",
        x: margin,
        y: Math.round(height * 0.24),
        width: width - margin * 2,
        height: Math.round(height * 0.24),
        text: wrap(truncate(headlineFor(context), 110), 20, 4),
        zIndex: 2,
        style: {
          fill: text,
          fontFamily: font,
          fontSize: Math.round(height * 0.066),
          fontWeight: 800,
          align: "left",
          lineHeight: 1.12,
        },
      }),
      textElement({
        id: "promo-body",
        x: margin,
        y: Math.round(height * 0.62),
        width: width - margin * 2,
        height: Math.round(height * 0.16),
        text: truncate(
          context.directionThesis ??
            context.product.valueProposition ??
            context.userRequest,
          180,
        ),
        zIndex: 2,
        style: {
          fill: FALLBACK_PALETTE.muted,
          fontFamily: font,
          fontSize: Math.round(height * 0.028),
          fontWeight: 400,
          align: "left",
          lineHeight: 1.3,
        },
      }),
      rectElement({
        id: "promo-cta",
        x: margin,
        y: Math.round(height * 0.82),
        width: Math.min(width - margin * 2, Math.round(width * 0.46)),
        height: Math.round(height * 0.075),
        zIndex: 3,
        style: { fill: accent, radius: Math.round(height * 0.0375) },
      }),
      textElement({
        id: "promo-cta-label",
        x: margin + Math.round(width * 0.05),
        y: Math.round(height * 0.84),
        width: Math.min(width - margin * 2, Math.round(width * 0.46)) - Math.round(width * 0.1),
        height: Math.round(height * 0.04),
        text: truncate(cta, 36),
        zIndex: 4,
        style: {
          fill: FALLBACK_PALETTE.background,
          fontFamily: font,
          fontSize: Math.round(height * 0.03),
          fontWeight: 800,
          align: "center",
        },
      }),
    ];

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
