import type { Workspace, WorkspaceMember } from "../domain/workspace";
import type { WorkspaceRole } from "../domain/auth";

export type CreateWorkspaceInput = {
  id: string;
  name: string;
};

export type CreateWorkspaceWithOwnerInput = {
  workspaceId: string;
  name: string;
  ownerUserId: string;
  memberId: string;
};

export interface WorkspaceRepository {
  create(input: CreateWorkspaceInput): Promise<Workspace>;

  createWithOwner(input: CreateWorkspaceWithOwnerInput): Promise<Workspace>;

  getById(id: string): Promise<Workspace | null>;

  memberCount(workspaceId: string): Promise<number>;

  listForUser(userId: string): Promise<WorkspaceMember[]>;

  getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMember | null>;

  listMembers(workspaceId: string): Promise<WorkspaceMember[]>;

  addMember(input: {
    id: string;
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
  }): Promise<WorkspaceMember>;

  updateMemberRole(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMember>;

  removeMember(workspaceId: string, userId: string): Promise<void>;
}