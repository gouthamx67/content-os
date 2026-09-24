import type {
  Workspace,
  WorkspaceMember,
  WorkspaceMembership,
} from "../domain/workspace";
import type { WorkspaceRole } from "../domain/auth";
import type { WorkspaceRepository } from "../ports";
import { createId } from "../../lib/id";
import { HttpError } from "../../lib/http";

export type AddMemberInput = {
  userId: string;
  role: WorkspaceRole;
};

export class WorkspaceService {
  constructor(
    private readonly workspaces: WorkspaceRepository,
  ) {}

  async listForUser(
    userId: string,
  ): Promise<WorkspaceMembership[]> {
    const memberships = await this.workspaces.listForUser(
      userId,
    );

    const resolved = await Promise.all(
      memberships.map(async (member) => {
        const workspace = await this.workspaces.getById(
          member.workspaceId,
        );

        if (!workspace) {
          return null;
        }

        return { workspace, member };
      }),
    );

    return resolved.filter(
      (
        membership,
      ): membership is WorkspaceMembership =>
        membership !== null,
    );
  }

  async create(
    userId: string,
    input: { name?: string },
  ): Promise<Workspace> {
    const name = input.name?.trim();

    if (!name) {
      throw new HttpError(400, "Workspace name is required");
    }

    return this.workspaces.createWithOwner({
      workspaceId: createId("workspace"),
      name,
      ownerUserId: userId,
      memberId: createId("member"),
    });
  }

  async get(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembership> {
    const member = await this.requireMembership(
      workspaceId,
      userId,
    );

    const workspace = await this.workspaces.getById(
      workspaceId,
    );

    if (!workspace) {
      throw new HttpError(404, "Workspace not found");
    }

    return { workspace, member };
  }

  async getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMember | null> {
    return this.workspaces.getMembership(
      workspaceId,
      userId,
    );
  }

  async requireMembership(
    workspaceId: string,
    userId: string,
    roles?: WorkspaceRole[],
  ): Promise<WorkspaceMember> {
    const member = await this.workspaces.getMembership(
      workspaceId,
      userId,
    );

    if (!member) {
      throw new HttpError(
        403,
        "You do not have access to this workspace",
      );
    }

    if (
      roles &&
      roles.length > 0 &&
      !roles.includes(member.role)
    ) {
      throw new HttpError(
        403,
        "You do not have permission for this action",
      );
    }

    return member;
  }

  async listMembers(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMember[]> {
    await this.requireMembership(workspaceId, userId);

    return this.workspaces.listMembers(workspaceId);
  }

  async addMember(
    workspaceId: string,
    actorUserId: string,
    input: AddMemberInput,
  ): Promise<WorkspaceMember> {
    await this.requireMembership(
      workspaceId,
      actorUserId,
      ["OWNER", "ADMIN"],
    );

    if (
      input.role === "OWNER" &&
      (await this.getRole(workspaceId, actorUserId)) !== "OWNER"
    ) {
      throw new HttpError(
        403,
        "Only workspace owners can add owners",
      );
    }

    return this.workspaces.addMember({
      id: createId("member"),
      workspaceId,
      userId: input.userId,
      role: input.role,
    });
  }

  async updateMemberRole(
    workspaceId: string,
    actorUserId: string,
    targetUserId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMember> {
    await this.requireMembership(
      workspaceId,
      actorUserId,
      ["OWNER", "ADMIN"],
    );

    const actorRole = await this.getRole(
      workspaceId,
      actorUserId,
    );

    const targetMember = await this.workspaces.getMembership(
      workspaceId,
      targetUserId,
    );

    if (!targetMember) {
      throw new HttpError(404, "Member not found");
    }

    if (targetMember.role === "OWNER" && actorRole !== "OWNER") {
      throw new HttpError(
        403,
        "Only workspace owners can change an owner's role",
      );
    }

    if (role === "OWNER" && actorRole !== "OWNER") {
      throw new HttpError(
        403,
        "Only workspace owners can grant the owner role",
      );
    }

    return this.workspaces.updateMemberRole(
      workspaceId,
      targetUserId,
      role,
    );
  }

  async removeMember(
    workspaceId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<void> {
    await this.requireMembership(
      workspaceId,
      actorUserId,
      ["OWNER", "ADMIN"],
    );

    const actorRole = await this.getRole(
      workspaceId,
      actorUserId,
    );

    const targetMember = await this.workspaces.getMembership(
      workspaceId,
      targetUserId,
    );

    if (!targetMember) {
      throw new HttpError(404, "Member not found");
    }

    if (targetMember.role === "OWNER" && actorRole !== "OWNER") {
      throw new HttpError(
        403,
        "Only workspace owners can remove an owner",
      );
    }

    if (targetMember.role === "OWNER" && actorRole === "OWNER") {
      const count = await this.workspaces.memberCount(
        workspaceId,
      );

      if (count <= 1) {
        throw new HttpError(
          400,
          "Cannot remove the last owner of a workspace",
        );
      }
    }

    await this.workspaces.removeMember(
      workspaceId,
      targetUserId,
    );
  }

  private async getRole(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceRole | null> {
    const member = await this.workspaces.getMembership(
      workspaceId,
      userId,
    );

    return member?.role ?? null;
  }
}