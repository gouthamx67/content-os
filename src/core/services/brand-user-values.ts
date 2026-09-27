import { BrandError, type BrandColor, type BrandFont, type BrandTerm } from "../domain/brand";
import type {
  BrandColorValues,
  BrandFontValues,
  BrandGuidelineValues,
  BrandTermValues,
  BrandVoiceSignalValues,
} from "../ports/brand-repository";
import { normalizeFontFamily, normalizeHexColor, normalizeTerm } from "../../lib/brand-normalization";

export type UserBrandPatch = {
  colors?: {
    name: string;
    hex: string;
    role: BrandColor["role"];
    notes?: string | null;
  }[];
  fonts?: {
    family: string;
    role: BrandFont["role"];
    weight?: string | null;
    style?: string | null;
    sourceUrl?: string | null;
    notes?: string | null;
  }[];
  terms?: {
    term: string;
    category: BrandTerm["category"];
    preference: BrandTerm["preference"];
    notes?: string | null;
  }[];
  guidelines?: { title: string; detail: string }[];
  voiceSignals?: { kind: string; value: string }[];
};

export type UserBrandValues = {
  colors: BrandColorValues[];
  fonts: BrandFontValues[];
  terms: BrandTermValues[];
  guidelines: BrandGuidelineValues[];
  voiceSignals: BrandVoiceSignalValues[];
};

/**
 * Validates and normalizes a user supplied brand patch. Everything that reaches
 * the canonical layer has already been through here, so a stored user value
 * always carries `origin: "USER"` and a usable canonical key.
 */
export function buildUserBrandValues(patch: UserBrandPatch): UserBrandValues {
  const colors: BrandColorValues[] = [];
  const seenColors = new Set<string>();
  for (const color of patch.colors ?? []) {
    const hex = normalizeHexColor(color.hex ?? "");
    if (!hex) {
      throw new BrandError(
        "BRAND_INVALID_INPUT",
        `"${color.hex}" is not a six digit hex color`,
      );
    }
    const name = (color.name ?? "").trim();
    if (!name) {
      throw new BrandError("BRAND_INVALID_INPUT", "Every color needs a name");
    }
    const key = `${color.role}:${hex}`;
    if (seenColors.has(key)) continue;
    seenColors.add(key);
    colors.push({
      name,
      hex,
      role: color.role,
      confidence: "HIGH",
      origin: "USER",
      basis: "USER",
      sourceIds: [],
      evidenceIds: [],
      notes: color.notes?.trim() || null,
    });
  }

  const fonts: BrandFontValues[] = [];
  const seenFonts = new Set<string>();
  for (const font of patch.fonts ?? []) {
    const family = normalizeFontFamily(font.family ?? "");
    if (!family) {
      throw new BrandError("BRAND_INVALID_INPUT", "Every font needs a family");
    }
    const key = `${font.role}:${family.toLowerCase()}`;
    if (seenFonts.has(key)) continue;
    seenFonts.add(key);
    fonts.push({
      family,
      role: font.role,
      weight: font.weight?.trim() || null,
      style: font.style?.trim() || null,
      sourceUrl: font.sourceUrl?.trim() || null,
      confidence: "HIGH",
      origin: "USER",
      basis: "USER",
      sourceIds: [],
      evidenceIds: [],
      notes: font.notes?.trim() || null,
    });
  }

  const terms: BrandTermValues[] = [];
  const seenTerms = new Set<string>();
  for (const term of patch.terms ?? []) {
    const value = normalizeTerm(term.term ?? "");
    if (!value) {
      throw new BrandError("BRAND_INVALID_INPUT", "Every term needs text");
    }
    const key = value.toLowerCase();
    if (seenTerms.has(key)) continue;
    seenTerms.add(key);
    terms.push({
      term: value,
      category: term.category,
      preference: term.preference,
      confidence: "HIGH",
      origin: "USER",
      basis: "USER",
      sourceIds: [],
      evidenceIds: [],
      notes: term.notes?.trim() || null,
    });
  }

  const guidelines: BrandGuidelineValues[] = [];
  const seenGuidelines = new Set<string>();
  for (const guideline of patch.guidelines ?? []) {
    const title = (guideline.title ?? "").trim();
    const detail = (guideline.detail ?? "").trim();
    if (!title || !detail) {
      throw new BrandError(
        "BRAND_INVALID_INPUT",
        "Every guideline needs a title and a detail",
      );
    }
    const key = title.toLowerCase();
    if (seenGuidelines.has(key)) continue;
    seenGuidelines.add(key);
    guidelines.push({
      title,
      detail,
      origin: "USER",
      basis: "USER",
      sourceIds: [],
      evidenceIds: [],
    });
  }

  const voiceSignals: BrandVoiceSignalValues[] = [];
  const seenSignals = new Set<string>();
  for (const signal of patch.voiceSignals ?? []) {
    const kind = (signal.kind ?? "").trim().toUpperCase();
    const value = (signal.value ?? "").trim();
    if (!kind || !value) continue;
    const key = `${kind}:${value.toLowerCase()}`;
    if (seenSignals.has(key)) continue;
    seenSignals.add(key);
    voiceSignals.push({
      kind,
      value,
      confidence: "HIGH",
      origin: "USER",
      basis: "USER",
      sourceIds: [],
      evidenceIds: [],
    });
  }

  return { colors, fonts, terms, guidelines, voiceSignals };
}
