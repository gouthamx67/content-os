import { db } from "../../prisma/db";
import type { PublicOrm } from "../../prisma/db";
import { pgTimestampToIso } from "../../lib/time";
import type {
  AdaptSucceededOutput,
  AdaptationRepository,
  CreateAdaptationBatchInput,
  CreateAdaptationJobInput,
  CreateAdaptationPlan,
  ListAdaptationBatchesFilter,
} from "../../core/ports/adaptation-repository";
import type {
  AdaptationBatchRecord,
  AdaptationBatchStatus,
  AdaptationJobRecord,
  AdaptationJobStatus,
  AdaptationKind,
  AdaptationSourceType,
} from "../../modules/multiformat-engine/domain/types";
import {
  deriveBatchFinishedAt,
  deriveBatchProgress,
  deriveBatchStatus,
} from "../../modules/multiformat-engine/progress";

type BatchRow = {
  id: string;
  projectId: string;
  requestedById: string;
  sourceType: string;
  sourceId: string;
  sourceSnapshot: string;
  sourceSha256: string;
  targetCount: number;
  status: string;
  progressPct: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type JobRow = {
  id: string;
  batchId: string;
  projectId: string;
  requestedById: string;
  platformId: string;
  formatId: string;
  kind: string;
  recipe: string;
  recipeSha256: string;
  status: string;
  progressPct: number;
  outputText: string | null;
  outputMimeType: string | null;
  outputStorageKey: string | null;
  outputByteSize: number | null;
  outputChecksumSha256: string | null;
  outputWidth: number | null;
  outputHeight: number | null;
  renderJobId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

function decodeBatch(row: BatchRow): AdaptationBatchRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    requestedById: row.requestedById,
    sourceType: row.sourceType as AdaptationSourceType,
    sourceId: row.sourceId,
    sourceSnapshot: row.sourceSnapshot,
    sourceSha256: row.sourceSha256,
    targetCount: row.targetCount,
    status: row.status as AdaptationBatchStatus,
    progressPct: row.progressPct,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
    finishedAt: row.finishedAt ? pgTimestampToIso(row.finishedAt) : null,
  };
}

function decodeJob(row: JobRow): AdaptationJobRecord {
  return {
    id: row.id,
    batchId: row.batchId,
    projectId: row.projectId,
    requestedById: row.requestedById,
    platformId: row.platformId,
    formatId: row.formatId,
    kind: row.kind as AdaptationKind,
    recipe: row.recipe,
    recipeSha256: row.recipeSha256,
    status: row.status as AdaptationJobStatus,
    progressPct: row.progressPct,
    outputText: row.outputText,
    outputMimeType: row.outputMimeType,
    outputStorageKey: row.outputStorageKey,
    outputByteSize: row.outputByteSize,
    outputChecksumSha256: row.outputChecksumSha256,
    outputWidth: row.outputWidth,
    outputHeight: row.outputHeight,
    renderJobId: row.renderJobId,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: pgTimestampToIso(row.createdAt),
    startedAt: row.startedAt ? pgTimestampToIso(row.startedAt) : null,
    finishedAt: row.finishedAt ? pgTimestampToIso(row.finishedAt) : null,
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function batchValues(input: CreateAdaptationBatchInput) {
  return {
    id: input.id,
    projectId: input.projectId,
    requestedById: input.requestedById,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceSnapshot: input.sourceSnapshot,
    sourceSha256: input.sourceSha256,
    targetCount: input.targetCount,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function jobValues(input: CreateAdaptationJobInput) {
  return {
    id: input.id,
    batchId: input.batchId,
    projectId: input.projectId,
    requestedById: input.requestedById,
    platformId: input.platformId,
    formatId: input.formatId,
    kind: input.kind,
    recipe: input.recipe,
    recipeSha256: input.recipeSha256,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

/**
 * The batch is written with its jobs or not at all.
 *
 * `targetCount` is the number of jobs the caller intends, and the UI reads it to
 * know how long to wait; a batch that saved first and queued jobs second could
 * report four targets with one job and wait forever for the rest.
 */
export class PostgresAdaptationRepository implements AdaptationRepository {
  private readonly orm: PublicOrm;

  constructor(orm: PublicOrm = db.orm.public) {
    this.orm = orm;
  }

  async createBatchWithJobs(
    plan: CreateAdaptationPlan,
  ): Promise<AdaptationBatchRecord> {
    let batchId: string | null = null;

    await db.transaction(async (tx) => {
      const row = (await tx.orm.public.AdaptationBatch.create(
        batchValues(plan.batch),
      )) as unknown as BatchRow;

      for (const job of plan.jobs) {
        await tx.orm.public.AdaptationJob.create(jobValues(job));
      }

      batchId = row.id;
    });

    const created = batchId
      ? await this.getBatch(plan.batch.projectId, batchId)
      : null;

    if (!created) {
      throw new Error("Adaptation batch vanished during creation");
    }

    return created;
  }

  async getBatch(
    projectId: string,
    batchId: string,
  ): Promise<AdaptationBatchRecord | null> {
    const row = (await this.orm.AdaptationBatch.where({
      id: batchId,
      projectId,
    }).first()) as unknown as BatchRow | null;

    return row ? decodeBatch(row) : null;
  }

  async listBatches(
    projectId: string,
    filter: ListAdaptationBatchesFilter = {},
  ): Promise<AdaptationBatchRecord[]> {
    const rows = (await this.orm.AdaptationBatch.where({
      projectId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.sourceId ? { sourceId: filter.sourceId } : {}),
    })
      .orderBy((batch) => batch.createdAt.desc())
      .limit(filter.limit ?? 20)
      .all()) as unknown as BatchRow[];

    return rows.map(decodeBatch);
  }

  async listJobs(batchId: string): Promise<AdaptationJobRecord[]> {
    const rows = (await this.orm.AdaptationJob.where({ batchId })
      .orderBy((job) => job.createdAt.asc())
      .all()) as unknown as JobRow[];

    return rows.map(decodeJob);
  }

  async listJobsByProject(
    projectId: string,
    filter: { status?: AdaptationJobStatus; limit?: number } = {},
  ): Promise<AdaptationJobRecord[]> {
    const rows = (await this.orm.AdaptationJob.where({
      projectId,
      ...(filter.status ? { status: filter.status } : {}),
    })
      .orderBy((job) => job.createdAt.desc())
      .limit(filter.limit ?? 50)
      .all()) as unknown as JobRow[];

    return rows.map(decodeJob);
  }

  async getJob(
    projectId: string,
    jobId: string,
  ): Promise<AdaptationJobRecord | null> {
    const row = (await this.orm.AdaptationJob.where({
      id: jobId,
      projectId,
    }).first()) as unknown as JobRow | null;

    return row ? decodeJob(row) : null;
  }

  async claimNext(): Promise<AdaptationJobRecord | null> {
    const now = new Date().toISOString();
    let claimedId: string | null = null;

    await db.transaction(async (tx) => {
      const candidate = (await tx.orm.public.AdaptationJob.where({
        status: "QUEUED",
      })
        .orderBy((job) => job.createdAt.asc())
        .first()) as unknown as JobRow | null;

      if (!candidate) return;

      const plan = tx.sql.public.adaptation_job
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
    await this.orm.AdaptationJob.where({ id: jobId }).update({
      progressPct: Math.max(0, Math.min(100, Math.round(progressPct))),
      updatedAt,
    });
  }

  async markRunning(input: {
    jobId: string;
    startedAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.AdaptationJob.where({ id: input.jobId }).update({
      status: "RUNNING",
      startedAt: input.startedAt,
      updatedAt: input.updatedAt,
    });
  }

  async markWaitingRender(input: {
    jobId: string;
    renderJobId: string;
    progressPct: number;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.AdaptationJob.where({ id: input.jobId }).update({
      status: "WAITING_RENDER",
      renderJobId: input.renderJobId,
      progressPct: Math.max(
        0,
        Math.min(99, Math.round(input.progressPct)),
      ),
      updatedAt: input.updatedAt,
    });
  }

  async markSucceeded(input: {
    jobId: string;
    output: AdaptSucceededOutput;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void> {
    const output = input.output;

    await this.orm.AdaptationJob.where({ id: input.jobId }).update({
      status: "SUCCEEDED",
      progressPct: 100,
      outputText: output.outputText ?? null,
      outputMimeType: output.outputMimeType ?? null,
      outputStorageKey: output.outputStorageKey ?? null,
      outputByteSize: output.outputByteSize ?? null,
      outputChecksumSha256: output.outputChecksumSha256 ?? null,
      outputWidth: output.outputWidth ?? null,
      outputHeight: output.outputHeight ?? null,
      renderJobId: output.renderJobId ?? null,
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
    await this.orm.AdaptationJob.where({ id: input.jobId }).update({
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
    await this.orm.AdaptationJob.where({ id: input.jobId }).update({
      status: "CANCELLED",
      finishedAt: input.finishedAt,
      updatedAt: input.updatedAt,
    });
  }

  async requestCancelBatch(input: {
    projectId: string;
    batchId: string;
    finishedAt: string;
  }): Promise<AdaptationBatchRecord | null> {
    const batch = await this.getBatch(input.projectId, input.batchId);
    if (!batch) return null;
    if (
      batch.status === "SUCCEEDED" ||
      batch.status === "PARTIAL" ||
      batch.status === "FAILED" ||
      batch.status === "CANCELLED"
    ) {
      return null;
    }

    await db.transaction(async (tx) => {
      // Queued work is finished here and now; nothing has started, so there is
      // nothing to unwind.
      await tx.sql.public.adaptation_job
        .update({
          status: "CANCELLED",
          finishedAt: input.finishedAt,
          updatedAt: input.finishedAt,
        })
        .where((f, fns) => fns.eq(f.batchId, batch.id))
        .where((f, fns) => fns.eq(f.status, "QUEUED"))
        .build();

      // Running work, and work parked on a render, is asked to stop and then
      // finalise its own row.
      for (const status of ["RUNNING", "WAITING_RENDER"]) {
        await tx.sql.public.adaptation_job
          .update({
            status: "CANCEL_REQUESTED",
            updatedAt: input.finishedAt,
          })
          .where((f, fns) => fns.eq(f.batchId, batch.id))
          .where((f, fns) => fns.eq(f.status, status))
          .build();
      }
    });

    await this.refreshBatchStatus({
      batchId: batch.id,
      updatedAt: input.finishedAt,
    });

    return this.getBatch(input.projectId, batch.id);
  }

  async requestCancelJob(input: {
    projectId: string;
    jobId: string;
    finishedAt: string;
  }): Promise<boolean> {
    const job = await this.getJob(input.projectId, input.jobId);
    if (!job) return false;

    if (job.status === "QUEUED") {
      const queued = db.sql.public.adaptation_job
        .update({
          status: "CANCELLED",
          finishedAt: input.finishedAt,
          updatedAt: input.finishedAt,
        })
        .where((f, fns) => fns.eq(f.id, input.jobId))
        .where((f, fns) => fns.eq(f.status, "QUEUED"))
        .returning("id")
        .build();

      const rows = await db.runtime().query(queued);
      return rows.length === 1;
    }

    if (job.status === "RUNNING" || job.status === "WAITING_RENDER") {
      const running = db.sql.public.adaptation_job
        .update({
          status: "CANCEL_REQUESTED",
          updatedAt: input.finishedAt,
        })
        .where((f, fns) => fns.eq(f.id, input.jobId))
        .where((f, fns) => fns.eq(f.status, job.status))
        .returning("id")
        .build();

      const rows = await db.runtime().query(running);
      return rows.length === 1;
    }

    return false;
  }

  async findCancelRequestedJobs(): Promise<AdaptationJobRecord[]> {
    const rows = (await this.orm.AdaptationJob.where({
      status: "CANCEL_REQUESTED",
    }).all()) as unknown as JobRow[];

    return rows.map(decodeJob);
  }

  async findWaitingRenderJobs(): Promise<AdaptationJobRecord[]> {
    const rows = (await this.orm.AdaptationJob.where({
      status: "WAITING_RENDER",
    }).all()) as unknown as JobRow[];

    return rows.map(decodeJob);
  }

  async refreshBatchStatus(input: {
    batchId: string;
    updatedAt: string;
  }): Promise<AdaptationBatchRecord | null> {
    const jobs = await this.listJobs(input.batchId);
    if (jobs.length === 0) return null;

    const status = deriveBatchStatus(jobs);
    const progressPct = deriveBatchProgress(jobs);
    const finishedAt = deriveBatchFinishedAt(jobs);

    const row = (await this.orm.AdaptationBatch.where({
      id: input.batchId,
    }).update({
      status,
      progressPct,
      finishedAt,
      updatedAt: input.updatedAt,
    })) as unknown as BatchRow | null;

    return row ? decodeBatch(row) : null;
  }

  async findStaleQueuedJobs(
    olderThanIso: string,
  ): Promise<AdaptationJobRecord[]> {
    const queued = (await this.orm.AdaptationJob.where({
      status: "QUEUED",
    }).all()) as unknown as JobRow[];

    const cutoff = new Date(olderThanIso).getTime();
    return queued
      .filter(
        (row) => new Date(pgTimestampToIso(row.createdAt)).getTime() < cutoff,
      )
      .map(decodeJob);
  }

  private async getJobById(
    jobId: string,
  ): Promise<AdaptationJobRecord | null> {
    const row = (await this.orm.AdaptationJob.where({ id: jobId })
      .first()) as unknown as JobRow | null;

return row ? decodeJob(row) : null;
  }
}