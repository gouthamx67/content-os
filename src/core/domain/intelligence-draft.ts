import {
  IntelligenceError,
  type AssetMediaType,
  type AssetRole,
  type AssertionKind,
  type AudienceSignalKind,
  type BrandSignalKind,
  type ClaimType,
  type EvidenceKind,
  type FeatureCategory,
  type Importance,
  type IntelligenceConfidence,
  type IntelligenceEntityType,
  type IntelligenceRelationshipType,
} from "./intelligence";
import {
  canonicalEvidenceKey,
  mergeIdLists,
  methodForAssertionKind,
  strongerConfidence,
  strongestAssertionKind,
} from "./intelligence-canonical";

export const MAX_DRAFT_ITEMS = 200;

interface DraftBase {
  key: string;
  confidence: IntelligenceConfidence;
  assertionKind: AssertionKind;
  sourceIds: string[];
  evidenceKeys: string[];
}

export interface DraftEvidence {
  key: string;
  sourceId: string;
  kind: EvidenceKind;
  locator: string;
  excerpt: string | null;
  metadata: string | null;
}

export interface DraftFeature extends DraftBase {
  name: string;
  description: string | null;
  category: FeatureCategory;
  importance: Importance;
}

export interface DraftProblem extends DraftBase {
  name: string;
  description: string | null;
}

export interface DraftBenefit extends DraftBase {
  name: string;
  description: string | null;
  linkedFeatureKeys: string[];
}

export interface DraftClaim extends DraftBase {
  text: string;
  claimType: ClaimType;
  sourceId: string | null;
}

export interface DraftWorkflowStep {
  order: number;
  action: string;
  description: string | null;
  featureKeys: string[];
}

export interface DraftWorkflow extends DraftBase {
  name: string;
  description: string | null;
  steps: DraftWorkflowStep[];
  featureKeys: string[];
}

export interface DraftAudienceSignal extends DraftBase {
  segment: string;
  description: string | null;
  kind: AudienceSignalKind;
}

export interface DraftBrandSignal extends DraftBase {
  kind: BrandSignalKind;
  label: string;
  value: string;
}

export interface DraftAsset extends DraftBase {
  sourceId: string;
  name: string;
  mediaType: AssetMediaType;
  role: AssetRole;
  storageKey: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  qualitySignals: string | null;
  relatedFeatureKeys: string[];
  relatedClaimKeys: string[];
}

export interface DraftProduct {
  name: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  category: string | null;
  purpose: string | null;
  valueProposition: string | null;
  targetUserSummary: string | null;
  confidence: IntelligenceConfidence;
  assertionKind: AssertionKind;
  sourceIds: string[];
  evidenceKeys: string[];
}

export interface DraftRelationship {
  type: IntelligenceRelationshipType;
  fromType: IntelligenceEntityType;
  fromKey: string;
  toType: IntelligenceEntityType;
  toKey: string;
  confidence: IntelligenceConfidence;
}

export interface IntelligenceDraft {
  product: DraftProduct | null;
  features: DraftFeature[];
  problems: DraftProblem[];
  benefits: DraftBenefit[];
  claims: DraftClaim[];
  workflows: DraftWorkflow[];
  audienceSignals: DraftAudienceSignal[];
  brandSignals: DraftBrandSignal[];
  assets: DraftAsset[];
  evidence: DraftEvidence[];
  relationships: DraftRelationship[];
}

export function emptyIntelligenceDraft(): IntelligenceDraft {
  return {
    product: null,
    features: [],
    problems: [],
    benefits: [],
    claims: [],
    workflows: [],
    audienceSignals: [],
    brandSignals: [],
    assets: [],
    evidence: [],
    relationships: [],
  };
}

export function addDraftEvidence(
  draft: IntelligenceDraft,
  evidence: Omit<DraftEvidence, "key"> & { key?: string },
): DraftEvidence {
  const key = evidence.key ?? canonicalEvidenceKey(evidence.sourceId, evidence.kind, evidence.locator);
  const existing = draft.evidence.find((item) => item.key === key);
  if (existing) return existing;
  if (draft.evidence.length >= MAX_DRAFT_ITEMS * 4) {
    throw new IntelligenceError(
      "INTELLIGENCE_INVALID_INPUT",
      "Too many evidence items were extracted for a single run",
    );
  }
  const created: DraftEvidence = {
    key,
    sourceId: evidence.sourceId,
    kind: evidence.kind,
    locator: evidence.locator,
    excerpt: evidence.excerpt,
    metadata: evidence.metadata,
  };
  draft.evidence.push(created);
  return created;
}

function requireRoom(collection: unknown[], label: string): void {
  if (collection.length >= MAX_DRAFT_ITEMS) {
    throw new IntelligenceError(
      "INTELLIGENCE_INVALID_INPUT",
      `Too many ${label} items were produced for a single run`,
    );
  }
}

function mergeBase(
  current: DraftBase,
  incoming: DraftBase,
): DraftBase {
  return {
    key: current.key,
    confidence: strongerConfidence(current.confidence, incoming.confidence),
    assertionKind: strongestAssertionKind(current.assertionKind, incoming.assertionKind),
    sourceIds: mergeIdLists(current.sourceIds, incoming.sourceIds),
    evidenceKeys: mergeIdLists(current.evidenceKeys, incoming.evidenceKeys),
  };
}

function mergeFeature(current: DraftFeature, incoming: DraftFeature): DraftFeature {
  return {
    ...mergeBase(current, incoming),
    name: incoming.name || current.name,
    description: incoming.description ?? current.description,
    category: incoming.category,
    importance: strongerImportance(current.importance, incoming.importance),
  };
}

const IMPORTANCE_RANK: Record<Importance, number> = {
  PRIMARY: 3,
  SECONDARY: 2,
  TERTIARY: 1,
};

function strongerImportance(current: Importance, incoming: Importance): Importance {
  return IMPORTANCE_RANK[incoming] > IMPORTANCE_RANK[current] ? incoming : current;
}

function mergeCollection<T extends DraftBase>(
  current: readonly T[],
  incoming: readonly T[],
  merge: (existing: T, next: T) => T,
): T[] {
  const result = [...current];
  for (const item of incoming) {
    const existing = result.find((candidate) => candidate.key === item.key);
    if (existing) {
      const index = result.indexOf(existing);
      result[index] = merge(existing, item);
      continue;
    }
    if (result.length >= MAX_DRAFT_ITEMS) {
      throw new IntelligenceError(
        "INTELLIGENCE_INVALID_INPUT",
        "Too many distinct entities were produced for a single run",
      );
    }
    result.push(item);
  }
  return result;
}

function relationshipIdentity(relationship: DraftRelationship): string {
  return `${relationship.type}|${relationship.fromKey}|${relationship.toKey}`;
}

export function mergeDrafts(
  base: IntelligenceDraft,
  incoming: IntelligenceDraft,
): IntelligenceDraft {
  requireRoom(base.evidence, "evidence");
  const evidence = [...base.evidence];
  for (const item of incoming.evidence) {
    if (!evidence.some((existing) => existing.key === item.key)) evidence.push(item);
  }

  const relationships = [...base.relationships];
  const seenRelationships = new Set(relationships.map(relationshipIdentity));
  for (const item of incoming.relationships) {
    const identity = relationshipIdentity(item);
    if (seenRelationships.has(identity)) continue;
    seenRelationships.add(identity);
    relationships.push(item);
  }

  return {
    product: mergeProduct(base.product, incoming.product),
    features: mergeCollection(base.features, incoming.features, mergeFeature),
    problems: mergeCollection(base.problems, incoming.problems, (current, next) => ({
      ...mergeBase(current, next),
      name: next.name || current.name,
      description: next.description ?? current.description,
    })),
    benefits: mergeCollection(base.benefits, incoming.benefits, (current, next) => ({
      ...mergeBase(current, next),
      name: next.name || current.name,
      description: next.description ?? current.description,
      linkedFeatureKeys: mergeIdLists(current.linkedFeatureKeys, next.linkedFeatureKeys),
    })),
    claims: mergeCollection(base.claims, incoming.claims, (current, next) => ({
      ...mergeBase(current, next),
      text: next.text || current.text,
      claimType: next.claimType,
      sourceId: next.sourceId ?? current.sourceId,
    })),
    workflows: mergeCollection(base.workflows, incoming.workflows, (current, next) => ({
      ...mergeBase(current, next),
      name: next.name || current.name,
      description: next.description ?? current.description,
      steps: next.steps.length > 0 ? next.steps : current.steps,
      featureKeys: mergeIdLists(current.featureKeys, next.featureKeys),
    })),
    audienceSignals: mergeCollection(
      base.audienceSignals,
      incoming.audienceSignals,
      (current, next) => ({
        ...mergeBase(current, next),
        segment: next.segment || current.segment,
        description: next.description ?? current.description,
        kind: next.kind,
      }),
    ),
    brandSignals: mergeCollection(base.brandSignals, incoming.brandSignals, (current, next) => ({
      ...mergeBase(current, next),
      kind: next.kind,
      label: next.label || current.label,
      value: next.value || current.value,
    })),
    assets: mergeCollection(base.assets, incoming.assets, (current, next) => ({
      ...mergeBase(current, next),
      sourceId: next.sourceId,
      name: next.name || current.name,
      mediaType: next.mediaType,
      role: next.role,
      storageKey: next.storageKey ?? current.storageKey,
      mimeType: next.mimeType ?? current.mimeType,
      width: next.width ?? current.width,
      height: next.height ?? current.height,
      durationMs: next.durationMs ?? current.durationMs,
      qualitySignals: next.qualitySignals ?? current.qualitySignals,
      relatedFeatureKeys: mergeIdLists(current.relatedFeatureKeys, next.relatedFeatureKeys),
      relatedClaimKeys: mergeIdLists(current.relatedClaimKeys, next.relatedClaimKeys),
    })),
    evidence,
    relationships,
  };
}

function mergeProduct(current: DraftProduct | null, incoming: DraftProduct | null): DraftProduct | null {
  if (!current) return incoming;
  if (!incoming) return current;
  return {
    name: incoming.name ?? current.name,
    shortDescription: incoming.shortDescription ?? current.shortDescription,
    longDescription: incoming.longDescription ?? current.longDescription,
    category: incoming.category ?? current.category,
    purpose: incoming.purpose ?? current.purpose,
    valueProposition: incoming.valueProposition ?? current.valueProposition,
    targetUserSummary: incoming.targetUserSummary ?? current.targetUserSummary,
    confidence: strongerConfidence(current.confidence, incoming.confidence),
    assertionKind: strongestAssertionKind(current.assertionKind, incoming.assertionKind),
    sourceIds: mergeIdLists(current.sourceIds, incoming.sourceIds),
    evidenceKeys: mergeIdLists(current.evidenceKeys, incoming.evidenceKeys),
  };
}

export function draftEntityTypeOfKey(key: string): IntelligenceEntityType | null {
  const [prefix] = key.split(":");
  switch (prefix) {
    case "product":
      return "PRODUCT";
    case "feature":
      return "FEATURE";
    case "workflow":
      return "WORKFLOW";
    case "problem":
      return "PROBLEM";
    case "benefit":
      return "BENEFIT";
    case "claim":
      return "CLAIM";
    case "audience":
      return "AUDIENCE_SIGNAL";
    case "brand":
      return "BRAND_SIGNAL";
    case "asset":
      return "ASSET";
    case "evidence":
      return "EVIDENCE";
    default:
      return null;
  }
}

export function collectDraftEntityTypes(draft: IntelligenceDraft): Map<string, IntelligenceEntityType> {
  const types = new Map<string, IntelligenceEntityType>();
  if (draft.product) types.set("product", "PRODUCT");
  for (const item of draft.features) types.set(item.key, "FEATURE");
  for (const item of draft.workflows) types.set(item.key, "WORKFLOW");
  for (const item of draft.problems) types.set(item.key, "PROBLEM");
  for (const item of draft.benefits) types.set(item.key, "BENEFIT");
  for (const item of draft.claims) types.set(item.key, "CLAIM");
  for (const item of draft.audienceSignals) types.set(item.key, "AUDIENCE_SIGNAL");
  for (const item of draft.brandSignals) types.set(item.key, "BRAND_SIGNAL");
  for (const item of draft.assets) types.set(item.key, "ASSET");
  for (const item of draft.evidence) types.set(item.key, "EVIDENCE");
  return types;
}

export function draftEvidenceMap(draft: IntelligenceDraft): Map<string, DraftEvidence> {
  return new Map(draft.evidence.map((item) => [item.key, item]));
}

export function methodForDraftKind(kind: AssertionKind) {
  return methodForAssertionKind(kind);
}
