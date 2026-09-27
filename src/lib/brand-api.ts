import {
  BRAND_COLOR_ROLES,
  BRAND_FONT_ROLES,
  BRAND_TERM_CATEGORIES,
  BRAND_TERM_PREFERENCES,
  brandMaterialSections,
  BrandError,
  toBrandExecutionProfile,
  type BrandAsset,
  type BrandColor,
  type BrandConflict,
  type BrandFont,
  type BrandGuideline,
  type BrandProfile,
  type BrandSourceState,
  type BrandTerm,
  type BrandVoiceSignal,
} from "../core/domain/brand";
import type {
  BrandUserColorInput,
  BrandUserFontInput,
  BrandUserGuidelineInput,
  BrandUserTermInput,
  BrandUserVoiceSignalInput,
  UpdateBrandInput,
} from "../core/ports/brand-repository";
import { HttpError, jsonError, wrapHttpError } from "./http";

const BRAND_ERROR_STATUS: Readonly<Record<string, number>> = {
  BRAND_INVALID_INPUT: 400,
  BRAND_NOT_FOUND: 404,
  BRAND_LOCKED: 409,
  BRAND_NO_SOURCES: 422,
  BRAND_AI_INVALID_OUTPUT: 422,
  BRAND_AI_UNAVAILABLE: 422,
  BRAND_SOURCE_UNREADABLE: 422,
  BRAND_SCOPE_VIOLATION: 403,
};

export function wrapBrandHttpError(error: unknown): Response {
  if (error instanceof BrandError) {
    return jsonError(BRAND_ERROR_STATUS[error.code] ?? 500, error.message, {
      code: error.code,
    });
  }
  return wrapHttpError(error);
}

/**
 * Provenance leaves the API as opaque ids only. Locators, excerpts and source
 * storage details stay server side: a brand view is rendered in a project page,
 * not a document dump, and a client has no need for a path or a raw span.
 */
function provenance(value: { sourceIds: string[]; evidenceIds: string[] }) {
  return {
    sourceIds: [...value.sourceIds],
    evidenceIds: [...value.evidenceIds],
  };
}

export type SerializedBrandColor = {
  id: string;
  name: string;
  hex: string;
  role: BrandColor["role"];
  confidence: BrandColor["confidence"];
  origin: BrandColor["origin"];
  basis: BrandColor["basis"];
  notes: string | null;
  provenance: ReturnType<typeof provenance>;
};

export type SerializedBrandFont = {
  id: string;
  family: string;
  role: BrandFont["role"];
  weight: string | null;
  style: string | null;
  sourceUrl: string | null;
  confidence: BrandFont["confidence"];
  origin: BrandFont["origin"];
  basis: BrandFont["basis"];
  notes: string | null;
  provenance: ReturnType<typeof provenance>;
};

/**
 * Assets are referenced by id, never by storage uri: the brand layer points at
 * project assets and must not become a second path to the bytes.
 */
export type SerializedBrandAsset = {
  id: string;
  assetId: string;
  role: BrandAsset["role"];
  label: string;
  confidence: BrandAsset["confidence"];
  origin: BrandAsset["origin"];
  basis: BrandAsset["basis"];
  notes: string | null;
  provenance: ReturnType<typeof provenance>;
};

export type SerializedBrandTerm = {
  id: string;
  term: string;
  category: BrandTerm["category"];
  preference: BrandTerm["preference"];
  confidence: BrandTerm["confidence"];
  origin: BrandTerm["origin"];
  basis: BrandTerm["basis"];
  notes: string | null;
  provenance: ReturnType<typeof provenance>;
};

export type SerializedBrandVoiceSignal = {
  id: string;
  kind: string;
  value: string;
  confidence: BrandVoiceSignal["confidence"];
  origin: BrandVoiceSignal["origin"];
  basis: BrandVoiceSignal["basis"];
  provenance: ReturnType<typeof provenance>;
};

export type SerializedBrandGuideline = {
  id: string;
  title: string;
  detail: string;
  origin: BrandGuideline["origin"];
  basis: BrandGuideline["basis"];
  provenance: ReturnType<typeof provenance>;
};

export type SerializedBrandConflict = {
  id: string;
  field: string;
  retained: string;
  competing: string;
  resolvedBy: BrandConflict["resolvedBy"];
  provenance: ReturnType<typeof provenance>;
};

export type SerializedBrandSourceState = {
  sourceId: string;
  contentHash: string | null;
  sourceUpdatedAt: string;
  analyzerId: string;
  brandVersion: number;
  analyzedAt: string;
};

export type SerializedBrandProfile = {
  id: string;
  projectId: string;
  name: string | null;
  positioning: string | null;
  tagline: string | null;
  valueProposition: string | null;
  voiceSummary: string | null;
  visualStyle: string | null;
  colors: SerializedBrandColor[];
  fonts: SerializedBrandFont[];
  assets: SerializedBrandAsset[];
  terms: SerializedBrandTerm[];
  voiceSignals: SerializedBrandVoiceSignal[];
  guidelines: SerializedBrandGuideline[];
  conflicts: SerializedBrandConflict[];
  textOrigins: BrandProfile["textOrigins"];
  status: BrandProfile["status"];
  confidence: BrandProfile["confidence"];
  version: number;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  sections: ReturnType<typeof brandMaterialSections>;
  execution: ReturnType<typeof toBrandExecutionProfile>;
};

export function serializeBrandProfile(profile: BrandProfile): SerializedBrandProfile {
  return {
    id: profile.id,
    projectId: profile.projectId,
    name: profile.name,
    positioning: profile.positioning,
    tagline: profile.tagline,
    valueProposition: profile.valueProposition,
    voiceSummary: profile.voiceSummary,
    visualStyle: profile.visualStyle,
    colors: profile.colors.map((color) => ({
      id: color.id,
      name: color.name,
      hex: color.hex,
      role: color.role,
      confidence: color.confidence,
      origin: color.origin,
      basis: color.basis,
      notes: color.notes,
      provenance: provenance(color),
    })),
    fonts: profile.fonts.map((font) => ({
      id: font.id,
      family: font.family,
      role: font.role,
      weight: font.weight,
      style: font.style,
      sourceUrl: font.sourceUrl,
      confidence: font.confidence,
      origin: font.origin,
      basis: font.basis,
      notes: font.notes,
      provenance: provenance(font),
    })),
    assets: profile.assets.map((asset) => ({
      id: asset.id,
      assetId: asset.assetId,
      role: asset.role,
      label: asset.label,
      confidence: asset.confidence,
      origin: asset.origin,
      basis: asset.basis,
      notes: asset.notes,
      provenance: provenance(asset),
    })),
    terms: profile.terms.map((term) => ({
      id: term.id,
      term: term.term,
      category: term.category,
      preference: term.preference,
      confidence: term.confidence,
      origin: term.origin,
      basis: term.basis,
      notes: term.notes,
      provenance: provenance(term),
    })),
    voiceSignals: profile.voiceSignals.map((signal) => ({
      id: signal.id,
      kind: signal.kind,
      value: signal.value,
      confidence: signal.confidence,
      origin: signal.origin,
      basis: signal.basis,
      provenance: provenance(signal),
    })),
    guidelines: profile.guidelines.map((guideline) => ({
      id: guideline.id,
      title: guideline.title,
      detail: guideline.detail,
      origin: guideline.origin,
      basis: guideline.basis,
      provenance: provenance(guideline),
    })),
    conflicts: profile.conflicts.map((conflict) => ({
      id: conflict.id,
      field: conflict.field,
      retained: conflict.retained,
      competing: conflict.competing,
      resolvedBy: conflict.resolvedBy,
      provenance: provenance(conflict),
    })),
    textOrigins: profile.textOrigins,
    status: profile.status,
    confidence: profile.confidence,
    version: profile.version,
    locked: profile.locked,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    sections: brandMaterialSections(profile),
    execution: toBrandExecutionProfile(profile),
  };
}

export function serializeBrandSourceStates(
  states: readonly BrandSourceState[],
): SerializedBrandSourceState[] {
  return states.map((state) => ({
    sourceId: state.sourceId,
    contentHash: state.contentHash,
    sourceUpdatedAt: state.sourceUpdatedAt,
    analyzerId: state.analyzerId,
    brandVersion: state.brandVersion,
    analyzedAt: state.analyzedAt,
  }));
}

const TEXT_FIELDS = [
  "name",
  "positioning",
  "tagline",
  "valueProposition",
  "voiceSummary",
  "visualStyle",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalText(
  body: Record<string, unknown>,
  field: (typeof TEXT_FIELDS)[number],
): string | null | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be a string or null`);
  }
  return value;
}

function requireObjectArray(body: Record<string, unknown>, field: string): Record<string, unknown>[] {
  const value = body[field];
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${field} must be an array`);
  }
  return value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new HttpError(400, `${field}[${index}] must be an object`);
    }
    return entry;
  });
}

function requiredEntryString(
  entry: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const value = entry[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${label}.${field} is required`);
  }
  return value;
}

function optionalEntryString(
  entry: Record<string, unknown>,
  field: string,
  label: string,
): string | null {
  if (!(field in entry) || entry[field] === null) return null;
  const value = entry[field];
  if (typeof value !== "string") {
    throw new HttpError(400, `${label}.${field} must be a string`);
  }
  return value;
}

function entryEnum<T extends string>(
  entry: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  label: string,
): T {
  const value = entry[field];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new HttpError(400, `${label}.${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function parseColors(body: Record<string, unknown>): BrandUserColorInput[] {
  return requireObjectArray(body, "colors").map((entry, index) => {
    const label = `colors[${index}]`;
    return {
      name: requiredEntryString(entry, "name", label),
      hex: requiredEntryString(entry, "hex", label),
      role: entryEnum(entry, "role", BRAND_COLOR_ROLES, label),
      notes: optionalEntryString(entry, "notes", label),
    };
  });
}

function parseFonts(body: Record<string, unknown>): BrandUserFontInput[] {
  return requireObjectArray(body, "fonts").map((entry, index) => {
    const label = `fonts[${index}]`;
    return {
      family: requiredEntryString(entry, "family", label),
      role: entryEnum(entry, "role", BRAND_FONT_ROLES, label),
      weight: optionalEntryString(entry, "weight", label),
      style: optionalEntryString(entry, "style", label),
      sourceUrl: optionalEntryString(entry, "sourceUrl", label),
      notes: optionalEntryString(entry, "notes", label),
    };
  });
}

function parseTerms(body: Record<string, unknown>): BrandUserTermInput[] {
  return requireObjectArray(body, "terms").map((entry, index) => {
    const label = `terms[${index}]`;
    return {
      term: requiredEntryString(entry, "term", label),
      category: entryEnum(entry, "category", BRAND_TERM_CATEGORIES, label),
      preference: entryEnum(entry, "preference", BRAND_TERM_PREFERENCES, label),
      notes: optionalEntryString(entry, "notes", label),
    };
  });
}

function parseGuidelines(body: Record<string, unknown>): BrandUserGuidelineInput[] {
  return requireObjectArray(body, "guidelines").map((entry, index) => {
    const label = `guidelines[${index}]`;
    return {
      title: requiredEntryString(entry, "title", label),
      detail: requiredEntryString(entry, "detail", label),
    };
  });
}

function parseVoiceSignals(body: Record<string, unknown>): BrandUserVoiceSignalInput[] {
  return requireObjectArray(body, "voiceSignals").map((entry, index) => {
    const label = `voiceSignals[${index}]`;
    return {
      kind: requiredEntryString(entry, "kind", label),
      value: requiredEntryString(entry, "value", label),
    };
  });
}

/**
 * A collection the client sends replaces the stored one, and a collection it
 * omits is left untouched. That is why the presence of the key matters and is
 * checked here rather than defaulted: an absent key must not read as "empty".
 */
export function parseBrandUpdateRequest(
  body: Record<string, unknown>,
): UpdateBrandInput {
  const update: UpdateBrandInput = {};

  for (const field of TEXT_FIELDS) {
    const value = optionalText(body, field);
    if (value !== undefined) update[field] = value;
  }

  if ("colors" in body) update.colors = parseColors(body);
  if ("fonts" in body) update.fonts = parseFonts(body);
  if ("terms" in body) update.terms = parseTerms(body);
  if ("guidelines" in body) update.guidelines = parseGuidelines(body);
  if ("voiceSignals" in body) update.voiceSignals = parseVoiceSignals(body);

  if (Object.keys(update).length === 0) {
    throw new HttpError(400, "At least one brand field is required");
  }

  return update;
}

export function parseBrandSourceIds(body: Record<string, unknown>): string[] | undefined {
  if (!("sourceIds" in body)) return undefined;
  const value = body.sourceIds;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new HttpError(400, "sourceIds must be an array of strings");
  }
  return value;
}

export function parseBrandForce(body: Record<string, unknown>): boolean {
  if (!("force" in body)) return false;
  if (body.force !== true && body.force !== false) {
    throw new HttpError(400, "force must be a boolean");
  }
  return body.force;
}
