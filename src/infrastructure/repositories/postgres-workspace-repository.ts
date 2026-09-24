import type { PublicOrm } from "../../prisma/db";
import type {
  Workspace,
  WorkspaceMember,
} from "../../core/domain/workspace";
import type { WorkspaceRole } from "../../core/domain/auth";
import type {
  CreateWorkspaceWithOwnerInput,
  WorkspaceRepository,
} from "../../core/ports/workspace-repository";
import { pgTimestampToIso } from "../../lib/time";

function mapWorkspace(row: {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}): Workspace {
  return {
    id: row.id,
    name: row.name,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function mapMember(row: {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: string;
}): WorkspaceMember {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: row.role,
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

export class PostgresWorkspaceRepository
  implements WorkspaceRepository
{
  constructor(private readonly orm: PublicOrm) {}

  async create(input: {
    id: string;
    name: string;
  }): Promise<Workspace> {
    const row = await this.orm.Workspace.create(input);

    return mapWorkspace(row);
  }

  async createWithOwner(
    input: CreateWorkspaceWithOwnerInput,
  ): Promise<Workspace> {
    const row = await this.orm.Workspace.create({
      id: input.workspaceId,
      name: input.name,
    });

    await this.orm.WorkspaceMember.create({
      id: input.memberId,
      workspaceId: input.workspaceId,
      userId: input.ownerUserId,
      role: "OWNER",
    });

    return mapWorkspace(row);
  }

  async getById(id: string): Promise<Workspace | null> {
    const row = await this.orm.Workspace.first({ id });

    if (!row) {
      return null;
    }

    return mapWorkspace(row);
  }

  async memberCount(workspaceId: string): Promise<number> {
    const result = await this.orm.WorkspaceMember.where(
      (member) => member.workspaceId.eq(workspaceId),
    ).aggregate((aggregate) => ({
      count: aggregate.count(),
    }));

    return result.count;
  }

  async listForUser(userId: string): Promise<WorkspaceMember[]> {
    const rows = await this.orm.WorkspaceMember.where(
      (member) => member.userId.eq(userId),
    )
      .orderBy((member) => member.createdAt.desc())
      .all();

    return rows.map(mapMember);
  }

  async getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMember | null> {
    const row = await this.orm.WorkspaceMember.where(
      (member) => member.workspaceId.eq(workspaceId),
    )
      .where((member) => member.userId.eq(userId))
      .first();

    if (!row) {
      return null;
    }

    return mapMember(row);
  }

  async listMembers(
    workspaceId: string,
  ): Promise<WorkspaceMember[]> {
    const rows = await this.orm.WorkspaceMember.where(
      (member) => member.workspaceId.eq(workspaceId),
    )
      .orderBy((member) => member.createdAt.desc())
      .all();

    return rows.map(mapMember);
  }

  async addMember(input: {
    id: string;
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
  }): Promise<WorkspaceMember> {
    const row = await this.orm.WorkspaceMember.create(input);

    return mapMember(row);
  }

  async updateMemberRole(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMember> {
    const row = await this.orm.WorkspaceMember.where(
      (member) => member.workspaceId.eq(workspaceId),
    )
      .where((member) => member.userId.eq(userId))
      .update({ role });

    if (!row) {
      throw new Error("Workspace member not found");
    }

    return mapMember(row);
  }

  async removeMember(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    await this.orm.WorkspaceMember.where(
      (member) => member.workspaceId.eq(workspaceId),
    )
      .where((member) => member.userId.eq(userId))
      .delete();
  }
}