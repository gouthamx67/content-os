import {
  BRAND_CONFIDENCE_LEVELS,
  BRAND_TERM_CATEGORIES,
  BRAND_TERM_PREFERENCES,
  BRAND_TEXT_FIELDS,
  BrandError,
  type BrandConfidence,
  type BrandTermCategory,
  type BrandTermPreference,
  type BrandTextField,
} from "./brand";
import { normalizeTerm } from "../../lib/brand-normalization";
import type {
  BrandInterpretedTerm,
  BrandInterpretedText,
  BrandInterpretedVoiceSignal,
  BrandInterpretationResult,
} from "../ports/brand-interpretation-provider";

const MAX_VALUE = 400;
const MAX_VALUE_LIST = 6;
const MAX_TERM_LENGTH = 60;
const MAX_SIGNALS = 8;

const FORBIDDEN_KEYS = [
  "colors",
  "colour",
  "colours",
  "font",
  "fonts",
  "fontfamily",
  "typography",
  "logo",
  "logos",
  "asset",
  "assets",
  "image",
  "images",
  "hex",
  "palette",
];

export interface BrandInterpretationContext {
  allowedEvidenceKeys: ReadonlySet<string>;
  alreadyDetermined: ReadonlySet<BrandTextField>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  value: unknown,
  label: string,
  max: number,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new BrandError(
      "BRAND_AI_INVALID_OUTPUT",
      `Brand model returned a ${label} longer than ${max} characters`,
    );
  }
  return trimmed;
}

function confidenceField(value: unknown): BrandConfidence {
  return BRAND_CONFIDENCE_LEVELS.includes(value as BrandConfidence)
    ? (value as BrandConfidence)
    : "LOW";
}

/**
 * Every assertion has to name evidence the deterministic analyzers actually
 * gathered. A missing key list is treated the same as an unsupported one: an
 * assertion the model cannot cite is an assertion it invented.
 */
function evidenceKeysField(
  value: unknown,
  context: BrandInterpretationContext,
  label: string,
): string[] {
  const keys = Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .filter((entry) => context.allowedEvidenceKeys.has(entry))
    : [];
  if (keys.length === 0) {
    throw new BrandError(
      "BRAND_AI_INVALID_OUTPUT",
      `Brand model asserted a ${label} with no evidence the deterministic analyzer gathered`,
    );
  }
  return [...new Set(keys)];
}

/**
 * Material facts a model must not produce are dropped rather than rejected, so
 * one hallucinated hex value cannot discard an otherwise evidence backed
 * interpretation. The result notes record what was ignored.
 */
export function parseBrandInterpretation(
  parsed: unknown,
  context: BrandInterpretationContext,
): {
  text: BrandInterpretedText[];
  voiceSignals: BrandInterpretedVoiceSignal[];
  terms: BrandInterpretedTerm[];
  notes: string[];
} {
  if (!isRecord(parsed)) {
    throw new BrandError("BRAND_AI_INVALID_OUTPUT", "Brand model did not return a JSON object");
  }

  const notes: string[] = [];
  for (const key of Object.keys(parsed)) {
    if (FORBIDDEN_KEYS.includes(key.replace(/[^a-z]/gi, "").toLowerCase())) {
      notes.push(`Ignored ${key}: the model may not describe brand material facts`);
    }
  }

  const text: BrandInterpretedText[] = [];
  for (const field of BRAND_TEXT_FIELDS) {
    if (field === "name") continue;
    if (context.alreadyDetermined.has(field)) continue;
    const value = stringField(parsed[field], field, MAX_VALUE);
    if (!value) continue;
    const evidenceKeys = evidenceKeysField(parsed[`${field}EvidenceKeys`], context, field);
    text.push({ field: field as BrandTextField, value, confidence: confidenceField(parsed[`${field}Confidence`]), evidenceKeys });
  }

  const voiceSignals: BrandInterpretedVoiceSignal[] = [];
  if (Array.isArray(parsed.voiceSignals)) {
    for (const entry of parsed.voiceSignals.slice(0, MAX_SIGNALS)) {
      if (!isRecord(entry)) continue;
      const kind = stringField(entry.kind, "voice signal kind", 40);
      const value = stringField(entry.value, "voice signal", MAX_VALUE);
      if (!kind || !value) continue;
      voiceSignals.push({
        kind: kind.toUpperCase().replace(/\s+/g, "_"),
        value,
        confidence: confidenceField(entry.confidence),
        evidenceKeys: evidenceKeysField(entry.evidenceKeys, context, `voice signal ${kind}`),
      });
    }
  }

  const terms: BrandInterpretedTerm[] = [];
  const termGroups: { preference: BrandTermPreference; key: string }[] = [
    { preference: "PREFERRED", key: "preferredTerms" },
    { preference: "AVOID", key: "avoidTerms" },
  ];
  for (const group of termGroups) {
    const raw = parsed[group.key];
    if (!Array.isArray(raw)) continue;
    for (const entry of raw.slice(0, MAX_VALUE_LIST)) {
      const record: Record<string, unknown> = isRecord(entry) ? entry : { term: entry };
      const term = stringField(record.term, "term", MAX_TERM_LENGTH);
      if (!term) continue;
      const category = BRAND_TERM_CATEGORIES.includes(record.category as BrandTermCategory)
        ? (record.category as BrandTermCategory)
        : "INDUSTRY_TERM";
      const preference = BRAND_TERM_PREFERENCES.includes(record.preference as BrandTermPreference)
        ? (record.preference as BrandTermPreference)
        : group.preference;
      terms.push({
        term: normalizeTerm(term),
        category,
        preference,
        confidence: confidenceField(record.confidence),
        evidenceKeys: evidenceKeysField(record.evidenceKeys, context, `term ${term}`),
      });
    }
  }

  if (text.length === 0 && voiceSignals.length === 0 && terms.length === 0) {
    throw new BrandError(
      "BRAND_AI_INVALID_OUTPUT",
      "Brand model returned nothing that the gathered evidence supports",
    );
  }

  return { text, voiceSignals, terms, notes };
}

export function emptyBrandInterpretation(): BrandInterpretationResult {
  return {
    provider: "",
    model: "",
    text: [],
    voiceSignals: [],
    terms: [],
    notes: [],
  };
}
