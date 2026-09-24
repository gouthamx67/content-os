import type { PublicOrm } from "../../prisma/db";
import type { Source } from "../../core/domain/source";
import type {
  CreateSourceInput,
  SourceRepository,
} from "../../core/ports/source-repository";
import { pgTimestampToIso } from "../../lib/time";

function mapSource(row: {
  id: string;
  projectId: string;
  type: Source["type"];
  name: string;
  uri: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}): Source {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    name: row.name,
    uri: row.uri,
    metadata: row.metadata,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

export class PostgresSourceRepository
  implements SourceRepository
{
  constructor(private readonly orm: PublicOrm) {}

  async create(input: CreateSourceInput): Promise<Source> {
    const row = await this.orm.Source.create({
      id: input.id,
      projectId: input.projectId,
      type: input.type,
      name: input.name,
      uri: input.uri ?? null,
      metadata: input.metadata ?? null,
    });

    return mapSource(row);
  }

  async getById(id: string): Promise<Source | null> {
    const row = await this.orm.Source.first({ id });

    if (!row) {
      return null;
    }

    return mapSource(row);
  }

  async listByProject(projectId: string): Promise<Source[]> {
    const rows = await this.orm.Source.where(
      (source) => source.projectId.eq(projectId),
    )
      .orderBy((source) => source.createdAt.desc())
      .all();

    return rows.map(mapSource);
  }

  async deleteById(id: string): Promise<void> {
    await this.orm.Source.where({ id }).delete();
  }
}