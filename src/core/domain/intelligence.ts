export const INTELLIGENCE_CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
export type IntelligenceConfidence = (typeof INTELLIGENCE_CONFIDENCE_LEVELS)[number];

export const ASSERTION_KINDS = [
  "FACT",
  "INFERENCE",
  "USER_PROVIDED",
  "MARKETING_CLAIM",
] as const;
export type AssertionKind = (typeof ASSERTION_KINDS)[number];

export const CLAIM_TYPES = [
  "CAPABILITY",
  "INTEGRATION",
  "FORMAT",
  "LIMITATION",
  "PRICING",
  "PERFORMANCE",
  "OTHER",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const VERIFICATION_STATUSES = [
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "UNVERIFIED",
  "CONFLICTING",
  "CONTRADICTED",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const EVIDENCE_KINDS = [
  "SOURCE_FRAGMENT",
  "REPOSITORY_FILE",
  "URL_SECTION",
  "DOCUMENT_SECTION",
  "IMAGE_REGION",
  "VIDEO_TIMESTAMP",
  "AUDIO_TIMESTAMP",
  "EXTRACTED_METADATA",
  "BROWSER_INTERACTION",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EXTRACTION_METHODS = [
  "DETERMINISTIC",
  "AI_INTERPRETATION",
  "USER_INPUT",
] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

export const FEATURE_CATEGORIES = [
  "AI_GENERATION",
  "DASHBOARD",
  "AUTHENTICATION",
  "INTEGRATION",
  "AUTOMATION",
  "ANALYTICS",
  "COLLABORATION",
  "CONTENT_MANAGEMENT",
  "EXPORT",
  "OTHER",
] as const;
export type FeatureCategory = (typeof FEATURE_CATEGORIES)[number];

export const IMPORTANCE_LEVELS = ["PRIMARY", "SECONDARY", "TERTIARY"] as const;
export type Importance = (typeof IMPORTANCE_LEVELS)[number];

export const AUDIENCE_SIGNAL_KINDS = [
  "EXPLICIT_SEGMENT",
  "VOCABULARY",
  "USE_CASE",
  "CONTEXTUAL",
] as const;
export type AudienceSignalKind = (typeof AUDIENCE_SIGNAL_KINDS)[number];

export const BRAND_SIGNAL_KINDS = [
  "BRAND_NAME",
  "LOGO",
  "COLOR",
  "FONT",
  "VISUAL_STYLE",
  "TONE",
  "TERMINOLOGY",
  "TAGLINE",
  "POSITIONING",
  "DESIGN_PATTERN",
] as const;
export type BrandSignalKind = (typeof BRAND_SIGNAL_KINDS)[number];

export const ASSET_MEDIA_TYPES = [
  "SCREENSHOT",
  "PRODUCT_UI",
  "HERO_IMAGE",
  "ICON",
  "ILLUSTRATION",
  "DIAGRAM",
  "CHART",
  "TESTIMONIAL",
  "BEFORE_AFTER",
  "EXISTING_AD",
  "EXISTING_VIDEO",
  "BRAND_ASSET",
  "OTHER",
] as const;
export type AssetMediaType = (typeof ASSET_MEDIA_TYPES)[number];

export const ASSET_ROLES = [
  "PRODUCT_UI",
  "FEATURE_PROOF",
  "HERO",
  "SOCIAL_CREATIVE",
  "BRAND_ASSET",
  "SUPPORTING",
] as const;
export type AssetRole = (typeof ASSET_ROLES)[number];

export const INTELLIGENCE_RELATIONSHIP_TYPES = [
  "FEATURE_SOLVES_PROBLEM",
  "FEATURE_PROVIDES_BENEFIT",
  "WORKFLOW_USES_FEATURE",
  "CLAIM_SUPPORTED_BY_EVIDENCE",
  "FEATURE_SUPPORTED_BY_EVIDENCE",
  "BENEFIT_SUPPORTED_BY_EVIDENCE",
  "PRODUCT_SUPPORTED_BY_EVIDENCE",
  "ASSET_REPRESENTS_FEATURE",
  "ASSET_SUPPORTS_CLAIM",
  "PROBLEM_SUPPORTED_BY_EVIDENCE",
  "AUDIENCE_SUPPORTED_BY_EVIDENCE",
  "BRAND_SUPPORTED_BY_EVIDENCE",
] as const;
export type IntelligenceRelationshipType =
  (typeof INTELLIGENCE_RELATIONSHIP_TYPES)[number];

export const INTELLIGENCE_RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "PARTIAL",
] as const;
export type IntelligenceRunStatus = (typeof INTELLIGENCE_RUN_STATUSES)[number];

export const INTELLIGENCE_ENTITY_TYPES = [
  "PRODUCT",
  "FEATURE",
  "WORKFLOW",
  "PROBLEM",
  "BENEFIT",
  "CLAIM",
  "AUDIENCE_SIGNAL",
  "BRAND_SIGNAL",
  "ASSET",
  "EVIDENCE",
] as const;
export type IntelligenceEntityType = (typeof INTELLIGENCE_ENTITY_TYPES)[number];

export const INTELLIGENCE_ERROR_CODES = [
  "INTELLIGENCE_INVALID_INPUT",
  "INTELLIGENCE_NOT_FOUND",
  "INTELLIGENCE_ALREADY_RUNNING",
  "INTELLIGENCE_AI_INVALID_OUTPUT",
  "INTELLIGENCE_AI_UNAVAILABLE",
  "INTELLIGENCE_SOURCE_UNREADABLE",
  "INTELLIGENCE_SCOPE_VIOLATION",
] as const;
export type IntelligenceErrorCode = (typeof INTELLIGENCE_ERROR_CODES)[number];

export class IntelligenceError extends Error {
  override readonly name = "IntelligenceError";

  constructor(
    readonly code: IntelligenceErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface Provenance {
  sourceIds: string[];
  evidenceIds: string[];
  method: ExtractionMethod;
  extractedAt: string;
}

export interface Product {
  id: string;
  projectId: string;
  name: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  category: string | null;
  purpose: string | null;
  valueProposition: string | null;
  targetUserSummary: string | null;
  confidence: IntelligenceConfidence;
  assertionKind: AssertionKind;
  userLocked: boolean;
  provenance: Provenance | null;
  createdAt: string;
  updatedAt: string;
}

export interface Feature {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  category: FeatureCategory;
  importance: Importance;
  confidence: IntelligenceConfidence;
  assertionKind: AssertionKind;
  userLocked: boolean;
  canonicalKey: string;
  provenance: Provenance | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStep {
  id: string;
  workflowId: string;
  order: number;
  action: string;
  description: string | null;
  featureIds: string[];
}

export interface Workflow {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  steps: WorkflowStep[];
  featureIds: string[];
  confidence: IntelligenceConfidence;
  assertionKind: AssertionKind;
  userLocked: boolean;
  canonicalKey: string;
  provenance: Provenance | null;
  createdAt: string;
  updatedAt: string;
}

export interface Problem {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  confidence: IntelligenceConfidence;
  assertionKind: AssertionKind;
  userLocked: boolean;
  canonicalKey: string;
  provenance: Provenance | null;
  createdAt: string;
  updatedAt: string;
}

export interface Benefit {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  linkedFeatureIds: string[];
  confidence: IntelligenceConfidence;
  assertionKind: AssertionKind;
  userLocked: boolean;
  canonicalKey: string;
  provenance: Provenance | null;
  createdAt: string;
  updatedAt: string;
}

export interface Claim {
  id: string;
  projectId: string;
  text: string;
  claimType: ClaimType;
  sourceId: string | null;
  verification: VerificationStatus;
  conflictsWithClaimId: string | null;
  confidence: IntelligenceConfidence;
  assertionKind: AssertionKind;
  userLocked: boolean;
  canonicalKey: string;
  provenance: Provenance | null;
  createdAt: string;
  updatedAt: string;
}

export interface Evidence {
  id: string;
  projectId: string;
  sourceId: string;
  kind: EvidenceKind;
  locator: string;
  excerpt: string | null;
  metadata: string | null;
  createdAt: string;
}

export interface AudienceSignal {
  id: string;
  projectId: string;
  segment: string;
  description: string | null;
  kind: AudienceSignalKind;
  confidence: IntelligenceConfidence;
  assertionKind: AssertionKind;
  userLocked: boolean;
  canonicalKey: string;
  provenance: Provenance | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrandSignal {
  id: string;
  projectId: string;
  kind: BrandSignalKind;
  label: string;
  value: string;
  confidence: IntelligenceConfidence;
  assertionKind: AssertionKind;
  userLocked: boolean;
  canonicalKey: string;
  provenance: Provenance | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntelligenceAsset {
  id: string;
  projectId: string;
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
  relatedFeatureIds: string[];
  relatedClaimIds: string[];
  confidence: IntelligenceConfidence;
  assertionKind: AssertionKind;
  userLocked: boolean;
  canonicalKey: string;
  provenance: Provenance | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntelligenceRelationship {
  id: string;
  projectId: string;
  type: IntelligenceRelationshipType;
  fromType: IntelligenceEntityType;
  fromId: string;
  toType: IntelligenceEntityType;
  toId: string;
  confidence: IntelligenceConfidence;
  createdAt: string;
}

export interface IntelligenceRun {
  id: string;
  projectId: string;
  status: IntelligenceRunStatus;
  sourceIds: string[];
  provider: string | null;
  model: string | null;
  trigger: string;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntelligenceSnapshot {
  id: string;
  projectId: string;
  version: number;
  runId: string;
  summary: string | null;
  entityCounts: string | null;
  createdAt: string;
}

export interface IntelligenceGraph {
  product: Product | null;
  features: Feature[];
  workflows: Workflow[];
  problems: Problem[];
  benefits: Benefit[];
  claims: Claim[];
  evidence: Evidence[];
  audienceSignals: AudienceSignal[];
  brandSignals: BrandSignal[];
  assets: IntelligenceAsset[];
  relationships: IntelligenceRelationship[];
}

export function emptyIntelligenceGraph(): IntelligenceGraph {
  return {
    product: null,
    features: [],
    workflows: [],
    problems: [],
    benefits: [],
    claims: [],
    evidence: [],
    audienceSignals: [],
    brandSignals: [],
    assets: [],
    relationships: [],
  };
}

export function countIntelligenceEntities(graph: IntelligenceGraph): Record<string, number> {
  return {
    features: graph.features.length,
    workflows: graph.workflows.length,
    problems: graph.problems.length,
    benefits: graph.benefits.length,
    claims: graph.claims.length,
    evidence: graph.evidence.length,
    audienceSignals: graph.audienceSignals.length,
    brandSignals: graph.brandSignals.length,
    assets: graph.assets.length,
    relationships: graph.relationships.length,
  };
}
