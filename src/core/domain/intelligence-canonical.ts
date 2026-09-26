import {
  IntelligenceError,
  type AssertionKind,
  type ExtractionMethod,
  type IntelligenceConfidence,
  type IntelligenceEntityType,
  type Provenance,
} from "./intelligence";

const MAX_CANONICAL_INPUT = 200;
const MAX_CANONICAL_LENGTH = 120;

export const MAX_LEXICAL_DIFFERENCE = 0.18;

const CONFIDENCE_RANK: Record<IntelligenceConfidence, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const ASSERTION_RANK: Record<AssertionKind, number> = {
  USER_PROVIDED: 4,
  FACT: 3,
  MARKETING_CLAIM: 2,
  INFERENCE: 1,
};

export function normalizeIntelligenceText(value: string): string {
  const truncated = value.slice(0, MAX_CANONICAL_INPUT);
  return truncated
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function canonicalSlug(value: string): string {
  const normalized = normalizeIntelligenceText(value);
  if (!normalized) return "";
  return normalized
    .split(" ")
    .filter((token) => token.length > 0)
    .slice(0, 12)
    .join("-")
    .slice(0, MAX_CANONICAL_LENGTH);
}

export function canonicalEntityKey(
  type: IntelligenceEntityType,
  value: string,
): string {
  const prefix = type.toLowerCase();
  if (type === "PRODUCT") return prefix;
  const slug = canonicalSlug(value);
  if (!slug) {
    throw new IntelligenceError(
      "INTELLIGENCE_INVALID_INPUT",
      `Cannot derive a canonical key for a ${type} without a usable name`,
    );
  }
  return `${prefix}:${slug}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function canonicalEvidenceKey(
  sourceId: string,
  kind: string,
  locator: string,
): string {
  return `evidence:${fnv1a(`${sourceId}|${kind}|${locator}`)}`;
}

function tokenSet(value: string): Set<string> {
  const normalized = normalizeIntelligenceText(value);
  return new Set(normalized.length > 0 ? normalized.split(" ") : []);
}

function tokenDifference(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 && rightTokens.size === 0) return 0;
  if (leftTokens.size === 0 || rightTokens.size === 0) return 1;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 1 : 1 - shared / union;
}

function trigrams(value: string): Set<string> {
  const normalized = normalizeIntelligenceText(value).replace(/ /g, "");
  const grams = new Set<string>();
  if (normalized.length < 3) {
    if (normalized.length > 0) grams.add(normalized);
    return grams;
  }
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    grams.add(normalized.slice(index, index + 3));
  }
  return grams;
}

function trigramDifference(left: string, right: string): number {
  const leftGrams = trigrams(left);
  const rightGrams = trigrams(right);
  if (leftGrams.size === 0 && rightGrams.size === 0) return 0;
  if (leftGrams.size === 0 || rightGrams.size === 0) return 1;

  let shared = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) shared += 1;
  }
  const union = new Set([...leftGrams, ...rightGrams]).size;
  return union === 0 ? 1 : 1 - shared / union;
}

function commonPrefixRatio(left: string, right: string): number {
  const a = normalizeIntelligenceText(left).replace(/ /g, "");
  const b = normalizeIntelligenceText(right).replace(/ /g, "");
  const shortest = Math.min(a.length, b.length);
  if (shortest < 4 || a.length === 0 || b.length === 0) return 0;
  let shared = 0;
  while (shared < shortest && a[shared] === b[shared]) shared += 1;
  return shared / Math.max(a.length, b.length);
}

export function lexicalDifference(left: string, right: string): number {
  const similarity = Math.max(
    1 - tokenDifference(left, right),
    1 - trigramDifference(left, right),
    commonPrefixRatio(left, right),
  );
  return 1 - similarity;
}

export function isDuplicateEntity(
  candidateName: string,
  existingName: string,
): boolean {
  if (!existingName) return false;
  if (
    normalizeIntelligenceText(candidateName) === normalizeIntelligenceText(existingName)
  ) {
    return true;
  }
  return lexicalDifference(candidateName, existingName) <= MAX_LEXICAL_DIFFERENCE;
}

const MIN_COVERED_TOKENS = 2;
const MIN_COVERAGE_RATIO = 0.5;

/**
 * Looser than `isDuplicateEntity`, on purpose. Used to decide whether free text
 * such as an image `alt` or a headline is *about* a named entity, which is a
 * linking question rather than a dedup question. Requires the phrase to be
 * multi-token and to account for a meaningful share of the text, so short
 * generic words do not match everything.
 */
export function textCoversPhrase(text: string, phrase: string): boolean {
  const haystack = tokenSet(text);
  const needle = tokenSet(phrase);
  if (needle.size < MIN_COVERED_TOKENS || haystack.size === 0) return false;
  for (const token of needle) {
    if (!haystack.has(token)) return false;
  }
  return needle.size / haystack.size >= MIN_COVERAGE_RATIO;
}

export function strongerConfidence(
  current: IntelligenceConfidence,
  incoming: IntelligenceConfidence,
): IntelligenceConfidence {
  return CONFIDENCE_RANK[incoming] > CONFIDENCE_RANK[current] ? incoming : current;
}

export function strongestAssertionKind(
  current: AssertionKind,
  incoming: AssertionKind,
): AssertionKind {
  return ASSERTION_RANK[incoming] > ASSERTION_RANK[current] ? incoming : current;
}

export function mergeIdLists(current: readonly string[], incoming: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of [...current, ...incoming]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
}

export function mergeProvenance(
  current: Provenance | null,
  incoming: Provenance,
): Provenance {
  if (!current) return { ...incoming, sourceIds: [...incoming.sourceIds], evidenceIds: [...incoming.evidenceIds] };
  return {
    sourceIds: mergeIdLists(current.sourceIds, incoming.sourceIds),
    evidenceIds: mergeIdLists(current.evidenceIds, incoming.evidenceIds),
    method: methodRank(incoming.method) > methodRank(current.method) ? incoming.method : current.method,
    extractedAt:
      new Date(incoming.extractedAt).getTime() > new Date(current.extractedAt).getTime()
        ? incoming.extractedAt
        : current.extractedAt,
  };
}

const METHOD_RANK: Record<ExtractionMethod, number> = {
  USER_INPUT: 3,
  DETERMINISTIC: 2,
  AI_INTERPRETATION: 1,
};

function methodRank(method: ExtractionMethod): number {
  return METHOD_RANK[method];
}

export function methodForAssertionKind(kind: AssertionKind): ExtractionMethod {
  if (kind === "USER_PROVIDED") return "USER_INPUT";
  if (kind === "FACT") return "DETERMINISTIC";
  return "AI_INTERPRETATION";
}

export function isMergeableField(field: string): boolean {
  return typeof field === "string" && field.length > 0 && field.length <= 64;
}
