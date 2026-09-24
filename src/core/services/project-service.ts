import type { Project, Source } from "../domain";
import type { WorkspaceMember } from "../domain/workspace";
import type { ProjectRepository } from "../ports";
import { createId } from "../../lib/id";
import { HttpError } from "../../lib/http";

export type CreateProjectInput = {
  name?: string;

  sources?: Array<{
    type: Source["type"];
    name: string;
    uri?: string;
    mimeType?: string;
  }>;
};

export type UpdateProjectInput = {
  name?: string;
};

export type WorkspaceMembershipLookup = (
  workspaceId: string,
  userId: string,
) => Promise<WorkspaceMember | null>;

export type WorkspaceIdsForUser = (
  userId: string,
) => Promise<string[]>;

export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly getMembership: WorkspaceMembershipLookup = async () => null,
    private readonly listWorkspaceIdsForUser: WorkspaceIdsForUser = async () => [],
  ) {}

  async create(
    input: CreateProjectInput,
  ): Promise<Project> {
    return this.createInWorkspace(input, "");
  }

  async get(id: string): Promise<Project | null> {
    return this.repository.getById(id);
  }

  async list(): Promise<Project[]> {
    return this.repository.list();
  }

  async createForWorkspace(
    workspaceId: string,
    input: CreateProjectInput,
    userId: string,
  ): Promise<Project> {
    await this.requireMembership(workspaceId, userId);

    return this.createInWorkspace(input, workspaceId);
  }

  async listForWorkspace(
    workspaceId: string,
    userId: string,
  ): Promise<Project[]> {
    await this.requireMembership(workspaceId, userId);

    return this.repository.listByWorkspace(workspaceId);
  }

  async listForUser(userId: string): Promise<Project[]> {
    const workspaceIds =
      await this.listWorkspaceIdsForUser(userId);

    const perWorkspace = await Promise.all(
      workspaceIds.map((workspaceId) =>
        this.repository.listByWorkspace(workspaceId),
      ),
    );

    return perWorkspace
      .flat()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async getAuthorized(
    id: string,
    userId: string,
  ): Promise<Project> {
    const project = await this.repository.getById(id);

    if (!project) {
      throw new HttpError(404, "Project not found");
    }

    await this.requireMembership(project.workspaceId, userId);

    return project;
  }

  async updateAuthorized(
    id: string,
    input: UpdateProjectInput,
    userId: string,
  ): Promise<Project> {
    const project = await this.getAuthorized(id, userId);

    await this.requireRole(project.workspaceId, userId, [
      "OWNER",
      "ADMIN",
    ]);

    const name = input.name?.trim();

    if (!name) {
      throw new HttpError(400, "Name is required");
    }

    return this.repository.update({
      ...project,
      name,
    });
  }

  async archive(id: string, userId: string): Promise<Project> {
    const project = await this.getAuthorized(id, userId);

    await this.requireRole(project.workspaceId, userId, [
      "OWNER",
      "ADMIN",
    ]);

    await this.repository.setArchived(id, true);

    return (await this.repository.getById(id)) as Project;
  }

  async restore(id: string, userId: string): Promise<Project> {
    const project = await this.getAuthorized(id, userId);

    await this.requireRole(project.workspaceId, userId, [
      "OWNER",
      "ADMIN",
    ]);

    await this.repository.setArchived(id, false);

    return (await this.repository.getById(id)) as Project;
  }

  private createInWorkspace(
    input: CreateProjectInput,
    workspaceId: string,
  ): Promise<Project> {
    const now = new Date().toISOString();

    const project: Project = {
      id: createId("project"),
      workspaceId,
      name: input.name?.trim() || "Untitled project",
      status: "created",
      archived: false,

      createdAt: now,
      updatedAt: now,

      sources: (input.sources ?? []).map((source) => ({
        id: createId("source"),
        type: source.type,
        name: source.name,
        uri: source.uri,
        mimeType: source.mimeType,
        createdAt: now,
      })),

      assets: [],
    };

    return this.repository.create(project);
  }

  private async requireMembership(
    workspaceId: string,
    userId: string,
    roles?: Array<WorkspaceMember["role"]>,
  ): Promise<WorkspaceMember> {
    const member = await this.getMembership(
      workspaceId,
      userId,
    );

    if (!member) {
      throw new HttpError(
        403,
        "You do not have access to this workspace",
      );
    }

    if (roles && roles.length > 0 && !roles.includes(member.role)) {
      throw new HttpError(
        403,
        "You do not have permission for this action",
      );
    }

    return member;
  }

  private async requireRole(
    workspaceId: string,
    userId: string,
    roles: Array<WorkspaceMember["role"]>,
  ): Promise<WorkspaceMember> {
    return this.requireMembership(workspaceId, userId, roles);
  }
}