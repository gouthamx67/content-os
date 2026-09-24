import type { Project } from "../domain";

export interface ProjectRepository {
  create(project: Project): Promise<Project>;

  getById(id: string): Promise<Project | null>;

  list(): Promise<Project[]>;

  listByWorkspace(workspaceId: string): Promise<Project[]>;

  update(project: Project): Promise<Project>;

  setArchived(id: string, archived: boolean): Promise<void>;
}