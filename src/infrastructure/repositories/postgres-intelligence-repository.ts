import type { PublicOrm } from "../../prisma/db";
import { db } from "../../prisma/db";
import type { Models } from "../../prisma/contract.d";
import { pgTimestampToIso } from "../../lib/time";
import type {
  AudienceSignal,
  BrandSignal,
  Benefit,
  Claim,
  Evidence,
  ExtractionMethod,
  Feature,
  IntelligenceAsset,
  IntelligenceGraph,
  IntelligenceRelationship,
  IntelligenceRun,
  IntelligenceSnapshot,
  Problem,
  Product,
  Provenance,
  Workflow,
  WorkflowStep,
} from "../../core/domain/intelligence";
import { emptyIntelligenceGraph } from "../../core/domain/intelligence";
import type {
  CreateIntelligenceRunInput,
  CreateIntelligenceSnapshotInput,
  IntelligenceGraphTransactions,
  IntelligencePersistencePlan,
  EvidenceValues,
  IntelligenceRepository,
  RelationshipValues,
  UpdateAssetInput,
  UpdateAudienceSignalInput,
  UpdateBenefitInput,
  UpdateBrandSignalInput,
  UpdateClaimInput,
  UpdateFeatureInput,
  UpdateIntelligenceRunInput,
  UpdateProblemInput,
  UpdateProductInput,
  UpdateWorkflowInput,
  WorkflowStepInput,
} from "../../core/ports/intelligence-repository";

type ProductRow = Omit<Models.public_IntelligenceProduct, "project">;
type EvidenceRow = Omit<Models.public_IntelligenceEvidence, "project" | "source">;
type FeatureRow = Omit<Models.public_IntelligenceFeature, "project">;
type ProblemRow = Omit<Models.public_IntelligenceProblem, "project">;
type BenefitRow = Omit<Models.public_IntelligenceBenefit, "project">;
type ClaimRow = Omit<Models.public_IntelligenceClaim, "project" | "source">;
type WorkflowRow = Omit<Models.public_IntelligenceWorkflow, "project" | "steps">;
type WorkflowStepRow = Omit<Models.public_IntelligenceWorkflowStep, "workflow">;
type AudienceSignalRow = Omit<Models.public_IntelligenceAudienceSignal, "project">;
type BrandSignalRow = Omit<Models.public_IntelligenceBrandSignal, "project">;
type AssetRow = Omit<Models.public_IntelligenceAsset, "project" | "source">;
type RelationshipRow = Omit<Models.public_IntelligenceRelationship, "project">;
type RunRow = Omit<Models.public_IntelligenceRun, "project" | "snapshots">;
type SnapshotRow = Omit<Models.public_IntelligenceSnapshot, "project" | "run">;

type ProvenanceColumns = {
  sourceIds: readonly string[];
  evidenceIds: readonly string[];
  extractionMethod: ExtractionMethod;
  extractedAt: string;
};

function mapProvenance(row: ProvenanceColumns): Provenance {
  return {
    sourceIds: [...row.sourceIds],
    evidenceIds: [...row.evidenceIds],
    method: row.extractionMethod,
    extractedAt: pgTimestampToIso(row.extractedAt),
  };
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    shortDescription: row.shortDescription,
    longDescription: row.longDescription,
    category: row.category,
    purpose: row.purpose,
    valueProposition: row.valueProposition,
    targetUserSummary: row.targetUserSummary,
    confidence: row.confidence,
    assertionKind: row.assertionKind,
    userLocked: row.userLocked,
    provenance: mapProvenance(row),
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function mapEvidence(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceId: row.sourceId,
    kind: row.kind,
    locator: row.locator,
    excerpt: row.excerpt,
    metadata: row.metadata,
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

function mapFeature(row: FeatureRow): Feature {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    category: row.category,
    importance: row.importance,
    confidence: row.confidence,
    assertionKind: row.assertionKind,
    userLocked: row.userLocked,
    canonicalKey: row.canonicalKey,
    provenance: mapProvenance(row),
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function mapProblem(row: ProblemRow): Problem {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    confidence: row.confidence,
    assertionKind: row.assertionKind,
    userLocked: row.userLocked,
    canonicalKey: row.canonicalKey,
    provenance: mapProvenance(row),
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function mapBenefit(row: BenefitRow): Benefit {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    linkedFeatureIds: [...row.linkedFeatureIds],
    confidence: row.confidence,
    assertionKind: row.assertionKind,
    userLocked: row.userLocked,
    canonicalKey: row.canonicalKey,
    provenance: mapProvenance(row),
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function mapClaim(row: ClaimRow): Claim {
  return {
    id: row.id,
    projectId: row.projectId,
    text: row.text,
    claimType: row.claimType,
    sourceId: row.sourceId,
    verification: row.verification,
    conflictsWithClaimId: row.conflictsWithClaimId,
    confidence: row.confidence,
    assertionKind: row.assertionKind,
    userLocked: row.userLocked,
    canonicalKey: row.canonicalKey,
    provenance: mapProvenance(row),
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function mapWorkflow(row: WorkflowRow, steps: WorkflowStep[]): Workflow {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    steps,
    featureIds: [...row.featureIds],
    confidence: row.confidence,
    assertionKind: row.assertionKind,
    userLocked: row.userLocked,
    canonicalKey: row.canonicalKey,
    provenance: mapProvenance(row),
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function mapWorkflowStep(row: WorkflowStepRow): WorkflowStep {
  return {
    id: row.id,
    workflowId: row.workflowId,
    order: row.order,
    action: row.action,
    description: row.description,
    featureIds: [...row.featureIds],
  };
}

async function hydrateWorkflowSteps(orm: PublicOrm, rows: WorkflowRow[]): Promise<Workflow[]> {
  if (rows.length === 0) return [];

  const stepRows = await orm.IntelligenceWorkflowStep.where((step) =>
    step.workflowId.in(rows.map((row) => row.id)),
  )
    .orderBy((step) => step.order.asc())
    .all();

  const stepsByWorkflow = new Map<string, WorkflowStep[]>();
  for (const stepRow of stepRows) {
    const bucket = stepsByWorkflow.get(stepRow.workflowId);
    if (bucket) bucket.push(mapWorkflowStep(stepRow));
    else stepsByWorkflow.set(stepRow.workflowId, [mapWorkflowStep(stepRow)]);
  }

  return rows.map((row) => mapWorkflow(row, stepsByWorkflow.get(row.id) ?? []));
}

function mapAudienceSignal(row: AudienceSignalRow): AudienceSignal {
  return {
    id: row.id,
    projectId: row.projectId,
    segment: row.segment,
    description: row.description,
    kind: row.kind,
    confidence: row.confidence,
    assertionKind: row.assertionKind,
    userLocked: row.userLocked,
    canonicalKey: row.canonicalKey,
    provenance: mapProvenance(row),
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function mapBrandSignal(row: BrandSignalRow): BrandSignal {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    label: row.label,
    value: row.value,
    confidence: row.confidence,
    assertionKind: row.assertionKind,
    userLocked: row.userLocked,
    canonicalKey: row.canonicalKey,
    provenance: mapProvenance(row),
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function mapAsset(row: AssetRow): IntelligenceAsset {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceId: row.sourceId,
    name: row.name,
    mediaType: row.mediaType,
    role: row.role,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    qualitySignals: row.qualitySignals,
    relatedFeatureIds: [...row.relatedFeatureIds],
    relatedClaimIds: [...row.relatedClaimIds],
    confidence: row.confidence,
    assertionKind: row.assertionKind,
    userLocked: row.userLocked,
    canonicalKey: row.canonicalKey,
    provenance: mapProvenance(row),
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function mapRelationship(row: RelationshipRow): IntelligenceRelationship {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    fromType: row.fromType,
    fromId: row.fromId,
    toType: row.toType,
    toId: row.toId,
    confidence: row.confidence,
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

function mapRun(row: RunRow): IntelligenceRun {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    sourceIds: [...row.sourceIds],
    provider: row.provider,
    model: row.model,
    trigger: row.trigger,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt === null ? null : pgTimestampToIso(row.startedAt),
    completedAt: row.completedAt === null ? null : pgTimestampToIso(row.completedAt),
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function mapSnapshot(row: SnapshotRow): IntelligenceSnapshot {
  return {
    id: row.id,
    projectId: row.projectId,
    version: row.version,
    runId: row.runId,
    summary: row.summary,
    entityCounts: row.entityCounts,
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

function edgeKey(edge: {
  type: IntelligenceRelationship["type"];
  fromId: string;
  toId: string;
}): string {
  return `${edge.type} ${edge.fromId} ${edge.toId}`;
}

/**
 * Every entity write keys off a canonical key so a re-analysis updates the row
 * that relationships and snapshots already point at. `userLocked` is written on
 * insert only: a user correction is decided before this point, so the update
 * branch must not be able to silently clear it.
 */
export async function writeIntelligenceGraph(
  orm: PublicOrm,
  projectId: string,
  plan: IntelligencePersistencePlan,
): Promise<void> {
  for (const item of plan.evidence) {
    await orm.IntelligenceEvidence.upsert({
      create: {
        id: item.id,
        projectId,
        sourceId: item.sourceId,
        kind: item.kind,
        locator: item.locator,
        excerpt: item.excerpt,
        metadata: item.metadata,
        evidenceKey: item.key,
      },
      update: {
        sourceId: item.sourceId,
        kind: item.kind,
        locator: item.locator,
        excerpt: item.excerpt,
        metadata: item.metadata,
      },
      conflictOn: { projectId, evidenceKey: item.key },
    });
  }

  if (plan.product) {
    const { id, values } = plan.product;
    await orm.IntelligenceProduct.upsert({
      create: {
        id,
        projectId,
        name: values.name,
        shortDescription: values.shortDescription,
        longDescription: values.longDescription,
        category: values.category,
        purpose: values.purpose,
        valueProposition: values.valueProposition,
        targetUserSummary: values.targetUserSummary,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        userLocked: values.userLocked,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      update: {
        name: values.name,
        shortDescription: values.shortDescription,
        longDescription: values.longDescription,
        category: values.category,
        purpose: values.purpose,
        valueProposition: values.valueProposition,
        targetUserSummary: values.targetUserSummary,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      conflictOn: { projectId },
    });
  }

  for (const { id, values } of plan.features) {
    await orm.IntelligenceFeature.upsert({
      create: {
        id,
        projectId,
        name: values.name,
        description: values.description,
        category: values.category,
        importance: values.importance,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        userLocked: values.userLocked,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      update: {
        name: values.name,
        description: values.description,
        category: values.category,
        importance: values.importance,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      conflictOn: { projectId, canonicalKey: values.canonicalKey },
    });
  }

  for (const { id, values } of plan.problems) {
    await orm.IntelligenceProblem.upsert({
      create: {
        id,
        projectId,
        name: values.name,
        description: values.description,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        userLocked: values.userLocked,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      update: {
        name: values.name,
        description: values.description,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      conflictOn: { projectId, canonicalKey: values.canonicalKey },
    });
  }

  for (const { id, values } of plan.benefits) {
    await orm.IntelligenceBenefit.upsert({
      create: {
        id,
        projectId,
        name: values.name,
        description: values.description,
        linkedFeatureIds: values.linkedFeatureIds,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        userLocked: values.userLocked,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      update: {
        name: values.name,
        description: values.description,
        linkedFeatureIds: values.linkedFeatureIds,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      conflictOn: { projectId, canonicalKey: values.canonicalKey },
    });
  }

  for (const { id, values } of plan.claims) {
    await orm.IntelligenceClaim.upsert({
      create: {
        id,
        projectId,
        text: values.text,
        claimType: values.claimType,
        sourceId: values.sourceId,
        verification: values.verification,
        conflictsWithClaimId: values.conflictsWithClaimId,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        userLocked: values.userLocked,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      update: {
        text: values.text,
        claimType: values.claimType,
        sourceId: values.sourceId,
        verification: values.verification,
        conflictsWithClaimId: values.conflictsWithClaimId,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      conflictOn: { projectId, canonicalKey: values.canonicalKey },
    });
  }

  for (const { id, values } of plan.workflows) {
    await orm.IntelligenceWorkflow.upsert({
      create: {
        id,
        projectId,
        name: values.name,
        description: values.description,
        featureIds: values.featureIds,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        userLocked: values.userLocked,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      update: {
        name: values.name,
        description: values.description,
        featureIds: values.featureIds,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      conflictOn: { projectId, canonicalKey: values.canonicalKey },
    });

    await orm.IntelligenceWorkflowStep.where((step) => step.workflowId.eq(id)).deleteAndCount();
    if (values.steps.length > 0) {
      await orm.IntelligenceWorkflowStep.createAll(
        values.steps.map((step) => ({
          workflowId: id,
          order: step.order,
          action: step.action,
          description: step.description,
          featureIds: step.featureIds,
        })),
      );
    }
  }

  for (const { id, values } of plan.audienceSignals) {
    await orm.IntelligenceAudienceSignal.upsert({
      create: {
        id,
        projectId,
        segment: values.segment,
        description: values.description,
        kind: values.kind,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        userLocked: values.userLocked,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      update: {
        segment: values.segment,
        description: values.description,
        kind: values.kind,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      conflictOn: { projectId, canonicalKey: values.canonicalKey },
    });
  }

  for (const { id, values } of plan.brandSignals) {
    await orm.IntelligenceBrandSignal.upsert({
      create: {
        id,
        projectId,
        kind: values.kind,
        label: values.label,
        value: values.value,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        userLocked: values.userLocked,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      update: {
        kind: values.kind,
        label: values.label,
        value: values.value,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      conflictOn: { projectId, canonicalKey: values.canonicalKey },
    });
  }

  for (const { id, values } of plan.assets) {
    await orm.IntelligenceAsset.upsert({
      create: {
        id,
        projectId,
        sourceId: values.sourceId,
        name: values.name,
        mediaType: values.mediaType,
        role: values.role,
        storageKey: values.storageKey,
        mimeType: values.mimeType,
        width: values.width,
        height: values.height,
        durationMs: values.durationMs,
        qualitySignals: values.qualitySignals,
        relatedFeatureIds: values.relatedFeatureIds,
        relatedClaimIds: values.relatedClaimIds,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        userLocked: values.userLocked,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      update: {
        sourceId: values.sourceId,
        name: values.name,
        mediaType: values.mediaType,
        role: values.role,
        storageKey: values.storageKey,
        mimeType: values.mimeType,
        width: values.width,
        height: values.height,
        durationMs: values.durationMs,
        qualitySignals: values.qualitySignals,
        relatedFeatureIds: values.relatedFeatureIds,
        relatedClaimIds: values.relatedClaimIds,
        confidence: values.confidence,
        assertionKind: values.assertionKind,
        canonicalKey: values.canonicalKey,
        sourceIds: values.sourceIds,
        evidenceIds: values.evidenceIds,
        extractionMethod: values.method,
        extractedAt: values.extractedAt,
      },
      conflictOn: { projectId, canonicalKey: values.canonicalKey },
    });
  }

  const desiredEdges = new Set<string>();
  for (const relationship of plan.relationships) {
    desiredEdges.add(edgeKey(relationship));
    await upsertRelationship(orm, projectId, relationship);
  }

  const existingEdges = await orm.IntelligenceRelationship.where((edge) =>
    edge.projectId.eq(projectId),
  ).all();
  for (const edge of existingEdges) {
    if (!desiredEdges.has(edgeKey(edge))) {
      await orm.IntelligenceRelationship.where({ id: edge.id }).delete();
    }
  }
}

async function upsertRelationship(
  orm: PublicOrm,
  projectId: string,
  relationship: RelationshipValues,
): Promise<void> {
  await orm.IntelligenceRelationship.upsert({
    create: {
      projectId,
      type: relationship.type,
      fromType: relationship.fromType,
      fromId: relationship.fromId,
      toType: relationship.toType,
      toId: relationship.toId,
      confidence: relationship.confidence,
    },
    update: { confidence: relationship.confidence },
    conflictOn: {
      projectId,
      type: relationship.type,
      fromId: relationship.fromId,
      toId: relationship.toId,
    },
  });
}

export const postgresIntelligenceGraphTransactions: IntelligenceGraphTransactions = {
  async applyGraph(projectId, plan) {
    await db.transaction(async (tx) => {
      await writeIntelligenceGraph(tx.orm.public, projectId, plan);
    });
  },
  async updateWorkflow(projectId, canonicalKey, changes) {
    const row = await db.transaction(async (tx) => {
      const updated = await writeWorkflowCorrection(
        tx.orm.public,
        projectId,
        canonicalKey,
        changes,
      );
      if (updated && changes.steps) {
        await replaceWorkflowSteps(tx.orm.public, updated.id, changes.steps);
      }
      return updated;
    });

    if (!row) return null;
    const [workflow] = await hydrateWorkflowSteps(db.orm.public, [row]);
    return workflow ?? null;
  },
};

async function writeWorkflowCorrection(
  orm: PublicOrm,
  projectId: string,
  canonicalKey: string,
  changes: UpdateWorkflowInput,
): Promise<WorkflowRow | null> {
  const columns: Record<string, unknown> = { ...changes };
  delete columns.steps;
  if (Object.keys(columns).length === 0) {
    return orm.IntelligenceWorkflow.where({ projectId, canonicalKey }).first();
  }
  return orm.IntelligenceWorkflow.where({ projectId, canonicalKey }).update(columns);
}

async function replaceWorkflowSteps(
  orm: PublicOrm,
  workflowId: string,
  steps: readonly WorkflowStepInput[],
): Promise<void> {
  await orm.IntelligenceWorkflowStep.where((step) => step.workflowId.eq(workflowId)).deleteAndCount();
  if (steps.length === 0) return;
  await orm.IntelligenceWorkflowStep.createAll(
    steps.map((step) => ({
      workflowId,
      order: step.order,
      action: step.action,
      description: step.description,
      featureIds: step.featureIds,
    })),
  );
}

export class PostgresIntelligenceRepository implements IntelligenceRepository {
  constructor(
    private readonly orm: PublicOrm,
    private readonly transactions: IntelligenceGraphTransactions =
      postgresIntelligenceGraphTransactions,
  ) {}

  async applyGraph(projectId: string, plan: IntelligencePersistencePlan): Promise<void> {
    await this.transactions.applyGraph(projectId, plan);
  }

  async recordEvidence(projectId: string, evidence: EvidenceValues[]): Promise<void> {
    if (evidence.length === 0) return;
    await db.transaction(async (tx) => {
      for (const item of evidence) {
        await tx.orm.public.IntelligenceEvidence.upsert({
          create: {
            id: item.id,
            projectId,
            sourceId: item.sourceId,
            kind: item.kind,
            locator: item.locator,
            excerpt: item.excerpt,
            metadata: item.metadata,
            evidenceKey: item.key,
          },
          update: {
            kind: item.kind,
            locator: item.locator,
            excerpt: item.excerpt,
            metadata: item.metadata,
          },
        });
      }
    });
  }

  async getProduct(projectId: string): Promise<Product | null> {
    const row = await this.orm.IntelligenceProduct.first({ projectId });
    return row ? mapProduct(row) : null;
  }

  async updateProduct(
    projectId: string,
    changes: UpdateProductInput,
  ): Promise<Product | null> {
    const row = await this.orm.IntelligenceProduct.where({ projectId }).update(changes);
    return row ? mapProduct(row) : null;
  }

  async listFeatures(projectId: string): Promise<Feature[]> {
    const rows = await this.orm.IntelligenceFeature.where((feature) =>
      feature.projectId.eq(projectId),
    )
      .orderBy((feature) => feature.createdAt.asc())
      .all();
    return rows.map(mapFeature);
  }

  async listProblems(projectId: string): Promise<Problem[]> {
    const rows = await this.orm.IntelligenceProblem.where((problem) =>
      problem.projectId.eq(projectId),
    )
      .orderBy((problem) => problem.createdAt.asc())
      .all();
    return rows.map(mapProblem);
  }

  async listBenefits(projectId: string): Promise<Benefit[]> {
    const rows = await this.orm.IntelligenceBenefit.where((benefit) =>
      benefit.projectId.eq(projectId),
    )
      .orderBy((benefit) => benefit.createdAt.asc())
      .all();
    return rows.map(mapBenefit);
  }

  async listClaims(projectId: string): Promise<Claim[]> {
    const rows = await this.orm.IntelligenceClaim.where((claim) => claim.projectId.eq(projectId))
      .orderBy((claim) => claim.createdAt.asc())
      .all();
    return rows.map(mapClaim);
  }

  async listWorkflows(projectId: string): Promise<Workflow[]> {
    const rows = await this.orm.IntelligenceWorkflow.where((workflow) =>
      workflow.projectId.eq(projectId),
    )
      .orderBy((workflow) => workflow.createdAt.asc())
      .all();
    return this.hydrateWorkflows(rows);
  }

  async listAudienceSignals(projectId: string): Promise<AudienceSignal[]> {
    const rows = await this.orm.IntelligenceAudienceSignal.where((signal) =>
      signal.projectId.eq(projectId),
    )
      .orderBy((signal) => signal.createdAt.asc())
      .all();
    return rows.map(mapAudienceSignal);
  }

  async listBrandSignals(projectId: string): Promise<BrandSignal[]> {
    const rows = await this.orm.IntelligenceBrandSignal.where((signal) =>
      signal.projectId.eq(projectId),
    )
      .orderBy((signal) => signal.createdAt.asc())
      .all();
    return rows.map(mapBrandSignal);
  }

  async listAssets(projectId: string): Promise<IntelligenceAsset[]> {
    const rows = await this.orm.IntelligenceAsset.where((asset) => asset.projectId.eq(projectId))
      .orderBy((asset) => asset.createdAt.asc())
      .all();
    return rows.map(mapAsset);
  }

  async listEvidence(projectId: string): Promise<Evidence[]> {
    const rows = await this.orm.IntelligenceEvidence.where((item) =>
      item.projectId.eq(projectId),
    )
      .orderBy((item) => item.createdAt.asc())
      .all();
    return rows.map(mapEvidence);
  }

  async listRelationships(projectId: string): Promise<IntelligenceRelationship[]> {
    const rows = await this.orm.IntelligenceRelationship.where((edge) =>
      edge.projectId.eq(projectId),
    )
      .orderBy((edge) => edge.createdAt.asc())
      .all();
    return rows.map(mapRelationship);
  }

  async findFeature(projectId: string, canonicalKey: string): Promise<Feature | null> {
    const row = await this.findByCanonicalKey(
      this.orm.IntelligenceFeature,
      projectId,
      canonicalKey,
    );
    return row ? mapFeature(row) : null;
  }

  async findProblem(projectId: string, canonicalKey: string): Promise<Problem | null> {
    const row = await this.findByCanonicalKey(
      this.orm.IntelligenceProblem,
      projectId,
      canonicalKey,
    );
    return row ? mapProblem(row) : null;
  }

  async findBenefit(projectId: string, canonicalKey: string): Promise<Benefit | null> {
    const row = await this.findByCanonicalKey(
      this.orm.IntelligenceBenefit,
      projectId,
      canonicalKey,
    );
    return row ? mapBenefit(row) : null;
  }

  async findClaim(projectId: string, canonicalKey: string): Promise<Claim | null> {
    const row = await this.findByCanonicalKey(
      this.orm.IntelligenceClaim,
      projectId,
      canonicalKey,
    );
    return row ? mapClaim(row) : null;
  }

  async findWorkflow(projectId: string, canonicalKey: string): Promise<Workflow | null> {
    const row = await this.findByCanonicalKey(
      this.orm.IntelligenceWorkflow,
      projectId,
      canonicalKey,
    );
    if (!row) return null;
    const [workflow] = await this.hydrateWorkflows([row]);
    return workflow ?? null;
  }

  async findAudienceSignal(
    projectId: string,
    canonicalKey: string,
  ): Promise<AudienceSignal | null> {
    const row = await this.findByCanonicalKey(
      this.orm.IntelligenceAudienceSignal,
      projectId,
      canonicalKey,
    );
    return row ? mapAudienceSignal(row) : null;
  }

  async findBrandSignal(projectId: string, canonicalKey: string): Promise<BrandSignal | null> {
    const row = await this.findByCanonicalKey(
      this.orm.IntelligenceBrandSignal,
      projectId,
      canonicalKey,
    );
    return row ? mapBrandSignal(row) : null;
  }

  async findAsset(projectId: string, canonicalKey: string): Promise<IntelligenceAsset | null> {
    const row = await this.findByCanonicalKey(
      this.orm.IntelligenceAsset,
      projectId,
      canonicalKey,
    );
    return row ? mapAsset(row) : null;
  }

  async findEvidenceByKey(projectId: string, key: string): Promise<Evidence | null> {
    const row = await this.orm.IntelligenceEvidence.where((item) => item.projectId.eq(projectId))
      .where((item) => item.evidenceKey.eq(key))
      .first();
    return row ? mapEvidence(row) : null;
  }

  async updateFeature(
    projectId: string,
    canonicalKey: string,
    changes: UpdateFeatureInput,
  ): Promise<Feature | null> {
    return this.updateByCanonicalKey(this.orm.IntelligenceFeature, mapFeature, projectId, canonicalKey, changes);
  }

  async updateProblem(
    projectId: string,
    canonicalKey: string,
    changes: UpdateProblemInput,
  ): Promise<Problem | null> {
    return this.updateByCanonicalKey(this.orm.IntelligenceProblem, mapProblem, projectId, canonicalKey, changes);
  }

  async updateBenefit(
    projectId: string,
    canonicalKey: string,
    changes: UpdateBenefitInput,
  ): Promise<Benefit | null> {
    return this.updateByCanonicalKey(this.orm.IntelligenceBenefit, mapBenefit, projectId, canonicalKey, changes);
  }

  async updateClaim(
    projectId: string,
    canonicalKey: string,
    changes: UpdateClaimInput,
  ): Promise<Claim | null> {
    return this.updateByCanonicalKey(this.orm.IntelligenceClaim, mapClaim, projectId, canonicalKey, changes);
  }

  async updateAudienceSignal(
    projectId: string,
    canonicalKey: string,
    changes: UpdateAudienceSignalInput,
  ): Promise<AudienceSignal | null> {
    return this.updateByCanonicalKey(this.orm.IntelligenceAudienceSignal, mapAudienceSignal, projectId, canonicalKey, changes);
  }

  async updateBrandSignal(
    projectId: string,
    canonicalKey: string,
    changes: UpdateBrandSignalInput,
  ): Promise<BrandSignal | null> {
    return this.updateByCanonicalKey(this.orm.IntelligenceBrandSignal, mapBrandSignal, projectId, canonicalKey, changes);
  }

  async updateAsset(
    projectId: string,
    canonicalKey: string,
    changes: UpdateAssetInput,
  ): Promise<IntelligenceAsset | null> {
    return this.updateByCanonicalKey(this.orm.IntelligenceAsset, mapAsset, projectId, canonicalKey, changes);
  }

  async updateWorkflow(
    projectId: string,
    canonicalKey: string,
    changes: UpdateWorkflowInput,
  ): Promise<Workflow | null> {
    return this.transactions.updateWorkflow(projectId, canonicalKey, changes);
  }

  async readGraph(projectId: string): Promise<IntelligenceGraph> {
    const [product, features, problems, benefits, claims, workflows, audienceSignals, brandSignals, assets, evidence, relationships] =
      await Promise.all([
        this.getProduct(projectId),
        this.listFeatures(projectId),
        this.listProblems(projectId),
        this.listBenefits(projectId),
        this.listClaims(projectId),
        this.listWorkflows(projectId),
        this.listAudienceSignals(projectId),
        this.listBrandSignals(projectId),
        this.listAssets(projectId),
        this.listEvidence(projectId),
        this.listRelationships(projectId),
      ]);

    if (
      product === null &&
      features.length === 0 &&
      problems.length === 0 &&
      benefits.length === 0 &&
      claims.length === 0 &&
      workflows.length === 0 &&
      audienceSignals.length === 0 &&
      brandSignals.length === 0 &&
      assets.length === 0 &&
      evidence.length === 0 &&
      relationships.length === 0
    ) {
      return emptyIntelligenceGraph();
    }

    return {
      product,
      features,
      problems,
      benefits,
      claims,
      workflows,
      audienceSignals,
      brandSignals,
      assets,
      evidence,
      relationships,
    };
  }

  async createRun(input: CreateIntelligenceRunInput): Promise<IntelligenceRun> {
    const row = await this.orm.IntelligenceRun.create({
      id: input.id,
      projectId: input.projectId,
      status: input.status,
      sourceIds: input.sourceIds,
      provider: input.provider,
      model: input.model,
      trigger: input.trigger,
    });
    return mapRun(row);
  }

  async updateRun(
    id: string,
    changes: UpdateIntelligenceRunInput,
  ): Promise<IntelligenceRun | null> {
    const row = await this.orm.IntelligenceRun.where({ id }).update(changes);
    return row ? mapRun(row) : null;
  }

  async findActiveRun(projectId: string): Promise<IntelligenceRun | null> {
    const row = await this.orm.IntelligenceRun.where((run) => run.projectId.eq(projectId))
      .where((run) => run.status.in(["QUEUED", "RUNNING"]))
      .orderBy((run) => run.createdAt.desc())
      .first();
    return row ? mapRun(row) : null;
  }

  async listRuns(projectId: string, limit: number): Promise<IntelligenceRun[]> {
    const rows = await this.orm.IntelligenceRun.where((run) => run.projectId.eq(projectId))
      .orderBy((run) => run.createdAt.desc())
      .limit(limit)
      .all();
    return rows.map(mapRun);
  }

  async createSnapshot(input: CreateIntelligenceSnapshotInput): Promise<IntelligenceSnapshot> {
    const row = await this.orm.IntelligenceSnapshot.create({
      id: input.id,
      projectId: input.projectId,
      version: input.version,
      runId: input.runId,
      summary: input.summary,
      entityCounts: input.entityCounts,
    });
    return mapSnapshot(row);
  }

  async latestSnapshot(projectId: string): Promise<IntelligenceSnapshot | null> {
    const row = await this.orm.IntelligenceSnapshot.where((snapshot) =>
      snapshot.projectId.eq(projectId),
    )
      .orderBy((snapshot) => snapshot.version.desc())
      .first();
    return row ? mapSnapshot(row) : null;
  }

  async listSnapshots(projectId: string, limit: number): Promise<IntelligenceSnapshot[]> {
    const rows = await this.orm.IntelligenceSnapshot.where((snapshot) =>
      snapshot.projectId.eq(projectId),
    )
      .orderBy((snapshot) => snapshot.version.desc())
      .limit(limit)
      .all();
    return rows.map(mapSnapshot);
  }

  private async hydrateWorkflows(rows: WorkflowRow[]): Promise<Workflow[]> {
    return hydrateWorkflowSteps(this.orm, rows);
  }

  private async findByCanonicalKey<TRow>(
    collection: {
      where(filter: { projectId: string; canonicalKey: string }): { first(): Promise<TRow | null> };
    },
    projectId: string,
    canonicalKey: string,
  ): Promise<TRow | null> {
    return collection.where({ projectId, canonicalKey }).first();
  }

  private async updateByCanonicalKey<TRow, TEntity, TChanges>(
    collection: {
      where(filter: { projectId: string; canonicalKey: string }): {
        update(changes: TChanges): Promise<TRow | null>;
      };
    },
    map: (row: TRow) => TEntity,
    projectId: string,
    canonicalKey: string,
    changes: TChanges,
  ): Promise<TEntity | null> {
    const row = await collection.where({ projectId, canonicalKey }).update(changes);
    return row ? map(row) : null;
  }
}
