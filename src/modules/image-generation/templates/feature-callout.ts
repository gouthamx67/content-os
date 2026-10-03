import type { GraphicTemplate, GraphicTemplateBuildInput } from "./types";
import {
  FALLBACK_PALETTE,
  headlineFor,
  pickColor,
  pickFont,
  rectElement,
  textElement,
  truncate,
} from "./support";

export const featureCalloutTemplate: GraphicTemplate = {
  type: "FEATURE_CALLOUT",
  label: "Feature callout",
  description: "A headline followed by up to three product features.",
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
    const font = pickFont(brand, ["HEADING", "PRIMARY"], "sans-serif");

    const margin = Math.round(width * 0.08);
    const elements = [];

    elements.push(
      textElement({
        id: "callout-kicker",
        x: margin,
        y: Math.round(height * 0.1),
        width: width - margin * 2,
        height: Math.round(height * 0.06),
        text: truncate(context.product.name || "Product", 48),
        zIndex: 2,
        style: {
          fill: accent,
          fontFamily: font,
          fontSize: Math.round(height * 0.028),
          fontWeight: 600,
          align: "left",
        },
      }),
      rectElement({
        id: "callout-rule",
        x: margin,
        y: Math.round(height * 0.17),
        width: Math.round(width * 0.18),
        height: Math.max(4, Math.round(height * 0.008)),
        zIndex: 2,
        style: { fill: primary },
      }),
      textElement({
        id: "callout-headline",
        x: margin,
        y: Math.round(height * 0.21),
        width: width - margin * 2,
        height: Math.round(height * 0.14),
        text: truncate(headlineFor(context), 72),
        zIndex: 3,
        style: {
          fill: text,
          fontFamily: font,
          fontSize: Math.round(height * 0.062),
          fontWeight: 800,
          align: "left",
          lineHeight: 1.12,
        },
      }),
    );

    const features = context.product.features.slice(0, 3);
    const rows = features.length > 0 ? features : [{ id: "fallback", name: context.product.valueProposition || context.userRequest, description: context.product.shortDescription }];
    const startY = Math.round(height * 0.42);
    const rowHeight = Math.round(height * 0.14);
    const gap = Math.round(height * 0.03);

    rows.forEach((feature, index) => {
      const y = startY + index * (rowHeight + gap);
      const markerSize = Math.max(8, Math.round(height * 0.028));
      elements.push(
        rectElement({
          id: `feature-marker-${index}`,
          x: margin,
          y,
          width: markerSize,
          height: markerSize,
          zIndex: 4,
          style: { fill: accent, radius: Math.round(markerSize / 2) },
        }),
        textElement({
          id: `feature-title-${index}`,
          x: margin + markerSize + Math.round(width * 0.03),
          y,
          width: width - margin * 2 - markerSize - Math.round(width * 0.03),
          height: Math.round(rowHeight * 0.45),
          text: truncate(feature.name || `Feature ${index + 1}`, 64),
          zIndex: 4,
          style: {
            fill: text,
            fontFamily: font,
            fontSize: Math.round(height * 0.036),
            fontWeight: 700,
            align: "left",
          },
        }),
        textElement({
          id: `feature-body-${index}`,
          x: margin + markerSize + Math.round(width * 0.03),
          y: y + Math.round(rowHeight * 0.42),
          width: width - margin * 2 - markerSize - Math.round(width * 0.03),
          height: Math.round(rowHeight * 0.58),
          text: truncate(feature.description || feature.name || "", 160),
          zIndex: 4,
          style: {
            fill: FALLBACK_PALETTE.muted,
            fontFamily: font,
            fontSize: Math.round(height * 0.028),
            fontWeight: 400,
            align: "left",
            lineHeight: 1.3,
          },
        }),
      );
    });

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
