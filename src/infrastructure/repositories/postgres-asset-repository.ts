import type { PublicOrm } from "../../prisma/db";
import type { Asset } from "../../core/domain/asset";
import type {
  AssetRepository,
  CreateAssetInput,
} from "../../core/ports/asset-repository";
import { pgTimestampToIso } from "../../lib/time";

function mapAsset(row: {
  id: string;
  projectId: string;
  type: Asset["type"];
  name: string;
  uri: string;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}): Asset {
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

export class PostgresAssetRepository
  implements AssetRepository
{
  constructor(private readonly orm: PublicOrm) {}

  async create(input: CreateAssetInput): Promise<Asset> {
    const row = await this.orm.Asset.create({
      id: input.id,
      projectId: input.projectId,
      type: input.type,
      name: input.name,
      uri: input.uri,
      metadata: input.metadata ?? null,
    });

    return mapAsset(row);
  }

  async getById(id: string): Promise<Asset | null> {
    const row = await this.orm.Asset.first({ id });

    if (!row) {
      return null;
    }

    return mapAsset(row);
  }

  async listByProject(projectId: string): Promise<Asset[]> {
    const rows = await this.orm.Asset.where(
      (asset) => asset.projectId.eq(projectId),
    )
      .orderBy((asset) => asset.createdAt.desc())
      .all();

    return rows.map(mapAsset);
  }

  async deleteById(id: string): Promise<void> {
    await this.orm.Asset.where({ id }).delete();
  }
}