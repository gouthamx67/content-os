import type { PublicOrm } from "../../prisma/db";
import { db } from "../../prisma/db";
import type { Models } from "../../prisma/contract.d";
import { pgTimestampToIso } from "../../lib/time";
import type {
  CreateRenderArtifactInput,
  CreateRenderJobInput,
  ListRenderJobsFilter,
  RenderJobRepository,
} from "../../core/ports/render-job-repository";
import type {
  RenderArtifactRecord,
  RenderJobRecord,
} from "../../modules/video-rendering/domain/types";

type JobRow = Omit<Models.public_RenderJob, "project" | "composition" | "artifact">;
type ArtifactRow = Omit<Models.public_RenderArtifact, "renderJob" | "project">;

function decodeJob(row: JobRow): RenderJobRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    compositionId: row.compositionId,
    requestedById: row.requestedById,
    status: row.status,
    outputFormat: row.outputFormat,
    contractVersion: row.contractVersion,
    sceneGraph: row.sceneGraph,
    sceneSha256: row.sceneSha256,
    progressPct: row.progressPct,
    width: row.width,
    height: row.height,
    frameRate: row.frameRate,
    durationMs: row.durationMs,
    ffmpegVersion: row.ffmpegVersion ?? null,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    createdAt: pgTimestampToIso(row.createdAt),
    startedAt: row.startedAt ? pgTimestampToIso(row.startedAt) : null,
    finishedAt: row.finishedAt ? pgTimestampToIso(row.finishedAt) : null,
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function decodeArtifact(row: ArtifactRow): RenderArtifactRecord {
  return {
    id: row.id,
    renderJobId: row.renderJobId,
    projectId: row.projectId,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

export class PostgresRenderJobRepository implements RenderJobRepository {
  private readonly orm: PublicOrm;

  constructor(orm: PublicOrm = db.orm.public) {
    this.orm = orm;
  }

  async create(input: CreateRenderJobInput): Promise<RenderJobRecord> {
    const row = (await this.orm.RenderJob.create({
      id: input.id,
      projectId: input.projectId,
      compositionId: input.compositionId,
      requestedById: input.requestedById,
      status: "QUEUED",
      outputFormat: input.outputFormat,
      contractVersion: input.contractVersion,
      sceneGraph: input.sceneGraph,
      sceneSha256: input.sceneSha256,
      progressPct: 0,
      width: input.width,
      height: input.height,
      frameRate: input.frameRate,
      durationMs: input.durationMs,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })) as unknown as JobRow;

    return decodeJob(row);
  }

  async get(
    projectId: string,
    renderJobId: string,
  ): Promise<RenderJobRecord | null> {
    const row = (await this.orm.RenderJob.where({
      id: renderJobId,
      projectId,
    }).first()) as unknown as JobRow | null;

    return row ? decodeJob(row) : null;
  }

  async list(
    projectId: string,
    filter: ListRenderJobsFilter = {},
  ): Promise<RenderJobRecord[]> {
    const rows = (await this.orm.RenderJob.where({
      projectId,
      ...(filter.compositionId ? { compositionId: filter.compositionId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    })
      .orderBy((r) => r.createdAt.desc())
      .limit(filter.limit ?? 50)
      .all()) as unknown as JobRow[];

    return rows.map(decodeJob);
  }

  async claimNext(): Promise<RenderJobRecord | null> {
    const now = new Date().toISOString();
    let claimedId: string | null = null;

    await db.transaction(async (tx) => {
      const candidate = (await tx.orm.public.RenderJob.where({
        status: "QUEUED",
      })
        .orderBy((r) => r.createdAt.asc())
        .first()) as unknown as JobRow | null;

      if (!candidate) return;

      const plan = tx.sql.public.render_job
        .update({ status: "RUNNING", progressPct: 0, startedAt: now, updatedAt: now })
        .where((f, fns) => fns.eq(f.id, candidate.id))
        .where((f, fns) => fns.eq(f.status, "QUEUED"))
        .returning("id")
        .build();

      const rows = await tx.query(plan);
      if (rows.length === 1) claimedId = candidate.id;
    });

    if (!claimedId) return null;
    return this.getById(claimedId);
  }

  async updateProgress(
    renderJobId: string,
    progressPct: number,
    updatedAt: string,
  ): Promise<void> {
    await this.orm.RenderJob.where({ id: renderJobId }).update({
      progressPct: Math.max(0, Math.min(100, Math.round(progressPct))),
      updatedAt,
    });
  }

  async markRunning(input: {
    renderJobId: string;
    ffmpegVersion: string | null;
    startedAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.RenderJob.where({ id: input.renderJobId }).update({
      status: "RUNNING",
      ffmpegVersion: input.ffmpegVersion,
      startedAt: input.startedAt,
      updatedAt: input.updatedAt,
    });
  }

  async markSucceeded(input: {
    renderJobId: string;
    ffmpegVersion: string | null;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.RenderJob.where({ id: input.renderJobId }).update({
      status: "SUCCEEDED",
      progressPct: 100,
      ffmpegVersion: input.ffmpegVersion,
      finishedAt: input.finishedAt,
      updatedAt: input.updatedAt,
    });
  }

  async markFailed(input: {
    renderJobId: string;
    errorCode: string;
    errorMessage: string;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.RenderJob.where({ id: input.renderJobId }).update({
      status: "FAILED",
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      finishedAt: input.finishedAt,
      updatedAt: input.updatedAt,
    });
  }

  async markCancelled(input: {
    renderJobId: string;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.RenderJob.where({ id: input.renderJobId }).update({
      status: "CANCELLED",
      finishedAt: input.finishedAt,
      updatedAt: input.updatedAt,
    });
  }

  async requestCancel(projectId: string, renderJobId: string): Promise<boolean> {
    const job = await this.get(projectId, renderJobId);
    if (!job) return false;
    if (job.status !== "QUEUED" && job.status !== "RUNNING") return false;

    const now = new Date().toISOString();
    const update = db.sql.public.render_job;
    const builder =
      job.status === "QUEUED"
        ? update
            .update({ status: "CANCELLED", finishedAt: now, updatedAt: now })
            .where((f, fns) => fns.eq(f.id, renderJobId))
            .where((f, fns) => fns.eq(f.status, "QUEUED"))
        : update
            .update({ status: "CANCEL_REQUESTED", updatedAt: now })
            .where((f, fns) => fns.eq(f.id, renderJobId))
            .where((f, fns) => fns.eq(f.status, "RUNNING"));

    const plan = builder.returning("id").build();

    const rows = await db.runtime().query(plan);
    return rows.length === 1;
  }

  async findCancelRequested(): Promise<RenderJobRecord[]> {
    const rows = (await this.orm.RenderJob.where({
      status: "CANCEL_REQUESTED",
    }).all()) as unknown as JobRow[];

    return rows.map(decodeJob);
  }

  async createArtifact(
    input: CreateRenderArtifactInput,
  ): Promise<RenderArtifactRecord> {
    const row = (await this.orm.RenderArtifact.create({
      id: input.id,
      renderJobId: input.renderJobId,
      projectId: input.projectId,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      checksumSha256: input.checksumSha256,
      createdAt: input.createdAt,
    })) as unknown as ArtifactRow;

    return decodeArtifact(row);
  }

  async getArtifactByJob(
    renderJobId: string,
  ): Promise<RenderArtifactRecord | null> {
    const row = (await this.orm.RenderArtifact.where({
      renderJobId,
    }).first()) as unknown as ArtifactRow | null;

    return row ? decodeArtifact(row) : null;
  }

  async getArtifact(
    projectId: string,
    artifactId: string,
  ): Promise<RenderArtifactRecord | null> {
    const row = (await this.orm.RenderArtifact.where({
      id: artifactId,
      projectId,
    }).first()) as unknown as ArtifactRow | null;

    return row ? decodeArtifact(row) : null;
  }

  private async getById(renderJobId: string): Promise<RenderJobRecord | null> {
    const row = (await this.orm.RenderJob.where({
      id: renderJobId,
    }).first()) as unknown as JobRow | null;

    return row ? decodeJob(row) : null;
  }
}
