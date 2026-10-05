import type { PublicOrm } from "../../prisma/db";
import { db } from "../../prisma/db";
import type { Models } from "../../prisma/contract.d";
import { pgTimestampToIso } from "../../lib/time";
import type {
  AppendVariantPlan,
  CreateWritingClaimInput,
  CreateWritingDocumentInput,
  CreateWritingJobInput,
  CreateWritingVariantInput,
  GeneratedDocumentPlan,
  ListWritingClaimsFilter,
  ListWritingDocumentsFilter,
  ListWritingJobsFilter,
  UpdateWritingDocumentInput,
  WritingRepository,
} from "../../core/ports/writing-repository";
import type {
  WritingClaimRecord,
  WritingDocumentRecord,
  WritingGenerationJobRecord,
  WritingVariantRecord,
} from "../../modules/writing-engine/domain/types";

type DocumentRow = Omit<
  Models.public_WritingDocument,
  "claims" | "generationJobs" | "project" | "variants"
>;
type VariantRow = Omit<Models.public_WritingVariant, "claims" | "document">;
type JobRow = Omit<Models.public_WritingGenerationJob, "document" | "project">;
type ClaimRow = Omit<Models.public_WritingClaim, "document" | "project" | "variant">;

function decodeDocument(row: DocumentRow): WritingDocumentRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    createdById: row.createdById,
    title: row.title,
    blockType: row.blockType,
    tone: row.tone,
    length: row.length,
    objective: row.objective,
    audience: row.audience ?? null,
    language: row.language ?? null,
    content: row.content,
    contentSha256: row.contentSha256,
    contextSnapshot: row.contextSnapshot,
    contextSha256: row.contextSha256,
    version: row.version,
    brandVersion: row.brandVersion ?? null,
    intelligenceVersion: row.intelligenceVersion ?? null,
    intentId: row.intentId ?? null,
    directionId: row.directionId ?? null,
    storyboardId: row.storyboardId ?? null,
    sceneId: row.sceneId ?? null,
    selectedVariantId: row.selectedVariantId ?? null,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function decodeVariant(row: VariantRow): WritingVariantRecord {
  return {
    id: row.id,
    documentId: row.documentId,
    ordinal: row.ordinal,
    label: row.label,
    text: row.text,
    textSha256: row.textSha256,
    instruction: row.instruction ?? null,
    selected: row.selected,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function decodeJob(row: JobRow): WritingGenerationJobRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    requestedById: row.requestedById,
    documentId: row.documentId ?? null,
    provider: row.provider,
    status: row.status,
    blockType: row.blockType,
    tone: row.tone,
    length: row.length,
    objective: row.objective,
    audience: row.audience ?? null,
    language: row.language ?? null,
    prompt: row.prompt,
    generationRecipe: row.generationRecipe,
    recipeSha256: row.recipeSha256,
    contextSnapshot: row.contextSnapshot,
    contextSha256: row.contextSha256,
    variantCount: row.variantCount,
    progressPct: row.progressPct,
    providerJobId: row.providerJobId ?? null,
    providerModel: row.providerModel ?? null,
    providerVersion: row.providerVersion ?? null,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    createdAt: pgTimestampToIso(row.createdAt),
    startedAt: row.startedAt ? pgTimestampToIso(row.startedAt) : null,
    finishedAt: row.finishedAt ? pgTimestampToIso(row.finishedAt) : null,
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function decodeClaim(row: ClaimRow): WritingClaimRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    documentId: row.documentId,
    variantId: row.variantId ?? null,
    text: row.text,
    status: row.status,
    sourceIds: [...row.sourceIds],
    reasoning: row.reasoning ?? null,
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

export class PostgresWritingRepository implements WritingRepository {
  private readonly orm: PublicOrm;

  constructor(orm: PublicOrm = db.orm.public) {
    this.orm = orm;
  }

  async createDocument(
    input: CreateWritingDocumentInput,
  ): Promise<WritingDocumentRecord> {
    const row = (await this.orm.WritingDocument.create({
      id: input.id,
      projectId: input.projectId,
      createdById: input.createdById,
      title: input.title,
      blockType: input.blockType,
      tone: input.tone,
      length: input.length,
      objective: input.objective,
      audience: input.audience,
      language: input.language,
      content: input.content,
      contentSha256: input.contentSha256,
      contextSnapshot: input.contextSnapshot,
      contextSha256: input.contextSha256,
      version: input.version,
      brandVersion: input.brandVersion,
      intelligenceVersion: input.intelligenceVersion,
      intentId: input.intentId,
      directionId: input.directionId,
      storyboardId: input.storyboardId,
      sceneId: input.sceneId,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })) as unknown as DocumentRow;

    return decodeDocument(row);
  }

  async getDocument(
    projectId: string,
    documentId: string,
  ): Promise<WritingDocumentRecord | null> {
    const row = (await this.orm.WritingDocument.where({
      id: documentId,
      projectId,
    }).first()) as unknown as DocumentRow | null;

    return row ? decodeDocument(row) : null;
  }

  async listDocuments(
    projectId: string,
    filter: ListWritingDocumentsFilter = {},
  ): Promise<WritingDocumentRecord[]> {
    const rows = (await this.orm.WritingDocument.where({
      projectId,
      ...(filter.blockType ? { blockType: filter.blockType } : {}),
    })
      .orderBy((d) => d.createdAt.desc())
      .limit(filter.limit ?? 50)
      .all()) as unknown as DocumentRow[];

    return rows.map(decodeDocument);
  }

  async updateDocument(
    projectId: string,
    documentId: string,
    changes: UpdateWritingDocumentInput,
  ): Promise<WritingDocumentRecord> {
    const row = (await this.orm.WritingDocument.where({
      id: documentId,
      projectId,
    }).update({
      ...changes,
    })) as unknown as DocumentRow;

    return decodeDocument(row);
  }

  async createVariant(
    input: CreateWritingVariantInput,
  ): Promise<WritingVariantRecord> {
    const row = (await this.orm.WritingVariant.create({
      id: input.id,
      documentId: input.documentId,
      ordinal: input.ordinal,
      label: input.label,
      text: input.text,
      textSha256: input.textSha256,
      instruction: input.instruction,
      selected: input.selected,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })) as unknown as VariantRow;

    return decodeVariant(row);
  }

  async getVariant(
    documentId: string,
    variantId: string,
  ): Promise<WritingVariantRecord | null> {
    const row = (await this.orm.WritingVariant.where({
      id: variantId,
      documentId,
    }).first()) as unknown as VariantRow | null;

    return row ? decodeVariant(row) : null;
  }

  async listVariants(documentId: string): Promise<WritingVariantRecord[]> {
    const rows = (await this.orm.WritingVariant.where({ documentId })
      .orderBy((v) => v.ordinal.asc())
      .all()) as unknown as VariantRow[];

    return rows.map(decodeVariant);
  }

  async countVariants(documentId: string): Promise<number> {
    const rows = (await this.orm.WritingVariant.where({ documentId }).all()) as unknown as VariantRow[];
    return rows.length;
  }

  async selectVariant(
    projectId: string,
    documentId: string,
    variantId: string,
    updatedAt: string,
  ): Promise<WritingVariantRecord | null> {
    let selected = false;

    await db.transaction(async (tx) => {
      const document = (await tx.orm.public.WritingDocument.where({
        id: documentId,
        projectId,
      }).first()) as unknown as DocumentRow | null;
      if (!document) return;

      const variant = (await tx.orm.public.WritingVariant.where({
        id: variantId,
        documentId,
      }).first()) as unknown as VariantRow | null;
      if (!variant) return;

      const unselectPlan = tx.sql.public.writing_variant
        .update({ selected: false, updatedAt })
        .where((f, fns) => fns.eq(f.documentId, documentId))
        .where((f, fns) => fns.eq(f.selected, true))
        .returning("id")
        .build();
      await tx.query(unselectPlan);

      await tx.orm.public.WritingVariant.where({ id: variantId }).update({
        selected: true,
        updatedAt,
      });
      await tx.orm.public.WritingDocument.where({ id: documentId }).update({
        selectedVariantId: variantId,
        updatedAt,
      });
      selected = true;
    });

    if (!selected) return null;
    return this.getVariant(documentId, variantId);
  }

  async createClaims(inputs: readonly CreateWritingClaimInput[]): Promise<number> {
    let created = 0;
    for (const input of inputs) {
      await this.orm.WritingClaim.create({
        id: input.id,
        projectId: input.projectId,
        documentId: input.documentId,
        variantId: input.variantId,
        text: input.text,
        status: input.status,
        sourceIds: input.sourceIds,
        reasoning: input.reasoning,
        createdAt: input.createdAt,
      });
      created += 1;
    }
    return created;
  }

  async persistGeneratedDocument(
    plan: GeneratedDocumentPlan,
  ): Promise<WritingDocumentRecord> {
    const { document, variants, claims } = plan;

    await db.transaction(async (tx) => {
      await tx.orm.public.WritingDocument.create({
        id: document.id,
        projectId: document.projectId,
        createdById: document.createdById,
        title: document.title,
        blockType: document.blockType,
        tone: document.tone,
        length: document.length,
        objective: document.objective,
        audience: document.audience,
        language: document.language,
        content: document.content,
        contentSha256: document.contentSha256,
        contextSnapshot: document.contextSnapshot,
        contextSha256: document.contextSha256,
        version: document.version,
        brandVersion: document.brandVersion,
        intelligenceVersion: document.intelligenceVersion,
        intentId: document.intentId,
        directionId: document.directionId,
        storyboardId: document.storyboardId,
        sceneId: document.sceneId,
        selectedVariantId:
          variants.find((variant) => variant.selected)?.id ?? null,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      });

      for (const variant of variants) {
        await tx.orm.public.WritingVariant.create({
          id: variant.id,
          documentId: variant.documentId,
          ordinal: variant.ordinal,
          label: variant.label,
          text: variant.text,
          textSha256: variant.textSha256,
          instruction: variant.instruction,
          selected: variant.selected,
          createdAt: variant.createdAt,
          updatedAt: variant.updatedAt,
        });
      }

      for (const claim of claims) {
        await tx.orm.public.WritingClaim.create({
          id: claim.id,
          projectId: claim.projectId,
          documentId: claim.documentId,
          variantId: claim.variantId,
          text: claim.text,
          status: claim.status,
          sourceIds: claim.sourceIds,
          reasoning: claim.reasoning,
          createdAt: claim.createdAt,
        });
      }
    });

    const created = await this.getDocument(document.projectId, document.id);
    if (!created) {
      throw new Error("Persisted writing document could not be read back");
    }
    return created;
  }

  async appendVariant(
    plan: AppendVariantPlan,
  ): Promise<WritingVariantRecord | null> {
    const { projectId, documentId, variant, claims, documentUpdate } = plan;
    let appended = false;

    await db.transaction(async (tx) => {
      const document = (await tx.orm.public.WritingDocument.where({
        id: documentId,
        projectId,
      }).first()) as unknown as DocumentRow | null;
      if (!document) return;

      await tx.orm.public.WritingVariant.create({
        id: variant.id,
        documentId: variant.documentId,
        ordinal: variant.ordinal,
        label: variant.label,
        text: variant.text,
        textSha256: variant.textSha256,
        instruction: variant.instruction,
        selected: variant.selected,
        createdAt: variant.createdAt,
        updatedAt: variant.updatedAt,
      });

      for (const claim of claims) {
        await tx.orm.public.WritingClaim.create({
          id: claim.id,
          projectId: claim.projectId,
          documentId: claim.documentId,
          variantId: claim.variantId,
          text: claim.text,
          status: claim.status,
          sourceIds: claim.sourceIds,
          reasoning: claim.reasoning,
          createdAt: claim.createdAt,
        });
      }

      await tx.orm.public.WritingDocument.where({ id: documentId, projectId }).update({
        ...documentUpdate,
      });
      appended = true;
    });

    if (!appended) return null;
    return this.getVariant(documentId, variant.id);
  }

  async listClaims(
    projectId: string,
    documentId: string,
    filter: ListWritingClaimsFilter = {},
  ): Promise<WritingClaimRecord[]> {
    const rows = (await this.orm.WritingClaim.where({
      projectId,
      documentId,
      ...(filter.variantId ? { variantId: filter.variantId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    })
      .orderBy((c) => c.createdAt.asc())
      .all()) as unknown as ClaimRow[];

    return rows.map(decodeClaim);
  }

  async getClaim(
    projectId: string,
    documentId: string,
    claimId: string,
  ): Promise<WritingClaimRecord | null> {
    const row = (await this.orm.WritingClaim.where({
      id: claimId,
      projectId,
      documentId,
    }).first()) as unknown as ClaimRow | null;

    return row ? decodeClaim(row) : null;
  }

  async createJob(
    input: CreateWritingJobInput,
  ): Promise<WritingGenerationJobRecord> {
    const row = (await this.orm.WritingGenerationJob.create({
      id: input.id,
      projectId: input.projectId,
      requestedById: input.requestedById,
      documentId: input.documentId,
      provider: input.provider,
      status: "QUEUED",
      blockType: input.blockType,
      tone: input.tone,
      length: input.length,
      objective: input.objective,
      audience: input.audience,
      language: input.language,
      prompt: input.prompt,
      generationRecipe: input.generationRecipe,
      recipeSha256: input.recipeSha256,
      contextSnapshot: input.contextSnapshot,
      contextSha256: input.contextSha256,
      variantCount: input.variantCount,
      progressPct: 0,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })) as unknown as JobRow;

    return decodeJob(row);
  }

  async getJob(
    projectId: string,
    jobId: string,
  ): Promise<WritingGenerationJobRecord | null> {
    const row = (await this.orm.WritingGenerationJob.where({
      id: jobId,
      projectId,
    }).first()) as unknown as JobRow | null;

    return row ? decodeJob(row) : null;
  }

  async listJobs(
    projectId: string,
    filter: ListWritingJobsFilter = {},
  ): Promise<WritingGenerationJobRecord[]> {
    const rows = (await this.orm.WritingGenerationJob.where({
      projectId,
      ...(filter.documentId ? { documentId: filter.documentId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    })
      .orderBy((j) => j.createdAt.desc())
      .limit(filter.limit ?? 50)
      .all()) as unknown as JobRow[];

    return rows.map(decodeJob);
  }

  async claimNext(): Promise<WritingGenerationJobRecord | null> {
    const now = new Date().toISOString();
    let claimedId: string | null = null;

    await db.transaction(async (tx) => {
      const candidate = (await tx.orm.public.WritingGenerationJob.where({
        status: "QUEUED",
      })
        .orderBy((j) => j.createdAt.asc())
        .first()) as unknown as JobRow | null;

      if (!candidate) return;

      const plan = tx.sql.public.writing_generation_job
        .update({
          status: "RUNNING",
          progressPct: 0,
          startedAt: now,
          updatedAt: now,
        })
        .where((f, fns) => fns.eq(f.id, candidate.id))
        .where((f, fns) => fns.eq(f.status, "QUEUED"))
        .returning("id")
        .build();

      const rows = await tx.query(plan);
      if (rows.length === 1) claimedId = candidate.id;
    });

    if (!claimedId) return null;
    return this.getJobById(claimedId);
  }

  async updateProgress(
    jobId: string,
    progressPct: number,
    updatedAt: string,
  ): Promise<void> {
    await this.orm.WritingGenerationJob.where({ id: jobId }).update({
      progressPct: Math.max(0, Math.min(100, Math.round(progressPct))),
      updatedAt,
    });
  }

  async markRunning(input: {
    jobId: string;
    providerVersion: string | null;
    startedAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.WritingGenerationJob.where({ id: input.jobId }).update({
      status: "RUNNING",
      providerVersion: input.providerVersion,
      startedAt: input.startedAt,
      updatedAt: input.updatedAt,
    });
  }

  async markSucceeded(input: {
    jobId: string;
    documentId: string | null;
    providerModel: string | null;
    providerVersion: string | null;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.WritingGenerationJob.where({ id: input.jobId }).update({
      status: "SUCCEEDED",
      progressPct: 100,
      documentId: input.documentId,
      providerModel: input.providerModel,
      providerVersion: input.providerVersion,
      finishedAt: input.finishedAt,
      updatedAt: input.updatedAt,
    });
  }

  async markFailed(input: {
    jobId: string;
    errorCode: string;
    errorMessage: string;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.WritingGenerationJob.where({ id: input.jobId }).update({
      status: "FAILED",
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      finishedAt: input.finishedAt,
      updatedAt: input.updatedAt,
    });
  }

  async markCancelled(input: {
    jobId: string;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.WritingGenerationJob.where({ id: input.jobId }).update({
      status: "CANCELLED",
      finishedAt: input.finishedAt,
      updatedAt: input.updatedAt,
    });
  }

  async requestCancel(projectId: string, jobId: string): Promise<boolean> {
    const job = await this.getJob(projectId, jobId);
    if (!job) return false;
    if (job.status !== "QUEUED" && job.status !== "RUNNING") return false;

    const now = new Date().toISOString();
    const update = db.sql.public.writing_generation_job;
    const builder =
      job.status === "QUEUED"
        ? update
            .update({ status: "CANCELLED", finishedAt: now, updatedAt: now })
            .where((f, fns) => fns.eq(f.id, jobId))
            .where((f, fns) => fns.eq(f.status, "QUEUED"))
        : update
            .update({ status: "CANCEL_REQUESTED", updatedAt: now })
            .where((f, fns) => fns.eq(f.id, jobId))
            .where((f, fns) => fns.eq(f.status, "RUNNING"));

    const rows = await db.runtime().query(builder.returning("id").build());
    return rows.length === 1;
  }

  async findCancelRequested(): Promise<WritingGenerationJobRecord[]> {
    const rows = (await this.orm.WritingGenerationJob.where({
      status: "CANCEL_REQUESTED",
    }).all()) as unknown as JobRow[];

    return rows.map(decodeJob);
  }

  private async getJobById(
    jobId: string,
  ): Promise<WritingGenerationJobRecord | null> {
    const row = (await this.orm.WritingGenerationJob.where({
      id: jobId,
    }).first()) as unknown as JobRow | null;

    return row ? decodeJob(row) : null;
  }
}
