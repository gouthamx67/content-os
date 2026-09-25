import type { PublicOrm } from "../../prisma/db";
import type { Source } from "../../core/domain/source";
import type {
  CreateSourceInput,
  SourceRepository,
  UpdateSourceInput,
} from "../../core/ports/source-repository";
import { pgTimestampToIso } from "../../lib/time";

type SourceRow = {
  id: string;
  projectId: string;
  type: Source["type"];
  name: string;
  uri: string | null;
  metadata: string | null;
  status: Source["status"];
  mimeType: string | null;
  sizeBytes: number | null;
  contentHash: string | null;
  storageKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapSource(row: SourceRow): Source {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    name: row.name,
    uri: row.uri,
    metadata: row.metadata,
    status: row.status,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    contentHash: row.contentHash,
    storageKey: row.storageKey,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

export class PostgresSourceRepository implements SourceRepository {
  constructor(private readonly orm: PublicOrm) {}

  async create(input: CreateSourceInput): Promise<Source> {
    const row = await this.orm.Source.create({
      id: input.id,
      projectId: input.projectId,
      type: input.type,
      name: input.name,
      uri: input.uri,
      metadata: input.metadata,
      status: input.status,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
      storageKey: input.storageKey,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    });
    return mapSource(row);
  }

  async update(id: string, changes: UpdateSourceInput): Promise<Source | null> {
    const row = await this.orm.Source.where({ id }).update(changes);
    return row ? mapSource(row) : null;
  }

  async getById(id: string): Promise<Source | null> {
    const row = await this.orm.Source.first({ id });
    return row ? mapSource(row) : null;
  }

  async listByProject(projectId: string): Promise<Source[]> {
    const rows = await this.orm.Source.where((source) => source.projectId.eq(projectId))
      .orderBy((source) => source.createdAt.desc())
      .all();
    return rows.map(mapSource);
  }

  async deleteById(id: string): Promise<void> {
    await this.orm.Source.where({ id }).delete();
  }

  async findByContentHash(projectId: string, contentHash: string): Promise<Source | null> {
    const row = await this.orm.Source.where((source) => source.projectId.eq(projectId))
      .where((source) => source.contentHash.eq(contentHash))
      .where((source) => source.status.eq("READY"))
      .first();
    return row ? mapSource(row) : null;
  }

  async countByStorageKey(storageKey: string): Promise<number> {
    const result = await this.orm.Source.where((source) => source.storageKey.eq(storageKey)).aggregate(
      (aggregate) => ({ count: aggregate.count() }),
    );
    return result.count;
  }
}
