import type { ProjectRepository } from "../../core/ports";
import type { Project } from "../../core/domain";

export class InMemoryProjectRepository
  implements ProjectRepository
{
  private projects = new Map<string, Project>();

  async create(project: Project): Promise<Project> {
    this.projects.set(project.id, project);

    return project;
  }

  async getById(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null;
  }

  async list(): Promise<Project[]> {
    return Array.from(this.projects.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async listByWorkspace(
    workspaceId: string,
  ): Promise<Project[]> {
    return Array.from(this.projects.values())
      .filter((project) => project.workspaceId === workspaceId)
      .sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
  }

  async update(project: Project): Promise<Project> {
    this.projects.set(project.id, project);

    return project;
  }

  async setArchived(
    id: string,
    archived: boolean,
  ): Promise<void> {
    const project = this.projects.get(id);

    if (!project) {
      return;
    }

    this.projects.set(id, {
      ...project,
      archived,
    });
  }
}