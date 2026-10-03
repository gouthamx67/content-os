import type {
  GenerationBrandContext,
  GenerationContext,
  GraphicElement,
  GraphicStyle,
} from "../domain/types";

export const FALLBACK_PALETTE = {
  background: "#0B0B12",
  surface: "#17172A",
  primary: "#7C5CFF",
  accent: "#22D3EE",
  text: "#FFFFFF",
  muted: "#B4B4C8",
} as const;

export function pickColor(
  brand: GenerationBrandContext,
  roles: readonly string[],
  fallback: string,
): string {
  for (const role of roles) {
    const match = brand.colors.find(
      (color) => color.role.toLowerCase() === role.toLowerCase(),
    );
    if (match && isHex(match.hex)) return normalizeHex(match.hex);
  }
  return fallback;
}

export function pickFont(
  brand: GenerationBrandContext,
  roles: readonly string[],
  fallback: string,
): string {
  for (const role of roles) {
    const match = brand.fonts.find(
      (font) => font.role.toLowerCase() === role.toLowerCase(),
    );
    if (match && match.family.trim().length > 0) return match.family.trim();
  }
  return fallback;
}

export function isHex(value: string): boolean {
  return /^#?[0-9a-fA-F]{3,8}$/.test(value.trim());
}

export function normalizeHex(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

/** The graphic's headline. Falls back through tagline, thesis and request. */
export function headlineFor(context: GenerationContext): string {
  const candidates = [
    context.directionThesis,
    context.brand.tagline,
    context.product.valueProposition,
    context.product.name,
    context.userRequest,
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.trim().length > 0) return candidate.trim();
  }
  return "Untitled";
}

export function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}\u2026`;
}

/** Wraps a string to fit a character budget per line, up to a line cap. */
export function wrap(value: string, maxChars: number, maxLines: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current.length > 0) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current.length > 0 && lines.length < maxLines) lines.push(current);
  return lines.join("\n");
}

export function textElement(input: {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  zIndex: number;
  style: GraphicStyle;
}): GraphicElement {
  return {
    id: input.id,
    type: "TEXT",
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    zIndex: input.zIndex,
    text: input.text,
    style: input.style,
  };
}

export function rectElement(input: {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  style: GraphicStyle;
}): GraphicElement {
  return {
    id: input.id,
    type: "RECT",
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    zIndex: input.zIndex,
    style: input.style,
  };
}

export function circleElement(input: {
  id: string;
  x: number;
  y: number;
  size: number;
  zIndex: number;
  style: GraphicStyle;
}): GraphicElement {
  return {
    id: input.id,
    type: "CIRCLE",
    x: input.x,
    y: input.y,
    width: input.size,
    height: input.size,
    zIndex: input.zIndex,
    style: input.style,
  };
}

export function imageElement(input: {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  assetRef: string;
  style?: GraphicStyle;
}): GraphicElement {
  return {
    id: input.id,
    type: "IMAGE",
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    zIndex: input.zIndex,
    assetRef: input.assetRef,
    style: input.style,
  };
}
