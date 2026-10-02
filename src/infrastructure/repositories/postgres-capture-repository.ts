import type { PublicOrm } from "../../prisma/db";
import { db } from "../../prisma/db";
import type { Models } from "../../prisma/contract.d";
import type {
  CaptureRepository,
  CreateCaptureTakeInput,
  UpdateCaptureTakeInput,
} from "../../core/ports/capture-repository";
import type {
  CaptureMode,
  CaptureSessionRecord,
  CaptureSessionStatus,
  CaptureTakeRecord,
  CaptureTakeStatus,
} from "../../modules/capture-engine/capture-types";

type SessionRow = Omit<Models.public_CaptureSession, "project" | "takes">;
type TakeRow = Omit<Models.public_CaptureTake, "session">;

function decodeSession(row: SessionRow): CaptureSessionRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    createdById: row.createdById,
    storyboardId: row.storyboardId ?? null,
    status: row.status as CaptureSessionStatus,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    startedAt: row.startedAt ? new Date(row.startedAt).toISOString() : null,
    completedAt: row.completedAt
      ? new Date(row.completedAt).toISOString()
      : null,
  };
}

function decodeTake(row: TakeRow): CaptureTakeRecord {
  let metadata: Record<string, unknown> | null = null;

  if (row.metadata) {
    try {
      const parsed: unknown = JSON.parse(row.metadata);
      if (typeof parsed === "object" && parsed !== null) {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      // Metadata is advisory. A row whose JSON cannot be read is still a real
      // capture with real bytes, so it decodes with the metadata dropped rather
      // than failing the whole read.
      metadata = null;
    }
  }

  return {
    id: row.id,
    sessionId: row.sessionId,
    projectId: row.projectId,
    shotId: row.shotId ?? null,
    mode: row.mode as CaptureMode,
    status: row.status as CaptureTakeStatus,
    storageKey: row.storageKey,
    originalName: row.originalName ?? null,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    width: row.width ?? null,
    height: row.height ?? null,
    durationMs: row.durationMs ?? null,
    frameRate: row.frameRate ?? null,
    metadata,
    createdAt: new Date(row.createdAt).toISOString(),
    acceptedAt: row.acceptedAt ? new Date(row.acceptedAt).toISOString() : null,
    rejectedAt: row.rejectedAt ? new Date(row.rejectedAt).toISOString() : null,
    deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
  };
}

export class PostgresCaptureRepository implements CaptureRepository {
  private readonly orm: PublicOrm;

  constructor(orm: PublicOrm = db.orm.public) {
    this.orm = orm;
  }

  async createSession(input: {
    id: string;
    projectId: string;
    createdById: string;
    storyboardId: string | null;
    createdAt: string;
    updatedAt: string;
  }): Promise<CaptureSessionRecord> {
    const row = await this.orm.CaptureSession.create({
      id: input.id,
      projectId: input.projectId,
      createdById: input.createdById,
      storyboardId: input.storyboardId,
      status: "DRAFT",
      startedAt: null,
      completedAt: null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });

    return decodeSession(row as unknown as SessionRow);
  }

  async getSession(
    projectId: string,
    sessionId: string,
  ): Promise<CaptureSessionRecord | null> {
    const row = await this.orm.CaptureSession.where({
      id: sessionId,
      projectId,
    }).first();

    return row ? decodeSession(row as unknown as SessionRow) : null;
  }

  async updateSession(
    projectId: string,
    sessionId: string,
    changes: {
      status?: CaptureSessionStatus;
      startedAt?: string | null;
      completedAt?: string | null;
      updatedAt: string;
    },
  ): Promise<CaptureSessionRecord> {
    const row = await this.orm.CaptureSession.where({
      id: sessionId,
      projectId,
    }).update({
      ...(changes.status !== undefined ? { status: changes.status } : {}),
      ...(changes.startedAt !== undefined
        ? { startedAt: changes.startedAt }
        : {}),
      ...(changes.completedAt !== undefined
        ? { completedAt: changes.completedAt }
        : {}),
      updatedAt: changes.updatedAt,
    });

    return decodeSession(row as unknown as SessionRow);
  }

  async listSessionsByProject(
    projectId: string,
  ): Promise<CaptureSessionRecord[]> {
    const rows = (await this.orm.CaptureSession.where({
      projectId,
    }).all()) as unknown as SessionRow[];

    return rows.map((row) => decodeSession(row));
  }

  async createTake(input: CreateCaptureTakeInput): Promise<CaptureTakeRecord> {
    const row = await this.orm.CaptureTake.create({
      id: input.id,
      sessionId: input.sessionId,
      projectId: input.projectId,
      shotId: input.shotId,
      mode: input.mode,
      status: input.status,
      storageKey: input.storageKey,
      originalName: input.originalName,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      checksumSha256: input.checksumSha256,
      width: input.width,
      height: input.height,
      durationMs: input.durationMs,
      frameRate: input.frameRate,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: input.createdAt,
      acceptedAt: input.acceptedAt ?? null,
      rejectedAt: input.rejectedAt ?? null,
      deletedAt: input.deletedAt ?? null,
    });

    return decodeTake(row as unknown as TakeRow);
  }

  async getTake(
    projectId: string,
    takeId: string,
  ): Promise<CaptureTakeRecord | null> {
    const row = await this.orm.CaptureTake.where({
      id: takeId,
      projectId,
    }).first();

    return row ? decodeTake(row as unknown as TakeRow) : null;
  }

  async getTakeForSession(
    projectId: string,
    sessionId: string,
    takeId: string,
  ): Promise<CaptureTakeRecord | null> {
    const row = await this.orm.CaptureTake.where({
      id: takeId,
      projectId,
      sessionId,
    }).first();

    return row ? decodeTake(row as unknown as TakeRow) : null;
  }

  async updateTake(
    projectId: string,
    takeId: string,
    changes: UpdateCaptureTakeInput,
  ): Promise<CaptureTakeRecord> {
    const row = await this.orm.CaptureTake.where({
      id: takeId,
      projectId,
    }).update({
      ...(changes.mode !== undefined ? { mode: changes.mode } : {}),
      ...(changes.status !== undefined ? { status: changes.status } : {}),
      ...(changes.shotId !== undefined ? { shotId: changes.shotId } : {}),
      ...(changes.storageKey !== undefined
        ? { storageKey: changes.storageKey }
        : {}),
      ...(changes.originalName !== undefined
        ? { originalName: changes.originalName }
        : {}),
      ...(changes.mimeType !== undefined ? { mimeType: changes.mimeType } : {}),
      ...(changes.byteSize !== undefined ? { byteSize: changes.byteSize } : {}),
      ...(changes.checksumSha256 !== undefined
        ? { checksumSha256: changes.checksumSha256 }
        : {}),
      ...(changes.width !== undefined ? { width: changes.width } : {}),
      ...(changes.height !== undefined ? { height: changes.height } : {}),
      ...(changes.durationMs !== undefined
        ? { durationMs: changes.durationMs }
        : {}),
      ...(changes.frameRate !== undefined
        ? { frameRate: changes.frameRate }
        : {}),
      ...(changes.metadata !== undefined
        ? { metadata: changes.metadata ? JSON.stringify(changes.metadata) : null }
        : {}),
      ...(changes.acceptedAt !== undefined
        ? { acceptedAt: changes.acceptedAt }
        : {}),
      ...(changes.rejectedAt !== undefined
        ? { rejectedAt: changes.rejectedAt }
        : {}),
      ...(changes.deletedAt !== undefined
        ? { deletedAt: changes.deletedAt }
        : {}),
    });

    return decodeTake(row as unknown as TakeRow);
  }

  async listTakesBySession(
    projectId: string,
    sessionId: string,
  ): Promise<CaptureTakeRecord[]> {
    const rows = (await this.orm.CaptureTake.where({
      projectId,
      sessionId,
    }).all()) as unknown as TakeRow[];

    return rows
      .map((row) => decodeTake(row))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listTakesByProject(projectId: string): Promise<CaptureTakeRecord[]> {
    const rows = (await this.orm.CaptureTake.where({
      projectId,
    }).all()) as unknown as TakeRow[];

    return rows.map((row) => decodeTake(row));
  }

  async countAcceptedTakes(
    projectId: string,
    sessionId: string,
  ): Promise<number> {
    const rows = await this.orm.CaptureTake.where({
      projectId,
      sessionId,
      status: "ACCEPTED",
    }).all();

    return rows.length;
  }

  async deleteTake(projectId: string, takeId: string): Promise<void> {
    await this.orm.CaptureTake.where({ id: takeId, projectId }).delete();
  }
}
