import { describe, expect, it } from "vitest";
import { AuthService } from "./auth-service";
import {
  createFakeContext,
  isValidIdPrefix,
  pastIso,
} from "../../testing/fakes";

function createService() {
  const context = createFakeContext();

  const auth = new AuthService(
    context.users,
    context.sessions,
    context.database,
  );

  return { ...context, auth };
}

describe("AuthService.register", () => {
  it("creates a user, a workspace with an owner, and a session", async () => {
    const { auth, users, sessions, workspaces } =
      createService();

    const result = await auth.register({
      email: "  Owner@Example.com ",
      password: "super-secret-1",
    });

    expect(result.user.email).toBe("owner@example.com");

    expect(result.session.userId).toBe(result.user.id);

    expect(result.token).toBeTruthy();

    expect(isValidIdPrefix(result.user.id, "user")).toBe(true);

    expect(isValidIdPrefix(result.session.id, "session")).toBe(
      true,
    );

    expect(users.users.size).toBe(1);

    const session = sessions.sessions.get(result.session.id);

    expect(session?.tokenHash).not.toBe(result.token);

    const owner = workspaces.members.get(
      createOwnerMemberId(workspaces),
    );

    expect(owner?.role).toBe("OWNER");
  });

  it("attaches the created workspace to the result", async () => {
    const { auth } = createService();

    const result = await auth.register({
      email: "owner@example.com",
      password: "super-secret-1",
    });

    expect(result.workspace?.id).toBeTruthy();

    expect(result.workspace?.name).toBe("My workspace");
  });

  it("rejects an invalid email", async () => {
    const { auth } = createService();

    await expect(
      auth.register({
        email: "not-an-email",
        password: "super-secret-1",
      }),
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 400,
    });
  });

  it("rejects a short password", async () => {
    const { auth } = createService();

    await expect(
      auth.register({
        email: "owner@example.com",
        password: "short",
      }),
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 400,
    });
  });

  it("rejects a duplicate email", async () => {
    const { auth } = createService();

    await auth.register({
      email: "owner@example.com",
      password: "super-secret-1",
    });

    await expect(
      auth.register({
        email: "OWNER@example.com",
        password: "other-secret-1",
      }),
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 409,
    });
  });
});

describe("AuthService.login", () => {
  it("signs a user in with the correct credentials", async () => {
    const { auth, sessions } = createService();

    await auth.register({
      email: "owner@example.com",
      password: "super-secret-1",
    });

    const result = await auth.login({
      email: "owner@example.com",
      password: "super-secret-1",
    });

    expect(result.user.email).toBe("owner@example.com");

    expect(result.token).toBeTruthy();

    const session = sessions.sessions.get(result.session.id);

    expect(session?.tokenHash).not.toBe(result.token);
  });

  it("rejects an unknown email", async () => {
    const { auth } = createService();

    await expect(
      auth.login({
        email: "missing@example.com",
        password: "super-secret-1",
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a wrong password", async () => {
    const { auth } = createService();

    await auth.register({
      email: "owner@example.com",
      password: "super-secret-1",
    });

    await expect(
      auth.login({
        email: "owner@example.com",
        password: "wrong-password",
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("AuthService.currentSession", () => {
  it("resolves a valid token to its user", async () => {
    const { auth } = createService();

    const registered = await auth.register({
      email: "owner@example.com",
      password: "super-secret-1",
    });

    const current =
      await auth.currentSession(registered.token);

    expect(current?.user.id).toBe(registered.user.id);

    expect(current?.session.id).toBe(registered.session.id);
  });

  it("returns null for a missing token", async () => {
    const { auth } = createService();

    await expect(
      auth.currentSession(undefined),
    ).resolves.toBeNull();
  });

  it("returns null for an unknown token", async () => {
    const { auth } = createService();

    await expect(
      auth.currentSession("bogus-token-value"),
    ).resolves.toBeNull();
  });

  it("rejects an expired session and removes it", async () => {
    const { auth, sessions } = createService();

    const registered = await auth.register({
      email: "owner@example.com",
      password: "super-secret-1",
    });

    const session = sessions.sessions.get(
      registered.session.id,
    );

    expect(session).toBeDefined();

    session!.expiresAt = pastIso(1);

    await expect(
      auth.currentSession(registered.token),
    ).resolves.toBeNull();

    expect(
      sessions.sessions.has(registered.session.id),
    ).toBe(false);
  });
});

describe("AuthService.logout", () => {
  it("deletes the session for the given token", async () => {
    const { auth, sessions } = createService();

    const registered = await auth.register({
      email: "owner@example.com",
      password: "super-secret-1",
    });

    await auth.logout(registered.token);

    expect(
      sessions.sessions.has(registered.session.id),
    ).toBe(false);

    await expect(
      auth.currentSession(registered.token),
    ).resolves.toBeNull();
  });

  it("is a no-op without a token", async () => {
    const { auth, sessions } = createService();

    await auth.register({
      email: "owner@example.com",
      password: "super-secret-1",
    });

    await auth.logout(undefined);

    expect(sessions.sessions.size).toBe(1);
  });
});

function createOwnerMemberId(
  workspaces: ReturnType<
    typeof createFakeContext
  >["workspaces"],
): string {
  const members = Array.from(workspaces.members.values());

  if (members.length === 0) {
    throw new Error("No members seeded");
  }

  return members[0].id;
}