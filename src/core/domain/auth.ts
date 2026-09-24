export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

export type User = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
};

export type Session = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
};

export type PublicUser = Pick<User, "id" | "email" | "createdAt">;