import type { PublicOrm } from "../../prisma/db";
import { db } from "../../prisma/db";
import type { Models } from "../../prisma/contract.d";
import { pgTimestampToIso } from "../../lib/time";
import type {
  CreateGeneratedImageAssetInput,
  CreateGraphicDocumentInput,
  CreateImageGenerationJobInput,
  ImageGenerationRepository,
  ListGeneratedImageAssetsFilter,
  ListImageGenerationJobsFilter,
  UpdateGraphicDocumentInput,
} from "../../core/ports/image-generation-repository";
import type {
  GeneratedImageAssetRecord,
  GraphicDocumentRecord,
  ImageGenerationJobRecord,
} from "../../modules/image-generation/domain/types";

type DocumentRow = Omit<
  Models.public_GraphicDocument,
  "assets" | "generationJobs" | "project"
>;
type JobRow = Omit<
  Models.public_ImageGenerationJob,
  "assets" | "graphicDocument" | "project"
>;
type AssetRow = Omit<
  Models.public_GeneratedImageAsset,
  "generationJob" | "graphicDocument" | "project"
>;

function decodeDocument(row: DocumentRow): GraphicDocumentRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    createdById: row.createdById,
    name: row.name,
    templateType: row.templateType,
    width: row.width,
    height: row.height,
    outputFormat: row.outputFormat,
    transparent: row.transparent,
    designGraph: row.designGraph,
    designGraphHash: row.designGraphHash,
    contractVersion: row.contractVersion,
    deletedAt: row.deletedAt ? pgTimestampToIso(row.deletedAt) : null,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function decodeJob(row: JobRow): ImageGenerationJobRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    requestedById: row.requestedById,
    graphicDocumentId: row.graphicDocumentId ?? null,
    provider: row.provider,
    status: row.status,
    outputFormat: row.outputFormat,
    width: row.width,
    height: row.height,
    transparent: row.transparent,
    prompt: row.prompt,
    generationRecipe: row.generationRecipe,
    recipeSha256: row.recipeSha256,
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

function decodeAsset(row: AssetRow): GeneratedImageAssetRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    generationJobId: row.generationJobId ?? null,
    graphicDocumentId: row.graphicDocumentId ?? null,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    outputFormat: row.outputFormat,
    width: row.width,
    height: row.height,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    transparent: row.transparent,
    metadata: row.metadata ?? null,
    deletedAt: row.deletedAt ? pgTimestampToIso(row.deletedAt) : null,
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

export class PostgresImageRepository implements ImageGenerationRepository {
  private readonly orm: PublicOrm;

  constructor(orm: PublicOrm = db.orm.public) {
    this.orm = orm;
  }

  async createDocument(
    input: CreateGraphicDocumentInput,
  ): Promise<GraphicDocumentRecord> {
    const row = (await this.orm.GraphicDocument.create({
      id: input.id,
      projectId: input.projectId,
      createdById: input.createdById,
      name: input.name,
      templateType: input.templateType,
      width: input.width,
      height: input.height,
      outputFormat: input.outputFormat,
      transparent: input.transparent,
      designGraph: input.designGraph,
      designGraphHash: input.designGraphHash,
      contractVersion: input.contractVersion,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })) as unknown as DocumentRow;

    return decodeDocument(row);
  }

  async getDocument(
    projectId: string,
    documentId: string,
  ): Promise<GraphicDocumentRecord | null> {
    const row = (await this.orm.GraphicDocument.where({
      id: documentId,
      projectId,
      deletedAt: null,
    }).first()) as unknown as DocumentRow | null;

    return row ? decodeDocument(row) : null;
  }

  async listDocuments(
    projectId: string,
    limit = 50,
  ): Promise<GraphicDocumentRecord[]> {
    const rows = (await this.orm.GraphicDocument.where({
      projectId,
      deletedAt: null,
    })
      .orderBy((d) => d.createdAt.desc())
      .limit(limit)
      .all()) as unknown as DocumentRow[];

    return rows.map(decodeDocument);
  }

  async updateDocument(
    projectId: string,
    documentId: string,
    changes: UpdateGraphicDocumentInput,
  ): Promise<GraphicDocumentRecord> {
    const row = (await this.orm.GraphicDocument.where({
      id: documentId,
      projectId,
    }).update({
      ...changes,
    })) as unknown as DocumentRow;

    return decodeDocument(row);
  }

  async softDeleteDocument(
    projectId: string,
    documentId: string,
    deletedAt: string,
  ): Promise<void> {
    await this.orm.GraphicDocument.where({ id: documentId, projectId }).update({
      deletedAt,
      updatedAt: deletedAt,
    });
  }

  async createJob(
    input: CreateImageGenerationJobInput,
  ): Promise<ImageGenerationJobRecord> {
    const row = (await this.orm.ImageGenerationJob.create({
      id: input.id,
      projectId: input.projectId,
      requestedById: input.requestedById,
      graphicDocumentId: input.graphicDocumentId,
      provider: input.provider,
      status: "QUEUED",
      outputFormat: input.outputFormat,
      width: input.width,
      height: input.height,
      transparent: input.transparent,
      prompt: input.prompt,
      generationRecipe: input.generationRecipe,
      recipeSha256: input.recipeSha256,
      progressPct: 0,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })) as unknown as JobRow;

    return decodeJob(row);
  }

  async getJob(
    projectId: string,
    jobId: string,
  ): Promise<ImageGenerationJobRecord | null> {
    const row = (await this.orm.ImageGenerationJob.where({
      id: jobId,
      projectId,
    }).first()) as unknown as JobRow | null;

    return row ? decodeJob(row) : null;
  }

  async listJobs(
    projectId: string,
    filter: ListImageGenerationJobsFilter = {},
  ): Promise<ImageGenerationJobRecord[]> {
    const rows = (await this.orm.ImageGenerationJob.where({
      projectId,
      ...(filter.graphicDocumentId
        ? { graphicDocumentId: filter.graphicDocumentId }
        : {}),
      ...(filter.status ? { status: filter.status } : {}),
    })
      .orderBy((j) => j.createdAt.desc())
      .limit(filter.limit ?? 50)
      .all()) as unknown as JobRow[];

    return rows.map(decodeJob);
  }

  async claimNext(): Promise<ImageGenerationJobRecord | null> {
    const now = new Date().toISOString();
    let claimedId: string | null = null;

    await db.transaction(async (tx) => {
      const candidate = (await tx.orm.public.ImageGenerationJob.where({
        status: "QUEUED",
      })
        .orderBy((j) => j.createdAt.asc())
        .first()) as unknown as JobRow | null;

      if (!candidate) return;

      const plan = tx.sql.public.image_generation_job
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
    await this.orm.ImageGenerationJob.where({ id: jobId }).update({
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
    await this.orm.ImageGenerationJob.where({ id: input.jobId }).update({
      status: "RUNNING",
      providerVersion: input.providerVersion,
      startedAt: input.startedAt,
      updatedAt: input.updatedAt,
    });
  }

  async markSucceeded(input: {
    jobId: string;
    providerJobId: string | null;
    providerModel: string | null;
    providerVersion: string | null;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.ImageGenerationJob.where({ id: input.jobId }).update({
      status: "SUCCEEDED",
      progressPct: 100,
      providerJobId: input.providerJobId,
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
    await this.orm.ImageGenerationJob.where({ id: input.jobId }).update({
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
    await this.orm.ImageGenerationJob.where({ id: input.jobId }).update({
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
    const update = db.sql.public.image_generation_job;
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

  async findCancelRequested(): Promise<ImageGenerationJobRecord[]> {
    const rows = (await this.orm.ImageGenerationJob.where({
      status: "CANCEL_REQUESTED",
    }).all()) as unknown as JobRow[];

    return rows.map(decodeJob);
  }

  async createAsset(
    input: CreateGeneratedImageAssetInput,
  ): Promise<GeneratedImageAssetRecord> {
    const row = (await this.orm.GeneratedImageAsset.create({
      id: input.id,
      projectId: input.projectId,
      generationJobId: input.generationJobId,
      graphicDocumentId: input.graphicDocumentId,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      outputFormat: input.outputFormat,
      width: input.width,
      height: input.height,
      byteSize: input.byteSize,
      checksumSha256: input.checksumSha256,
      transparent: input.transparent,
      metadata: input.metadata,
      createdAt: input.createdAt,
    })) as unknown as AssetRow;

    return decodeAsset(row);
  }

  async getAsset(
    projectId: string,
    assetId: string,
  ): Promise<GeneratedImageAssetRecord | null> {
    const row = (await this.orm.GeneratedImageAsset.where({
      id: assetId,
      projectId,
      deletedAt: null,
    }).first()) as unknown as AssetRow | null;

    return row ? decodeAsset(row) : null;
  }

  async listAssets(
    projectId: string,
    filter: ListGeneratedImageAssetsFilter = {},
  ): Promise<GeneratedImageAssetRecord[]> {
    const rows = (await this.orm.GeneratedImageAsset.where({
      projectId,
      deletedAt: null,
      ...(filter.generationJobId
        ? { generationJobId: filter.generationJobId }
        : {}),
      ...(filter.graphicDocumentId
        ? { graphicDocumentId: filter.graphicDocumentId }
        : {}),
    })
      .orderBy((a) => a.createdAt.desc())
      .limit(filter.limit ?? 50)
      .all()) as unknown as AssetRow[];

    return rows.map(decodeAsset);
  }

  async getAssetByJob(
    jobId: string,
  ): Promise<GeneratedImageAssetRecord | null> {
    const row = (await this.orm.GeneratedImageAsset.where({
      generationJobId: jobId,
      deletedAt: null,
    }).first()) as unknown as AssetRow | null;

    return row ? decodeAsset(row) : null;
  }

  async softDeleteAsset(
    projectId: string,
    assetId: string,
    deletedAt: string,
  ): Promise<void> {
    await this.orm.GeneratedImageAsset.where({ id: assetId, projectId }).update({
      deletedAt,
    });
  }

  private async getJobById(
    jobId: string,
  ): Promise<ImageGenerationJobRecord | null> {
    const row = (await this.orm.ImageGenerationJob.where({
      id: jobId,
    }).first()) as unknown as JobRow | null;

    return row ? decodeJob(row) : null;
  }
}
