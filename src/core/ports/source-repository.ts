import type { Source } from "../domain/source";

export type CreateSourceInput = {
  id: string;
  projectId: string;
  type: Source["type"];
  name: string;
  uri?: string | null;
  metadata?: string | null;
};

export interface SourceRepository {
  create(input: CreateSourceInput): Promise<Source>;

  getById(id: string): Promise<Source | null>;

  listByProject(projectId: string): Promise<Source[]>;

  deleteById(id: string): Promise<void>;
}