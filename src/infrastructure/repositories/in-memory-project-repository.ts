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

  async update(project: Project): Promise<Project> {
    this.projects.set(project.id, project);

    return project;
  }
}