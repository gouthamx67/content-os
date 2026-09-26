import type {
  AudienceSignal,
  BrandSignal,
  Benefit,
  Claim,
  Evidence,
  Feature,
  IntelligenceAsset,
  IntelligenceGraph,
  IntelligenceRelationship,
  IntelligenceRun,
  IntelligenceSnapshot,
  Problem,
  Product,
  Workflow,
  WorkflowStep,
} from "../domain/intelligence";
import type { IntelligenceRunStatus } from "../domain/intelligence";

export interface ProductValues {
  name: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  category: string | null;
  purpose: string | null;
  valueProposition: string | null;
  targetUserSummary: string | null;
  confidence: Product["confidence"];
  assertionKind: Product["assertionKind"];
  userLocked: boolean;
  sourceIds: string[];
  evidenceIds: string[];
  method: NonNullable<Product["provenance"]>["method"];
  extractedAt: string;
}

export interface FeatureValues {
  name: string;
  description: string | null;
  category: Feature["category"];
  importance: Feature["importance"];
  confidence: Feature["confidence"];
  assertionKind: Feature["assertionKind"];
  userLocked: boolean;
  canonicalKey: string;
  sourceIds: string[];
  evidenceIds: string[];
  method: NonNullable<Feature["provenance"]>["method"];
  extractedAt: string;
}

export interface ProblemValues {
  name: string;
  description: string | null;
  confidence: Problem["confidence"];
  assertionKind: Problem["assertionKind"];
  userLocked: boolean;
  canonicalKey: string;
  sourceIds: string[];
  evidenceIds: string[];
  method: NonNullable<Problem["provenance"]>["method"];
  extractedAt: string;
}

export interface BenefitValues {
  name: string;
  description: string | null;
  linkedFeatureIds: string[];
  confidence: Benefit["confidence"];
  assertionKind: Benefit["assertionKind"];
  userLocked: boolean;
  canonicalKey: string;
  sourceIds: string[];
  evidenceIds: string[];
  method: NonNullable<Benefit["provenance"]>["method"];
  extractedAt: string;
}

export interface ClaimValues {
  text: string;
  claimType: Claim["claimType"];
  sourceId: string | null;
  verification: Claim["verification"];
  conflictsWithClaimId: string | null;
  confidence: Claim["confidence"];
  assertionKind: Claim["assertionKind"];
  userLocked: boolean;
  canonicalKey: string;
  sourceIds: string[];
  evidenceIds: string[];
  method: NonNullable<Claim["provenance"]>["method"];
  extractedAt: string;
}

export interface WorkflowStepValues {
  order: number;
  action: string;
  description: string | null;
  featureIds: string[];
}

export interface WorkflowValues {
  name: string;
  description: string | null;
  steps: WorkflowStepValues[];
  featureIds: string[];
  confidence: Workflow["confidence"];
  assertionKind: Workflow["assertionKind"];
  userLocked: boolean;
  canonicalKey: string;
  sourceIds: string[];
  evidenceIds: string[];
  method: NonNullable<Workflow["provenance"]>["method"];
  extractedAt: string;
}

export interface AudienceSignalValues {
  segment: string;
  description: string | null;
  kind: AudienceSignal["kind"];
  confidence: AudienceSignal["confidence"];
  assertionKind: AudienceSignal["assertionKind"];
  userLocked: boolean;
  canonicalKey: string;
  sourceIds: string[];
  evidenceIds: string[];
  method: NonNullable<AudienceSignal["provenance"]>["method"];
  extractedAt: string;
}

export interface BrandSignalValues {
  kind: BrandSignal["kind"];
  label: string;
  value: string;
  confidence: BrandSignal["confidence"];
  assertionKind: BrandSignal["assertionKind"];
  userLocked: boolean;
  canonicalKey: string;
  sourceIds: string[];
  evidenceIds: string[];
  method: NonNullable<BrandSignal["provenance"]>["method"];
  extractedAt: string;
}

export interface AssetValues {
  sourceId: string;
  name: string;
  mediaType: IntelligenceAsset["mediaType"];
  role: IntelligenceAsset["role"];
  storageKey: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  qualitySignals: string | null;
  relatedFeatureIds: string[];
  relatedClaimIds: string[];
  confidence: IntelligenceAsset["confidence"];
  assertionKind: IntelligenceAsset["assertionKind"];
  userLocked: boolean;
  canonicalKey: string;
  sourceIds: string[];
  evidenceIds: string[];
  method: NonNullable<IntelligenceAsset["provenance"]>["method"];
  extractedAt: string;
}

export interface Upsert<TValues> {
  /**
   * Primary key to persist. Reused existing ids on updates so that
   * relationships resolved before the write stay valid.
   */
  id: string;
  isNew: boolean;
  values: TValues;
}

export interface IntelligencePersistencePlan {
  product: Upsert<ProductValues> | null;
  features: Upsert<FeatureValues>[];
  problems: Upsert<ProblemValues>[];
  benefits: Upsert<BenefitValues>[];
  claims: Upsert<ClaimValues>[];
  workflows: Upsert<WorkflowValues>[];
  audienceSignals: Upsert<AudienceSignalValues>[];
  brandSignals: Upsert<BrandSignalValues>[];
  assets: Upsert<AssetValues>[];
  evidence: EvidenceValues[];
  relationships: RelationshipValues[];
}

export interface EvidenceValues {
  id: string;
  key: string;
  sourceId: string;
  kind: Evidence["kind"];
  locator: string;
  excerpt: string | null;
  metadata: string | null;
}

export interface RelationshipValues {
  type: IntelligenceRelationship["type"];
  fromType: IntelligenceRelationship["fromType"];
  fromId: string;
  toType: IntelligenceRelationship["toType"];
  toId: string;
  confidence: IntelligenceRelationship["confidence"];
}

export interface CreateIntelligenceRunInput {
  id: string;
  projectId: string;
  status: IntelligenceRunStatus;
  sourceIds: string[];
  provider: string | null;
  model: string | null;
  trigger: string;
}

export interface UpdateIntelligenceRunInput {
  status?: IntelligenceRunStatus;
  provider?: string | null;
  model?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface CreateIntelligenceSnapshotInput {
  id: string;
  projectId: string;
  version: number;
  runId: string;
  summary: string | null;
  entityCounts: string | null;
}

export interface UpdateProductInput {
  name?: string | null;
  shortDescription?: string | null;
  longDescription?: string | null;
  category?: string | null;
  purpose?: string | null;
  valueProposition?: string | null;
  targetUserSummary?: string | null;
  assertionKind?: Product["assertionKind"];
  userLocked?: boolean;
}

export interface UpdateFeatureInput {
  name?: string;
  description?: string | null;
  category?: Feature["category"];
  importance?: Feature["importance"];
  assertionKind?: Feature["assertionKind"];
  userLocked?: boolean;
}

export interface UpdateProblemInput {
  name?: string;
  description?: string | null;
  assertionKind?: Problem["assertionKind"];
  userLocked?: boolean;
}

export interface UpdateBenefitInput {
  name?: string;
  description?: string | null;
  assertionKind?: Benefit["assertionKind"];
  userLocked?: boolean;
}

export interface UpdateClaimInput {
  text?: string;
  claimType?: Claim["claimType"];
  verification?: Claim["verification"];
  assertionKind?: Claim["assertionKind"];
  userLocked?: boolean;
}

export interface WorkflowStepInput {
  order: number;
  action: string;
  description: string | null;
  featureIds: string[];
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string | null;
  steps?: readonly WorkflowStepInput[];
  assertionKind?: Workflow["assertionKind"];
  userLocked?: boolean;
}

export interface UpdateAudienceSignalInput {
  segment?: string;
  description?: string | null;
  kind?: AudienceSignal["kind"];
  assertionKind?: AudienceSignal["assertionKind"];
  userLocked?: boolean;
}

export interface UpdateBrandSignalInput {
  kind?: BrandSignal["kind"];
  label?: string;
  value?: string;
  assertionKind?: BrandSignal["assertionKind"];
  userLocked?: boolean;
}

export interface UpdateAssetInput {
  name?: string;
  role?: IntelligenceAsset["role"];
  assertionKind?: IntelligenceAsset["assertionKind"];
  userLocked?: boolean;
}

/**
 * The multi-table writes in this feature. Storage adapters that cannot open a
 * transaction inline (an ORM scoped to a connection) receive this seam instead:
 * `applyGraph` persists a whole analysis run, and `updateWorkflow` replaces a
 * workflow together with its steps.
 */
export interface IntelligenceGraphTransactions {
  applyGraph(projectId: string, plan: IntelligencePersistencePlan): Promise<void>;
  updateWorkflow(
    projectId: string,
    canonicalKey: string,
    changes: UpdateWorkflowInput,
  ): Promise<Workflow | null>;
}

export interface IntelligenceRepository {
  getProduct(projectId: string): Promise<Product | null>;
  updateProduct(projectId: string, changes: UpdateProductInput): Promise<Product | null>;

  listFeatures(projectId: string): Promise<Feature[]>;
  listProblems(projectId: string): Promise<Problem[]>;
  listBenefits(projectId: string): Promise<Benefit[]>;
  listClaims(projectId: string): Promise<Claim[]>;
  listWorkflows(projectId: string): Promise<Workflow[]>;
  listAudienceSignals(projectId: string): Promise<AudienceSignal[]>;
  listBrandSignals(projectId: string): Promise<BrandSignal[]>;
  listAssets(projectId: string): Promise<IntelligenceAsset[]>;
  listEvidence(projectId: string): Promise<Evidence[]>;
  listRelationships(projectId: string): Promise<IntelligenceRelationship[]>;

  updateFeature(
    projectId: string,
    canonicalKey: string,
    changes: UpdateFeatureInput,
  ): Promise<Feature | null>;
  updateProblem(
    projectId: string,
    canonicalKey: string,
    changes: UpdateProblemInput,
  ): Promise<Problem | null>;
  updateBenefit(
    projectId: string,
    canonicalKey: string,
    changes: UpdateBenefitInput,
  ): Promise<Benefit | null>;
  updateClaim(
    projectId: string,
    canonicalKey: string,
    changes: UpdateClaimInput,
  ): Promise<Claim | null>;
  updateWorkflow(
    projectId: string,
    canonicalKey: string,
    changes: UpdateWorkflowInput,
  ): Promise<Workflow | null>;
  updateAudienceSignal(
    projectId: string,
    canonicalKey: string,
    changes: UpdateAudienceSignalInput,
  ): Promise<AudienceSignal | null>;
  updateBrandSignal(
    projectId: string,
    canonicalKey: string,
    changes: UpdateBrandSignalInput,
  ): Promise<BrandSignal | null>;
  updateAsset(
    projectId: string,
    canonicalKey: string,
    changes: UpdateAssetInput,
  ): Promise<IntelligenceAsset | null>;

  findFeature(projectId: string, canonicalKey: string): Promise<Feature | null>;
  findProblem(projectId: string, canonicalKey: string): Promise<Problem | null>;
  findBenefit(projectId: string, canonicalKey: string): Promise<Benefit | null>;
  findClaim(projectId: string, canonicalKey: string): Promise<Claim | null>;
  findWorkflow(projectId: string, canonicalKey: string): Promise<Workflow | null>;
  findAudienceSignal(projectId: string, canonicalKey: string): Promise<AudienceSignal | null>;
  findBrandSignal(projectId: string, canonicalKey: string): Promise<BrandSignal | null>;
  findAsset(projectId: string, canonicalKey: string): Promise<IntelligenceAsset | null>;
  findEvidenceByKey(projectId: string, key: string): Promise<Evidence | null>;

  applyGraph(projectId: string, plan: IntelligencePersistencePlan): Promise<void>;
  readGraph(projectId: string): Promise<IntelligenceGraph>;

  createRun(input: CreateIntelligenceRunInput): Promise<IntelligenceRun>;
  updateRun(id: string, changes: UpdateIntelligenceRunInput): Promise<IntelligenceRun | null>;
  findActiveRun(projectId: string): Promise<IntelligenceRun | null>;
  listRuns(projectId: string, limit: number): Promise<IntelligenceRun[]>;

  createSnapshot(input: CreateIntelligenceSnapshotInput): Promise<IntelligenceSnapshot>;
  latestSnapshot(projectId: string): Promise<IntelligenceSnapshot | null>;
  listSnapshots(projectId: string, limit: number): Promise<IntelligenceSnapshot[]>;
}

export type { WorkflowStep };
