import type {
  UserRepository,
  CreateUserInput,
} from "../core/ports/user-repository";
import type {
  SessionRepository,
  CreateSessionInput,
} from "../core/ports/session-repository";
import type {
  WorkspaceRepository,
  CreateWorkspaceWithOwnerInput,
} from "../core/ports/workspace-repository";
import type {
  DatabasePort,
  TransactionContext,
} from "../core/ports/database";
import type { User, Session } from "../core/domain/auth";
import type { WorkspaceRole } from "../core/domain/auth";
import type {
  Workspace,
  WorkspaceMember,
} from "../core/domain/workspace";
import { createId } from "../lib/id";

export class FakeUserRepository implements UserRepository {
  users = new Map<string, User>();

  async create(input: CreateUserInput): Promise<User> {
    const now = new Date().toISOString();

    const user: User = {
      id: input.id,
      email: input.email,
      passwordHash: input.passwordHash,
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(user.id, user);

    return user;
  }

  async getById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }

    return null;
  }
}

export class FakeSessionRepository
  implements SessionRepository
{
  sessions = new Map<string, Session>();

  async create(input: CreateSessionInput): Promise<Session> {
    const session: Session = {
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
    };

    this.sessions.set(session.id, session);

    return session;
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<Session | null> {
    for (const session of this.sessions.values()) {
      if (session.tokenHash === tokenHash) {
        return session;
      }
    }

    return null;
  }

  async deleteById(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async deleteByUserId(userId: string): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        this.sessions.delete(session.id);
      }
    }
  }
}

export class FakeWorkspaceRepository
  implements WorkspaceRepository
{
  workspaces = new Map<string, Workspace>();

  members = new Map<string, WorkspaceMember>();

  async create(input: {
    id: string;
    name: string;
  }): Promise<Workspace> {
    const now = new Date().toISOString();

    const workspace: Workspace = {
      id: input.id,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    };

    this.workspaces.set(workspace.id, workspace);

    return workspace;
  }

  async createWithOwner(
    input: CreateWorkspaceWithOwnerInput,
  ): Promise<Workspace> {
    const workspace = await this.create({
      id: input.workspaceId,
      name: input.name,
    });

    await this.addMember({
      id: input.memberId,
      workspaceId: input.workspaceId,
      userId: input.ownerUserId,
      role: "OWNER",
    });

    return workspace;
  }

  async getById(id: string): Promise<Workspace | null> {
    return this.workspaces.get(id) ?? null;
  }

  async memberCount(workspaceId: string): Promise<number> {
    let count = 0;

    for (const member of this.members.values()) {
      if (member.workspaceId === workspaceId) {
        count += 1;
      }
    }

    return count;
  }

  async listForUser(userId: string): Promise<WorkspaceMember[]> {
    return Array.from(this.members.values())
      .filter((member) => member.userId === userId)
      .sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt),
      );
  }

  async getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMember | null> {
    for (const member of this.members.values()) {
      if (
        member.workspaceId === workspaceId &&
        member.userId === userId
      ) {
        return member;
      }
    }

    return null;
  }

  async listMembers(
    workspaceId: string,
  ): Promise<WorkspaceMember[]> {
    return Array.from(this.members.values())
      .filter((member) => member.workspaceId === workspaceId)
      .sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt),
      );
  }

  async addMember(input: {
    id: string;
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
  }): Promise<WorkspaceMember> {
    const member: WorkspaceMember = {
      ...input,
      createdAt: new Date().toISOString(),
    };

    this.members.set(member.id, member);

    return member;
  }

  async updateMemberRole(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMember> {
    for (const member of this.members.values()) {
      if (
        member.workspaceId === workspaceId &&
        member.userId === userId
      ) {
        member.role = role;

        return member;
      }
    }

    throw new Error("Workspace member not found");
  }

  async removeMember(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    for (const member of this.members.values()) {
      if (
        member.workspaceId === workspaceId &&
        member.userId === userId
      ) {
        this.members.delete(member.id);
      }
    }
  }
}

export class FakeDatabase implements DatabasePort {
  constructor(
    readonly users: FakeUserRepository,
    readonly sessions: FakeSessionRepository,
    readonly workspaces: FakeWorkspaceRepository,
  ) {}

  async transaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    const context: TransactionContext = {
      users: this.users,
      sessions: this.sessions,
      workspaces: this.workspaces,
    };

    return work(context);
  }
}

export function createFakeContext() {
  const users = new FakeUserRepository();

  const sessions = new FakeSessionRepository();

  const workspaces = new FakeWorkspaceRepository();

  const database = new FakeDatabase(users, sessions, workspaces);

  return { users, sessions, workspaces, database };
}

export function isValidIdPrefix(
  id: string,
  prefix: string,
): boolean {
  return id.startsWith(`${prefix}_`);
}

export function futureIso(days: number): string {
  return new Date(
    Date.now() + days * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export function pastIso(days: number): string {
  return new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export function makeUserId(): string {
  return createId("user");
}

export function makeSessionId(): string {
  return createId("session");
}

export function makeWorkspaceId(): string {
  return createId("workspace");
}

export function makeProjectId(): string {
  return createId("project");
}