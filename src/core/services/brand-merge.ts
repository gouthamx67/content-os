import {
  brandPrecedenceRank,
  type BrandAsset,
  type BrandColor,
  type BrandConfidence,
  type BrandConflict,
  type BrandFont,
  type BrandGuideline,
  type BrandOrigin,
  type BrandPrecedence,
  type BrandTerm,
  type BrandVoiceSignal,
} from "../domain/brand";
import { brandCanonicalId } from "../../lib/brand-normalization";

export type BrandMaterialKind =
  | "text"
  | "color"
  | "font"
  | "asset"
  | "term"
  | "voiceSignal"
  | "guideline";

export interface BrandMergeEntry {
  kind: BrandMaterialKind;
  key: string;
  value: string;
  origin: BrandOrigin;
  basis: BrandPrecedence;
  confidence: BrandConfidence;
  sourceIds: string[];
  evidenceIds: string[];
  data: Record<string, string | null>;
}

export interface BrandConflictSeed {
  field: string;
  retained: string;
  competing: string;
  resolvedBy: BrandPrecedence;
  sourceIds: string[];
  evidenceIds: string[];
}

export interface BrandMergeOutcome<T> {
  winners: T[];
  conflicts: BrandConflictSeed[];
}

const ID_PREFIX: Record<BrandMaterialKind, string> = {
  text: "bxt",
  color: "brc",
  font: "brf",
  asset: "bra",
  term: "brt",
  voiceSignal: "brv",
  guideline: "brg",
};

const CONFLICT_RANK: Record<BrandPrecedence, number> = {
  INFERENCE: 0,
  GENERAL_EXTRACTION: 1,
  RECOGNIZED_ASSET: 2,
  DESIGN_TOKEN: 3,
  EXPLICIT_GUIDELINE: 4,
  USER: 5,
};

function rank(entry: BrandMergeEntry): number {
  return (
    brandPrecedenceRank(entry.basis) * 100 +
    (entry.origin === "USER" ? 50 : 0) +
    (entry.confidence === "HIGH" ? 10 : entry.confidence === "MEDIUM" ? 5 : 1)
  );
}

function union(values: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const list of values) {
    for (const value of list) {
      if (seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

/**
 * Strongest first. Ties keep the candidate that was seen first, so a refresh
 * that re-reads the same sources cannot flip a brand value just because two
 * equally strong candidates hash differently.
 */
function compare(a: BrandMergeEntry, b: BrandMergeEntry): number {
  return rank(b) - rank(a);
}

function orderWinners(a: BrandMergeEntry, b: BrandMergeEntry): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  const slotA = slotFor(a);
  const slotB = slotFor(b);
  if (slotA !== slotB) return slotA < slotB ? -1 : 1;
  const variantA = variantFor(a);
  const variantB = variantFor(b);
  if (variantA !== variantB) return variantA < variantB ? -1 : 1;
  return a.value < b.value ? -1 : 1;
}

/**
 * Resolves competing candidates for one canonical key. The strongest basis wins,
 * the losing candidates are not discarded: their provenance is unioned into the
 * winner and each disagreement is reported as a conflict so the UI can show the
 * brand did not silently drop a signal.
 *
 * Two kinds of disagreement are reported. Two candidates for the same canonical
 * key (two different positionings) disagree outright. Two different winners can
 * also compete for one slot (two primaries, two logos, a term both preferred and
 * avoided): a brand legitimately holds several colors, so both are kept and the
 * slot conflict records which one outranked the other.
 */
export function mergeBrandEntries(
  entries: readonly BrandMergeEntry[],
): { winners: BrandMergeEntry[]; conflicts: BrandConflictSeed[] } {
  const groups = new Map<string, BrandMergeEntry[]>();
  for (const entry of entries) {
    const key = `${entry.kind}|${entry.key}`;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const winners: BrandMergeEntry[] = [];
  const conflicts: BrandConflictSeed[] = [];

  for (const group of groups.values()) {
    const sorted = [...group].sort(compare);
    const winner = sorted[0];
    if (!winner) continue;
    const merged: BrandMergeEntry = {
      ...winner,
      sourceIds: union(group.map((entry) => entry.sourceIds)),
      evidenceIds: union(group.map((entry) => entry.evidenceIds)),
    };
    winners.push(merged);

    for (const loser of sorted.slice(1)) {
      if (variantFor(loser) === variantFor(winner)) continue;
      conflicts.push({
        field: `${winner.kind}:${winner.key}`,
        retained: describeEntry(winner),
        competing: describeEntry(loser),
        resolvedBy: winner.basis,
        sourceIds: loser.sourceIds,
        evidenceIds: loser.evidenceIds,
      });
    }
  }

  conflicts.push(...slotConflicts(winners));

  return { winners: winners.sort(orderWinners), conflicts };
}

function slotConflicts(winners: readonly BrandMergeEntry[]): BrandConflictSeed[] {
  const slots = new Map<string, BrandMergeEntry[]>();
  for (const entry of winners) {
    const key = `${entry.kind}:${slotFor(entry)}`;
    const group = slots.get(key);
    if (group) group.push(entry);
    else slots.set(key, [entry]);
  }

  const conflicts: BrandConflictSeed[] = [];
  for (const [field, group] of slots) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(compare);
    const winner = sorted[0];
    if (!winner) continue;
    for (const other of sorted.slice(1)) {
      if (variantFor(other) === variantFor(winner)) continue;
      conflicts.push({
        field,
        retained: describeEntry(winner),
        competing: describeEntry(other),
        resolvedBy: winner.basis,
        sourceIds: other.sourceIds,
        evidenceIds: other.evidenceIds,
      });
    }
  }
  return conflicts;
}

/**
 * The single slot a candidate competes for. Several winners may hold the same
 * slot, which is what makes two primaries a conflict rather than a merge.
 */
function slotFor(entry: BrandMergeEntry): string {
  switch (entry.kind) {
    case "color":
    case "font":
    case "asset":
      return String(entry.data.role ?? entry.key).toLowerCase();
    case "term":
      return entry.key.toLowerCase();
    case "voiceSignal":
      return String(entry.data.kind ?? entry.key).toLowerCase();
    case "guideline":
      return entry.key.replace(/^guideline\|/, "").toLowerCase();
    default:
      return entry.key;
  }
}

function variantFor(entry: BrandMergeEntry): string {
  switch (entry.kind) {
    case "color":
      return String(entry.data.hex ?? entry.value).toLowerCase();
    case "font":
      return entry.value.toLowerCase();
    case "asset":
      return String(entry.data.assetId ?? entry.value);
    case "term":
      return String(entry.data.preference ?? "NEUTRAL");
    case "voiceSignal":
      return entry.value.toLowerCase();
    case "guideline":
      return String(entry.data.detail ?? "");
    default:
      return entry.value;
  }
}

function describeEntry(entry: BrandMergeEntry): string {
  switch (entry.kind) {
    case "color":
      return String(entry.data.hex ?? entry.value);
    case "font":
      return entry.value;
    case "asset":
      return `${entry.value} (${String(entry.data.assetId ?? "unknown asset")})`;
    case "term":
      return `${entry.value} (${String(entry.data.preference ?? "NEUTRAL").toLowerCase()})`;
    case "guideline":
      return String(entry.data.detail ?? entry.value);
    default:
      return entry.value;
  }
}

/**
 * A material id is derived, not generated, so a re-analysis of unchanged sources
 * keeps the same id. The project is part of the hash because a canonical key is
 * only unique inside one brand: two projects can both hold a primary
 * `#4f46e5`, and their rows must not collide on the primary key.
 */
export function brandEntryId(
  kind: BrandMaterialKind,
  key: string,
  scope = "",
): string {
  return brandCanonicalId(ID_PREFIX[kind], `${scope}|${kind}|${key}`);
}

export function toBrandTextField(entry: BrandMergeEntry): string {
  return entry.value;
}

export function toBrandColor(entry: BrandMergeEntry, scope = ""): BrandColor {
  return {
    id: brandEntryId("color", entry.key, scope),
    name: entry.value,
    hex: String(entry.data.hex ?? ""),
    role: (entry.data.role as BrandColor["role"]) ?? "PRIMARY",
    confidence: entry.confidence,
    origin: entry.origin,
    basis: entry.basis,
    sourceIds: entry.sourceIds,
    evidenceIds: entry.evidenceIds,
    notes: entry.data.notes ?? null,
  };
}

export function toBrandFont(entry: BrandMergeEntry, scope = ""): BrandFont {
  return {
    id: brandEntryId("font", entry.key, scope),
    family: entry.value,
    role: (entry.data.role as BrandFont["role"]) ?? "BODY",
    weight: entry.data.weight ?? null,
    style: entry.data.style ?? null,
    sourceUrl: entry.data.sourceUrl ?? null,
    confidence: entry.confidence,
    origin: entry.origin,
    basis: entry.basis,
    sourceIds: entry.sourceIds,
    evidenceIds: entry.evidenceIds,
    notes: entry.data.notes ?? null,
  };
}

export function toBrandAsset(entry: BrandMergeEntry, scope = ""): BrandAsset {
  return {
    id: brandEntryId("asset", entry.key, scope),
    assetId: String(entry.data.assetId ?? ""),
    role: (entry.data.role as BrandAsset["role"]) ?? "LOGO",
    label: entry.value,
    confidence: entry.confidence,
    origin: entry.origin,
    basis: entry.basis,
    sourceIds: entry.sourceIds,
    evidenceIds: entry.evidenceIds,
    notes: entry.data.notes ?? null,
  };
}

export function toBrandTerm(entry: BrandMergeEntry, scope = ""): BrandTerm {
  return {
    id: brandEntryId("term", entry.key, scope),
    term: entry.value,
    category: (entry.data.category as BrandTerm["category"]) ?? "INDUSTRY_TERM",
    preference: (entry.data.preference as BrandTerm["preference"]) ?? "NEUTRAL",
    confidence: entry.confidence,
    origin: entry.origin,
    basis: entry.basis,
    sourceIds: entry.sourceIds,
    evidenceIds: entry.evidenceIds,
    notes: entry.data.notes ?? null,
  };
}

export function toBrandVoiceSignal(entry: BrandMergeEntry, scope = ""): BrandVoiceSignal {
  return {
    id: brandEntryId("voiceSignal", entry.key, scope),
    kind: String(entry.data.kind ?? entry.key),
    value: entry.value,
    confidence: entry.confidence,
    origin: entry.origin,
    basis: entry.basis,
    sourceIds: entry.sourceIds,
    evidenceIds: entry.evidenceIds,
  };
}

export function toBrandGuideline(entry: BrandMergeEntry, scope = ""): BrandGuideline {
  return {
    id: brandEntryId("guideline", entry.key, scope),
    title: entry.value,
    detail: String(entry.data.detail ?? ""),
    origin: entry.origin,
    basis: entry.basis,
    sourceIds: entry.sourceIds,
    evidenceIds: entry.evidenceIds,
  };
}

export function toBrandConflict(
  seed: BrandConflictSeed,
  index: number,
  scope = "",
): BrandConflict {
  return {
    id: brandCanonicalId("brx", `${scope}|${index}|${seed.field}`),
    field: seed.field,
    retained: seed.retained,
    competing: seed.competing,
    resolvedBy: seed.resolvedBy,
    sourceIds: seed.sourceIds,
    evidenceIds: seed.evidenceIds,
  };
}

export function conflictSeverity(conflict: BrandConflictSeed): number {
  return CONFLICT_RANK[conflict.resolvedBy];
}
