import type { WorkspaceRole } from "./auth";

export type Workspace = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceMember = {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: string;
};

export type WorkspaceMembership = {
  workspace: Workspace;
  member: WorkspaceMember;
};