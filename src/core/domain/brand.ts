export const BRAND_ORIGINS = ["EXTRACTED", "INFERRED", "USER"] as const;
export type BrandOrigin = (typeof BRAND_ORIGINS)[number];

export const BRAND_CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
export type BrandConfidence = (typeof BRAND_CONFIDENCE_LEVELS)[number];

export const BRAND_STATUSES = ["DRAFT", "READY", "STALE"] as const;
export type BrandStatus = (typeof BRAND_STATUSES)[number];

export const BRAND_COLOR_ROLES = [
  "PRIMARY",
  "SECONDARY",
  "ACCENT",
  "BACKGROUND",
  "SURFACE",
  "TEXT",
  "MUTED",
  "BORDER",
  "SUCCESS",
  "WARNING",
  "DANGER",
  "NEUTRAL",
] as const;
export type BrandColorRole = (typeof BRAND_COLOR_ROLES)[number];

export const BRAND_FONT_ROLES = [
  "HEADING",
  "BODY",
  "DISPLAY",
  "MONOSPACE",
  "UI",
  "CAPTION",
] as const;
export type BrandFontRole = (typeof BRAND_FONT_ROLES)[number];

export const BRAND_ASSET_ROLES = [
  "LOGO",
  "PRIMARY_LOGO",
  "MARK",
  "WORDMARK",
  "ICON",
  "FAVICON",
  "PATTERN",
  "TEXTURE",
  "ILLUSTRATION",
  "PHOTOGRAPHY_STYLE",
] as const;
export type BrandAssetRole = (typeof BRAND_ASSET_ROLES)[number];

export const BRAND_TERM_CATEGORIES = [
  "FEATURE",
  "PROBLEM",
  "VALUE_PROP",
  "CALL_TO_ACTION",
  "AUDIENCE",
  "COMPETITOR",
  "INDUSTRY_TERM",
] as const;
export type BrandTermCategory = (typeof BRAND_TERM_CATEGORIES)[number];

export const BRAND_TERM_PREFERENCES = ["PREFERRED", "AVOID", "NEUTRAL"] as const;
export type BrandTermPreference = (typeof BRAND_TERM_PREFERENCES)[number];

export const BRAND_TEXT_FIELDS = [
  "name",
  "positioning",
  "tagline",
  "valueProposition",
  "voiceSummary",
  "visualStyle",
] as const;
export type BrandTextField = (typeof BRAND_TEXT_FIELDS)[number];

export function isBrandTextField(value: string): value is BrandTextField {
  return (BRAND_TEXT_FIELDS as readonly string[]).includes(value);
}

export const BRAND_ERROR_CODES = [
  "BRAND_INVALID_INPUT",
  "BRAND_NOT_FOUND",
  "BRAND_LOCKED",
  "BRAND_NO_SOURCES",
  "BRAND_AI_INVALID_OUTPUT",
  "BRAND_AI_UNAVAILABLE",
  "BRAND_SOURCE_UNREADABLE",
  "BRAND_SCOPE_VIOLATION",
] as const;
export type BrandErrorCode = (typeof BRAND_ERROR_CODES)[number];

export class BrandError extends Error {
  override readonly name = "BrandError";

  constructor(
    readonly code: BrandErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Ordered weakest to strongest. A candidate produced by a weaker basis never
 * overwrites a stronger one for the same canonical key, and a user correction
 * outranks every automatic basis.
 */
export const BRAND_PRECEDENCE_ORDER = [
  "INFERENCE",
  "GENERAL_EXTRACTION",
  "RECOGNIZED_ASSET",
  "DESIGN_TOKEN",
  "EXPLICIT_GUIDELINE",
  "USER",
] as const;
export type BrandPrecedence = (typeof BRAND_PRECEDENCE_ORDER)[number];

export function brandPrecedenceRank(precedence: BrandPrecedence): number {
  return BRAND_PRECEDENCE_ORDER.indexOf(precedence);
}

export function brandPrecedenceForOrigin(origin: BrandOrigin): BrandPrecedence {
  if (origin === "USER") return "USER";
  if (origin === "INFERRED") return "INFERENCE";
  return "GENERAL_EXTRACTION";
}

export function maxBrandPrecedence(
  left: BrandPrecedence,
  right: BrandPrecedence,
): BrandPrecedence {
  return brandPrecedenceRank(left) >= brandPrecedenceRank(right) ? left : right;
}

export type BrandProvenance = {
  sourceIds: string[];
  evidenceIds: string[];
};

export type BrandVoiceSignal = BrandProvenance & {
  id: string;
  kind: string;
  value: string;
  confidence: BrandConfidence;
  origin: BrandOrigin;
  basis: BrandPrecedence;
};

export type BrandColor = BrandProvenance & {
  id: string;
  name: string;
  hex: string;
  role: BrandColorRole;
  confidence: BrandConfidence;
  origin: BrandOrigin;
  basis: BrandPrecedence;
  notes: string | null;
};

export type BrandFont = BrandProvenance & {
  id: string;
  family: string;
  role: BrandFontRole;
  weight: string | null;
  style: string | null;
  sourceUrl: string | null;
  confidence: BrandConfidence;
  origin: BrandOrigin;
  basis: BrandPrecedence;
  notes: string | null;
};

export type BrandAsset = BrandProvenance & {
  id: string;
  assetId: string;
  role: BrandAssetRole;
  label: string;
  confidence: BrandConfidence;
  origin: BrandOrigin;
  basis: BrandPrecedence;
  notes: string | null;
};

export type BrandTerm = BrandProvenance & {
  id: string;
  term: string;
  category: BrandTermCategory;
  preference: BrandTermPreference;
  confidence: BrandConfidence;
  origin: BrandOrigin;
  basis: BrandPrecedence;
  notes: string | null;
};

export type BrandGuideline = BrandProvenance & {
  id: string;
  title: string;
  detail: string;
  origin: BrandOrigin;
  basis: BrandPrecedence;
};

/**
 * A losing candidate is kept instead of being dropped, so a brand that names
 * two different primary colors shows both plus the retained one rather than
 * hiding the disagreement.
 */
export type BrandConflict = BrandProvenance & {
  id: string;
  field: string;
  retained: string;
  competing: string;
  resolvedBy: BrandPrecedence;
};

export type BrandTextOrigins = Partial<Record<BrandTextField, BrandOrigin>>;

export type BrandProfile = {
  id: string;
  projectId: string;
  name: string | null;
  positioning: string | null;
  tagline: string | null;
  valueProposition: string | null;
  voiceSummary: string | null;
  visualStyle: string | null;
  colors: BrandColor[];
  fonts: BrandFont[];
  assets: BrandAsset[];
  terms: BrandTerm[];
  voiceSignals: BrandVoiceSignal[];
  guidelines: BrandGuideline[];
  conflicts: BrandConflict[];
  textOrigins: BrandTextOrigins;
  status: BrandStatus;
  confidence: BrandConfidence;
  version: number;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BrandSourceState = {
  sourceId: string;
  contentHash: string | null;
  sourceUpdatedAt: string;
  analyzerId: string;
  analyzerRevision: string | null;
  brandVersion: number;
  analyzedAt: string;
};

export function emptyBrandProfile(projectId: string, id: string, now: string): BrandProfile {
  return {
    id,
    projectId,
    name: null,
    positioning: null,
    tagline: null,
    valueProposition: null,
    voiceSummary: null,
    visualStyle: null,
    colors: [],
    fonts: [],
    assets: [],
    terms: [],
    voiceSignals: [],
    guidelines: [],
    conflicts: [],
    textOrigins: {},
    status: "DRAFT",
    confidence: "LOW",
    version: 1,
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function brandTextValue(
  profile: Pick<BrandProfile, BrandTextField>,
  field: BrandTextField,
): string | null {
  return profile[field];
}

export function withBrandText<T extends Pick<BrandProfile, BrandTextField>>(
  profile: T,
  field: BrandTextField,
  value: string | null,
): T {
  return { ...profile, [field]: value };
}

export function brandMaterialSections(profile: Pick<BrandProfile, BrandTextField | "colors" | "fonts" | "assets" | "terms" | "voiceSignals" | "guidelines">): {
  identity: boolean;
  narrative: boolean;
  color: boolean;
  typography: boolean;
  assets: boolean;
  language: boolean;
} {
  return {
    identity: Boolean(brandTextValue(profile, "name")?.trim()),
    narrative: Boolean(
      (brandTextValue(profile, "positioning") ?? brandTextValue(profile, "valueProposition") ?? brandTextValue(profile, "tagline"))?.trim() ||
        brandTextValue(profile, "voiceSummary")?.trim(),
    ),
    color: profile.colors.length > 0,
    typography: profile.fonts.length > 0,
    assets: profile.assets.length > 0,
    language:
      profile.terms.length > 0 ||
      profile.guidelines.length > 0 ||
      profile.voiceSignals.length > 0,
  };
}

export function computeBrandConfidence(profile: Parameters<typeof brandMaterialSections>[0]): BrandConfidence {
  const sections = brandMaterialSections(profile);
  const present = [
    sections.identity,
    sections.narrative,
    sections.color,
    sections.typography,
    sections.assets,
    sections.language,
  ].filter(Boolean).length;

  if (sections.identity && present >= 5) return "HIGH";
  if (sections.identity && present >= 3) return "MEDIUM";
  if (present >= 3) return "LOW";
  return "LOW";
}

export function computeBrandStatus(
  profile: Parameters<typeof brandMaterialSections>[0],
  options: { stale: boolean },
): BrandStatus {
  if (options.stale) return "STALE";
  const sections = brandMaterialSections(profile);
  if (!sections.identity) return "DRAFT";
  if (computeBrandConfidence(profile) === "LOW") return "DRAFT";
  return "READY";
}

/**
 * Read-only contract handed to downstream generators. It is derived, never
 * stored, so a later generator cannot observe two different notions of the
 * brand: anything not in this shape is not treated as canonical.
 */
export type BrandExecutionProfile = {
  brandId: string;
  projectId: string;
  name: string | null;
  tagline: string | null;
  positioning: string | null;
  valueProposition: string | null;
  voice: {
    summary: string | null;
    signals: { kind: string; value: string }[];
  };
  visual: {
    style: string | null;
    colors: { role: BrandColorRole; name: string; hex: string }[];
    fonts: {
      role: BrandFontRole;
      family: string;
      weight: string | null;
      style: string | null;
    }[];
    assets: { role: BrandAssetRole; label: string; assetId: string }[];
  };
  terms: { preferred: string[]; avoid: string[] };
  guidelines: { title: string; detail: string }[];
  status: BrandStatus;
  confidence: BrandConfidence;
  version: number;
  locked: boolean;
};

export function toBrandExecutionProfile(profile: BrandProfile): BrandExecutionProfile {
  const colorRank = new Map(BRAND_COLOR_ROLES.map((role, index) => [role, index]));
  const fontRank = new Map(BRAND_FONT_ROLES.map((role, index) => [role, index]));
  const assetRank = new Map(BRAND_ASSET_ROLES.map((role, index) => [role, index]));
  const confidenceRank: Record<BrandConfidence, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

  const colors = [...profile.colors]
    .sort(
      (left, right) =>
        (colorRank.get(left.role) ?? 99) - (colorRank.get(right.role) ?? 99) ||
        confidenceRank[left.confidence] - confidenceRank[right.confidence] ||
        left.name.localeCompare(right.name),
    )
    .map((color) => ({ role: color.role, name: color.name, hex: color.hex }));

  const fonts = [...profile.fonts]
    .sort(
      (left, right) =>
        (fontRank.get(left.role) ?? 99) - (fontRank.get(right.role) ?? 99) ||
        confidenceRank[left.confidence] - confidenceRank[right.confidence] ||
        left.family.localeCompare(right.family),
    )
    .map((font) => ({
      role: font.role,
      family: font.family,
      weight: font.weight,
      style: font.style,
    }));

  const assets = [...profile.assets]
    .sort(
      (left, right) =>
        (assetRank.get(left.role) ?? 99) - (assetRank.get(right.role) ?? 99) ||
        confidenceRank[left.confidence] - confidenceRank[right.confidence],
    )
    .map((asset) => ({ role: asset.role, label: asset.label, assetId: asset.assetId }));

  return {
    brandId: profile.id,
    projectId: profile.projectId,
    name: profile.name,
    tagline: profile.tagline,
    positioning: profile.positioning,
    valueProposition: profile.valueProposition,
    voice: {
      summary: profile.voiceSummary,
      signals: profile.voiceSignals
        .map((signal) => ({ kind: signal.kind, value: signal.value }))
        .sort((left, right) => left.kind.localeCompare(right.kind)),
    },
    visual: { style: profile.visualStyle, colors, fonts, assets },
    terms: {
      preferred: uniqueTerms(profile.terms.filter((term) => term.preference === "PREFERRED")),
      avoid: uniqueTerms(profile.terms.filter((term) => term.preference === "AVOID")),
    },
    guidelines: profile.guidelines
      .map((guideline) => ({ title: guideline.title, detail: guideline.detail }))
      .sort((left, right) => left.title.localeCompare(right.title)),
    status: profile.status,
    confidence: profile.confidence,
    version: profile.version,
    locked: profile.locked,
  };
}

function uniqueTerms(terms: readonly BrandTerm[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const term of terms) {
    const value = term.term.trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    values.push(value);
  }
  return values;
}
