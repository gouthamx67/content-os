import type { GraphicTemplate, GraphicTemplateBuildInput } from "./types";
import {
  FALLBACK_PALETTE,
  pickColor,
  pickFont,
  rectElement,
  textElement,
  truncate,
  wrap,
} from "./support";

export const quoteCardTemplate: GraphicTemplate = {
  type: "QUOTE_CARD",
  label: "Quote card",
  description: "A quote or pull statement with attribution.",
  defaultWidth: 1080,
  defaultHeight: 1080,
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
    const font = pickFont(brand, ["HEADING", "PRIMARY"], "serif");
    const bodyFont = pickFont(brand, ["BODY", "SECONDARY", "PRIMARY"], font);

    const margin = Math.round(width * 0.12);
    const quoteSource =
      context.sceneText ??
      context.directionThesis ??
      context.product.valueProposition ??
      context.userRequest;

    const elements = [
      textElement({
        id: "quote-mark",
        x: margin,
        y: Math.round(height * 0.14),
        width: Math.round(width * 0.2),
        height: Math.round(height * 0.14),
        text: "\u201C",
        zIndex: 2,
        style: {
          fill: accent,
          fontFamily: font,
          fontSize: Math.round(height * 0.14),
          fontWeight: 800,
          align: "left",
        },
      }),
      rectElement({
        id: "quote-rule",
        x: margin,
        y: Math.round(height * 0.72),
        width: Math.round(width * 0.24),
        height: Math.max(4, Math.round(height * 0.008)),
        zIndex: 2,
        style: { fill: primary },
      }),
      textElement({
        id: "quote-body",
        x: margin,
        y: Math.round(height * 0.3),
        width: width - margin * 2,
        height: Math.round(height * 0.4),
        text: wrap(truncate(quoteSource, 280), 34, 6),
        zIndex: 3,
        style: {
          fill: text,
          fontFamily: font,
          fontSize: Math.round(height * 0.058),
          fontWeight: 500,
          align: "left",
          lineHeight: 1.25,
        },
      }),
      textElement({
        id: "quote-attribution",
        x: margin,
        y: Math.round(height * 0.76),
        width: width - margin * 2,
        height: Math.round(height * 0.06),
        text: truncate(brand.name || context.product.name || "Brand", 64),
        zIndex: 3,
        style: {
          fill: FALLBACK_PALETTE.muted,
          fontFamily: bodyFont,
          fontSize: Math.round(height * 0.03),
          fontWeight: 600,
          align: "left",
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
