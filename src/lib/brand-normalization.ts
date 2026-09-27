import type { BrandColorRole, BrandFontRole } from "../core/domain/brand";

const HEX_PATTERN = /^#?[0-9a-fA-F]{6}$/;
const HEX_ONLY = /^[0-9a-fA-F]{6}$/;

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (!HEX_PATTERN.test(trimmed)) return null;
  const body = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  return `#${body.toLowerCase()}`;
}

export function normalizeFontFamily(value: string): string {
  return value
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

export function normalizeTerm(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function canonicalColorKey(role: BrandColorRole, hex: string): string {
  const normalized = normalizeHexColor(hex);
  return `brand_color:${role}:${normalized ?? hex.trim().toLowerCase()}`;
}

export function canonicalFontKey(role: BrandFontRole, family: string): string {
  return `brand_font:${role}:${normalizeFontFamily(family).toLowerCase()}`;
}

export function canonicalTermKey(term: string): string {
  return `brand_term:${normalizeTerm(term).toLowerCase()}`;
}

export function brandEvidenceKey(
  sourceId: string,
  kind: string,
  locator: string,
): string {
  return `brand_evidence:${fnv1a(`${sourceId}|${kind}|${locator}`)}`;
}

export function brandEvidenceId(key: string): string {
  return `evb_${fnv1a(key)}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function isHexColor(value: string): boolean {
  return HEX_ONLY.test(value.trim());
}

export function brandCanonicalId(prefix: string, key: string): string {
  return `${prefix}_${fnv1a(key)}`;
}
