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

export const socialPostTemplate: GraphicTemplate = {
  type: "SOCIAL_POST",
  label: "Social post",
  description: "A bold centred statement sized for a square social feed.",
  defaultWidth: 1080,
  defaultHeight: 1080,
  supportsTransparency: false,
  defaultFormat: "PNG",
  build({ context, width, height, transparent }: GraphicTemplateBuildInput) {
    const brand = context.brand;
    const background = transparent
      ? FALLBACK_PALETTE.surface
      : pickColor(brand, ["BACKGROUND", "PRIMARY"], FALLBACK_PALETTE.background);
    const accent = pickColor(brand, ["ACCENT", "SECONDARY"], FALLBACK_PALETTE.accent);
    const text = pickColor(brand, ["TEXT", "FOREGROUND"], FALLBACK_PALETTE.text);
    const font = pickFont(brand, ["HEADING", "PRIMARY"], "sans-serif");

    const margin = Math.round(width * 0.1);
    const elements = [
      rectElement({
        id: "social-underline",
        x: Math.round(width * 0.5 - width * 0.08),
        y: Math.round(height * 0.58),
        width: Math.round(width * 0.16),
        height: Math.max(4, Math.round(height * 0.01)),
        zIndex: 2,
        style: { fill: accent, radius: Math.round(height * 0.005) },
      }),
      textElement({
        id: "social-headline",
        x: margin,
        y: Math.round(height * 0.28),
        width: width - margin * 2,
        height: Math.round(height * 0.28),
        text: wrap(truncate(headlineFor(context), 90), 22, 4),
        zIndex: 3,
        style: {
          fill: text,
          fontFamily: font,
          fontSize: Math.round(height * 0.072),
          fontWeight: 800,
          align: "center",
          lineHeight: 1.12,
        },
      }),
      textElement({
        id: "social-caption",
        x: margin,
        y: Math.round(height * 0.62),
        width: width - margin * 2,
        height: Math.round(height * 0.12),
        text: truncate(
          context.product.valueProposition ?? context.product.shortDescription ?? context.userRequest,
          140,
        ),
        zIndex: 3,
        style: {
          fill: FALLBACK_PALETTE.muted,
          fontFamily: font,
          fontSize: Math.round(height * 0.03),
          fontWeight: 400,
          align: "center",
          lineHeight: 1.3,
        },
      }),
      textElement({
        id: "social-brand",
        x: margin,
        y: height - margin - Math.round(height * 0.04),
        width: width - margin * 2,
        height: Math.round(height * 0.04),
        text: truncate(brand.name || context.product.name || "Brand", 48),
        zIndex: 4,
        style: {
          fill: text,
          fontFamily: font,
          fontSize: Math.round(height * 0.028),
          fontWeight: 600,
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
