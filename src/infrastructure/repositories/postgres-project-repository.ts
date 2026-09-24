import type { PublicOrm } from "../../prisma/db";
import type { Project } from "../../core/domain";
import type { ProjectRepository } from "../../core/ports/project-repository";
import { pgTimestampToIso } from "../../lib/time";

type ProjectRow = {
  id: string;
  workspaceId: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
};

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    status: "created",
    archived: row.status === "ARCHIVED",
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
    sources: [],
    assets: [],
  };
}

export class PostgresProjectRepository
  implements ProjectRepository
{
  constructor(private readonly orm: PublicOrm) {}

  async create(project: Project): Promise<Project> {
    const row = await this.orm.Project.create({
      id: project.id,
      workspaceId: project.workspaceId,
      name: project.name,
      status: project.archived ? "ARCHIVED" : "ACTIVE",
    });

    return mapProject(row);
  }

  async getById(id: string): Promise<Project | null> {
    const row = await this.orm.Project.first({ id });

    if (!row) {
      return null;
    }

    return mapProject(row);
  }

  async list(): Promise<Project[]> {
    const rows = await this.orm.Project.orderBy(
      (project) => project.createdAt.desc(),
    ).all();

    return rows.map(mapProject);
  }

  async listByWorkspace(
    workspaceId: string,
  ): Promise<Project[]> {
    const rows = await this.orm.Project.where(
      (project) => project.workspaceId.eq(workspaceId),
    )
      .orderBy((project) => project.createdAt.desc())
      .all();

    return rows.map(mapProject);
  }

  async update(project: Project): Promise<Project> {
    const row = await this.orm.Project.where({
      id: project.id,
    }).update({
      name: project.name,
      status: project.archived ? "ARCHIVED" : "ACTIVE",
    });

    if (!row) {
      throw new Error(`Project not found: ${project.id}`);
    }

    return mapProject(row);
  }

  async setArchived(
    id: string,
    archived: boolean,
  ): Promise<void> {
    await this.orm.Project.where({ id }).update({
      status: archived ? "ARCHIVED" : "ACTIVE",
    });
  }
}