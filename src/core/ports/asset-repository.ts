import type { Asset } from "../domain/asset";

export type CreateAssetInput = {
  id: string;
  projectId: string;
  type: Asset["type"];
  name: string;
  uri: string;
  metadata?: string | null;
};

export interface AssetRepository {
  create(input: CreateAssetInput): Promise<Asset>;

  getById(id: string): Promise<Asset | null>;

  listByProject(projectId: string): Promise<Asset[]>;

  deleteById(id: string): Promise<void>;
}