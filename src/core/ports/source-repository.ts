import type { Source } from "../domain/source";

export type CreateSourceInput = {
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
};

export type UpdateSourceInput = Partial<
  Pick<
    Source,
    | "name"
    | "uri"
    | "metadata"
    | "status"
    | "mimeType"
    | "sizeBytes"
    | "contentHash"
    | "storageKey"
    | "errorCode"
    | "errorMessage"
  >
>;

export interface SourceRepository {
  create(input: CreateSourceInput): Promise<Source>;

  update(id: string, changes: UpdateSourceInput): Promise<Source | null>;

  getById(id: string): Promise<Source | null>;

  listByProject(projectId: string): Promise<Source[]>;

  deleteById(id: string): Promise<void>;

  findByContentHash(projectId: string, contentHash: string): Promise<Source | null>;

  countByStorageKey(storageKey: string): Promise<number>;
}
