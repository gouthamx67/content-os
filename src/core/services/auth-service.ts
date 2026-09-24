import type {
  DatabasePort,
  SessionRepository,
  UserRepository,
} from "../ports";
import type {
  PublicUser,
  Session,
} from "../domain/auth";
import { createId } from "../../lib/id";
import {
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from "../../lib/password";
import {
  generateSessionToken,
  hashSessionToken,
} from "../../lib/session-token";
import { HttpError } from "../../lib/http";
import { toPublicUser } from "../../lib/public-user";

export const SESSION_LIFETIME_SECONDS =
  30 * 24 * 60 * 60;

export const MIN_PASSWORD_LENGTH = 8;

export type RegisterInput = {
  email: string;
  password: string;
  name?: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type AuthSessionResult = {
  user: PublicUser;
  session: Session;
  token: string;
  expiresAt: string;
  sessionLifetimeSeconds: number;
  workspace?: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
};

export type CurrentSessionResult = {
  user: PublicUser;
  session: Session;
};

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly database: DatabasePort,
  ) {}

  async register(
    input: RegisterInput,
  ): Promise<AuthSessionResult> {
    const email = normalizeEmail(input.email ?? "");

    if (!email.includes("@")) {
      throw new HttpError(400, "A valid email is required");
    }

    if (
      typeof input.password !== "string" ||
      input.password.length < MIN_PASSWORD_LENGTH
    ) {
      throw new HttpError(
        400,
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }

    const passwordHash = await hashPassword(input.password);

    const token = generateSessionToken();

    const expiresAt = new Date(
      Date.now() + SESSION_LIFETIME_SECONDS * 1000,
    ).toISOString();

    try {
      const { user, workspace, session } =
        await this.database.transaction(
          async (tx) => {
            const existing = await tx.users.findByEmail(
              email,
            );

            if (existing) {
              throw new HttpError(
                409,
                "An account with this email already exists",
              );
            }

            const user = await tx.users.create({
              id: createId("user"),
              email,
              passwordHash,
            });

            const workspace = await tx.workspaces.createWithOwner({
              workspaceId: createId("workspace"),
              name: "My workspace",
              ownerUserId: user.id,
              memberId: createId("member"),
            });

            const session = await tx.sessions.create({
              id: createId("session"),
              userId: user.id,
              tokenHash: hashSessionToken(token),
              expiresAt,
            });

            return { user, workspace, session };
          },
        );

      return {
        user: toPublicUser(user),
        session,
        token,
        expiresAt,
        sessionLifetimeSeconds: SESSION_LIFETIME_SECONDS,
        workspace: toPublicWorkspace(workspace),
      };
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      if (isUniqueViolation(error)) {
        throw new HttpError(
          409,
          "An account with this email already exists",
        );
      }

      throw new HttpError(500, "Unable to register");
    }
  }

  async login(
    input: LoginInput,
  ): Promise<AuthSessionResult> {
    const email = normalizeEmail(input.email ?? "");

    if (!email.includes("@")) {
      throw new HttpError(400, "A valid email is required");
    }

    const user = await this.users.findByEmail(email);

    if (!user) {
      throw new HttpError(401, "Invalid email or password");
    }

    const valid = await verifyPassword(
      input.password ?? "",
      user.passwordHash,
    );

    if (!valid) {
      throw new HttpError(401, "Invalid email or password");
    }

    const token = generateSessionToken();

    const expiresAt = new Date(
      Date.now() + SESSION_LIFETIME_SECONDS * 1000,
    ).toISOString();

    const session = await this.sessions.create({
      id: createId("session"),
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
    });

    return {
      user: toPublicUser(user),
      session,
      token,
      expiresAt,
      sessionLifetimeSeconds: SESSION_LIFETIME_SECONDS,
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) {
      return;
    }

    const session = await this.sessions.findByTokenHash(
      hashSessionToken(rawToken),
    );

    if (session) {
      await this.sessions.deleteById(session.id);
    }
  }

  async currentSession(
    rawToken: string | undefined,
  ): Promise<CurrentSessionResult | null> {
    if (!rawToken) {
      return null;
    }

    const session = await this.sessions.findByTokenHash(
      hashSessionToken(rawToken),
    );

    if (!session) {
      return null;
    }

    if (
      new Date(session.expiresAt).getTime() <= Date.now()
    ) {
      await this.sessions.deleteById(session.id);

      return null;
    }

    const user = await this.users.getById(session.userId);

    if (!user) {
      await this.sessions.deleteById(session.id);

      return null;
    }

    return {
      user: toPublicUser(user),
      session,
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

function toPublicWorkspace(workspace: {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}