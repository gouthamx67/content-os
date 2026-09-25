import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicOrm } from "../../prisma/db";

const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";

type Services = typeof import("../../infrastructure/services");

let services: Services;

let orm: PublicOrm;

async function clearRows(
  rows: Array<{ id: string }>,
  remove: (id: string) => Promise<unknown>,
) {
  for (const row of rows) {
    await remove(row.id);
  }
}

async function cleanup() {
  await clearRows(
    await orm.WorkspaceMember.all(),
    (id) => orm.WorkspaceMember.where({ id }).delete(),
  );

  await clearRows(
    await orm.Session.all(),
    (id) => orm.Session.where({ id }).delete(),
  );

  await clearRows(
    await orm.Asset.all(),
    (id) => orm.Asset.where({ id }).delete(),
  );

  await clearRows(
    await orm.Source.all(),
    (id) => orm.Source.where({ id }).delete(),
  );

  await clearRows(
    await orm.Project.all(),
    (id) => orm.Project.where({ id }).delete(),
  );

  await clearRows(
    await orm.Workspace.all(),
    (id) => orm.Workspace.where({ id }).delete(),
  );

  await clearRows(
    await orm.User.all(),
    (id) => orm.User.where({ id }).delete(),
  );
}

beforeAll(async () => {
  process.env["DATABASE_URL"] = TEST_DATABASE_URL;

  const [{ db }, loadedServices] = await Promise.all([
    import("../../prisma/db"),
    import("../../infrastructure/services"),
  ]);

  services = loadedServices;

  orm = db.orm.public;

  await cleanup();
});

afterAll(cleanup);

function uniqueEmail(): string {
  return `it-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
}

async function registerUser(email?: string) {
  return services.authService.register({
    email: email ?? uniqueEmail(),
    password: "test-password-1",
  });
}

function errorStatus(error: unknown): number {
  return (error as { status?: number }).status ?? 0;
}

describe("auth integration", () => {
  it("creates a user, workspace, OWNER membership and session row", async () => {
    const result = await registerUser();

    expect(result.user.id).toMatch(/^user_/);

    expect(result.workspace?.id).toMatch(/^workspace_/);

    const userRow = await orm.User.first({ id: result.user.id });

    expect(userRow?.email).toBe(result.user.email);

    const memberRows = await orm.WorkspaceMember.where(
      (member) => member.userId.eq(result.user.id),
    ).all();

    expect(memberRows).toHaveLength(1);

    expect(memberRows[0].role).toBe("OWNER");

    const sessionRows = await orm.Session.where(
      (session) => session.userId.eq(result.user.id),
    ).all();

    expect(sessionRows).toHaveLength(1);

    expect(sessionRows[0].tokenHash).not.toBe(result.token);
  });

  it("round-trips login against the stored scrypt hash", async () => {
    const registered = await registerUser();

    const loggedIn = await services.authService.login({
      email: registered.user.email,
      password: "test-password-1",
    });

    expect(loggedIn.user.id).toBe(registered.user.id);

    const bad = await services.authService
      .login({
        email: registered.user.email,
        password: "wrong-password",
      })
      .catch((error: unknown) => error);

    expect(errorStatus(bad)).toBe(401);
  });

  it("resolves a live session and invalidates it after logout", async () => {
    const registered = await registerUser();

    const current = await services.authService.currentSession(
      registered.token,
    );

    expect(current?.user.id).toBe(registered.user.id);

    await services.authService.logout(registered.token);

    await expect(
      services.authService.currentSession(registered.token),
    ).resolves.toBeNull();
  });

  it("rejects duplicate email", async () => {
    const email = uniqueEmail();

    await registerUser(email);

    const second = await services.authService
      .register({ email, password: "test-password-1" })
      .catch((error: unknown) => error);

    expect(errorStatus(second)).toBe(409);
  });
});

describe("workspaces integration", () => {
  it("creates a workspace and lists the owner's workspaces", async () => {
    const { user } = await registerUser();

    const created = await services.workspaceService.create(
      user.id,
      { name: "Launch Team" },
    );

    expect(created.name).toBe("Launch Team");

    const names = (await services.workspaceService.listForUser(
      user.id,
    ))
      .map((membership) => membership.workspace.name)
      .sort();

    expect(names).toContain("My workspace");

    expect(names).toContain("Launch Team");
  });

  it("manages membership roles with owner/admin guards", async () => {
    const owner = await registerUser();

    const admin = await registerUser();

    const member = await registerUser();

    const added = await services.workspaceService.addMember(
      owner.workspace!.id,
      owner.user.id,
      { userId: admin.user.id, role: "ADMIN" },
    );

    expect(added.role).toBe("ADMIN");

    await services.workspaceService.addMember(
      owner.workspace!.id,
      owner.user.id,
      { userId: member.user.id, role: "MEMBER" },
    );

    const denied = await services.workspaceService
      .addMember(owner.workspace!.id, admin.user.id, {
        userId: member.user.id,
        role: "OWNER",
      })
      .catch((error: unknown) => error);

    expect(errorStatus(denied)).toBe(403);
  });
});

describe("projects integration (cross-workspace isolation)", () => {
  it("scopes project listings to the member's workspaces", async () => {
    const owner = await registerUser();

    const other = await registerUser();

    const created = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Website refresh" },
      owner.user.id,
    );

    expect(created.name).toBe("Website refresh");

    expect(created.archived).toBe(false);

    const ownerList = await services.projectService.listForUser(
      owner.user.id,
    );

    expect(ownerList.map((project) => project.id)).toContain(
      created.id,
    );

    const otherList = await services.projectService.listForUser(
      other.user.id,
    );

    expect(otherList.map((project) => project.id)).not.toContain(
      created.id,
    );

    const denied = await services.projectService
      .createForWorkspace(
        other.workspace!.id,
        { name: "Intruder" },
        owner.user.id,
      )
      .catch((error: unknown) => error);

    expect(errorStatus(denied)).toBe(403);
  });

  it("archives and restores a project and persists its status", async () => {
    const owner = await registerUser();

    const created = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Campaign" },
      owner.user.id,
    );

    const archived = await services.projectService.archive(
      created.id,
      owner.user.id,
    );

    expect(archived.archived).toBe(true);

    const row = await orm.Project.first({ id: created.id });

    expect(row?.status).toBe("ARCHIVED");

    const restored = await services.projectService.restore(
      created.id,
      owner.user.id,
    );

    expect(restored.archived).toBe(false);
  });

  it("persists sources and assets per project and deletes them", async () => {
    const owner = await registerUser();

    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Launch" },
      owner.user.id,
    );

    const source = await services.sourceService.create(
      project.id,
      {
        type: "WEBSITE",
        name: "Landing",
        uri: "https://example.com",
        metadata: null,
      },
      owner.user.id,
    );

    expect(source.id).toMatch(/^source_/);

    const asset = await services.assetService.create(
      project.id,
      {
        type: "IMAGE",
        name: "Hero",
        uri: "https://example.com/hero.png",
      },
      owner.user.id,
    );

    expect(asset.id).toMatch(/^asset_/);

    await expect(
      services.sourceService.list(project.id, owner.user.id),
    ).resolves.toHaveLength(1);

    await expect(
      services.assetService.list(project.id, owner.user.id),
    ).resolves.toHaveLength(1);

    await services.sourceService.remove(
      project.id,
      source.id,
      owner.user.id,
    );

    await services.assetService.remove(
      project.id,
      asset.id,
      owner.user.id,
    );

    await expect(
      services.sourceService.list(project.id, owner.user.id),
    ).resolves.toHaveLength(0);

    await expect(
      services.assetService.list(project.id, owner.user.id),
    ).resolves.toHaveLength(0);
  });

  it("returns 403 for foreign projects and 404 for missing ones", async () => {
    const owner = await registerUser();

    const stranger = await registerUser();

    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Private" },
      owner.user.id,
    );

    const deniedGet = await services.projectService
      .getAuthorized(project.id, stranger.user.id)
      .catch((error: unknown) => error);

    expect(errorStatus(deniedGet)).toBe(403);

    const deniedSources = await services.sourceService
      .list(project.id, stranger.user.id)
      .catch((error: unknown) => error);

    expect(errorStatus(deniedSources)).toBe(403);

    const missing = await services.projectService
      .getAuthorized("project_does-not-exist", owner.user.id)
      .catch((error: unknown) => error);

    expect(errorStatus(missing)).toBe(404);
  });
});

describe("universal inputs integration", () => {
  it("persists lifecycle, hashes, deduplicates and deletes shared content", async () => {
    const owner = await registerUser();
    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Input lifecycle" },
      owner.user.id,
    );

    const first = await services.inputService.createBatch(project.id, owner.user.id, [
      { type: "text", name: "Brief", value: "The same brief" },
      {
        type: "upload",
        file: {
          name: "copy.txt",
          mimeType: "text/plain",
          bytes: new TextEncoder().encode("Uploaded copy"),
        },
      },
    ]);

    expect(first.inputs).toHaveLength(2);
    expect(first.inputs.every((input) => input.status === "READY")).toBe(true);
    expect(first.inputs.every((input) => input.contentHash?.match(/^[a-f0-9]{64}$/))).toBe(true);
    expect(first.inputs.every((input) => input.storageKey !== null)).toBe(true);
    const firstText = first.inputs.find((input) => input.type === "TEXT")!;

    const duplicate = await services.inputService.createBatch(project.id, owner.user.id, [
      { type: "text", name: "Same brief", value: "The same brief" },
    ]);
    const sharedVersion = duplicate.versions.find(
      (version) => version.sourceIds.length === 2,
    );
    expect(sharedVersion).toBeDefined();
    expect(duplicate.inputs[0]?.storageKey).toBe(firstText.storageKey);

    const firstTextId = firstText.id;
    const secondTextId = duplicate.inputs[0]!.id;
    await services.inputService.deleteInput(project.id, owner.user.id, firstTextId);
    await expect(
      services.inputService.getInput(project.id, owner.user.id, secondTextId),
    ).resolves.toMatchObject({ status: "READY" });
    await services.inputService.deleteInput(project.id, owner.user.id, secondTextId);

    const textRows = await orm.Source.where((source) =>
      source.contentHash.eq(firstText.contentHash!),
    ).all();
    expect(textRows).toHaveLength(0);
  });

  it("serves authenticated input routes and keeps project scoping", async () => {
    const owner = await registerUser();
    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Input API" },
      owner.user.id,
    );
    const { GET, POST } = await import(
      "../../app/api/projects/[id]/inputs/route"
    );
    const { GET: GET_ITEM, DELETE } = await import(
      "../../app/api/projects/[id]/inputs/[sourceId]/route"
    );
    const headers = { cookie: `content_os_session=${owner.token}` };
    const createResponse = await POST(
      new Request("http://localhost/api/projects/project/inputs", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          inputs: [{ type: "text", name: "API brief", value: "API content" }],
        }),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      inputs: Array<{ id: string; kind: string; status: string; storageKey?: string }>;
    };
    expect(created.inputs[0]).toMatchObject({ kind: "text", status: "ready" });
    expect(created.inputs[0]?.storageKey).toBeUndefined();

    const listResponse = await GET(
      new Request("http://localhost/api", { headers }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      inputs: [{ id: created.inputs[0]!.id, kind: "text" }],
    });

    const foreignProject = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Wrong project" },
      owner.user.id,
    );
    const foreignResponse = await GET_ITEM(
      new Request("http://localhost/api", { headers }),
      {
        params: Promise.resolve({
          id: foreignProject.id,
          sourceId: created.inputs[0]!.id,
        }),
      },
    );
    expect(foreignResponse.status).toBe(404);

    const deleteResponse = await DELETE(
      new Request("http://localhost/api", { method: "DELETE", headers }),
      {
        params: Promise.resolve({
          id: project.id,
          sourceId: created.inputs[0]!.id,
        }),
      },
    );
    expect(deleteResponse.status).toBe(200);
  });
});

describe("database integrity", () => {
  it("serializes concurrent source storage locks in postgres", async () => {
    const { PostgresSourceStorageCoordinator } = await import(
      "../../infrastructure/repositories/postgres-source-storage-coordinator"
    );
    const coordinator = new PostgresSourceStorageCoordinator();
    const events: string[] = [];

    const first = coordinator.withSourceStorageLock("source_lock_probe", async () => {
      events.push("first:enter");
      await new Promise((resolve) => setTimeout(resolve, 150));
      events.push("first:exit");
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    const second = coordinator.withSourceStorageLock("source_lock_probe", async () => {
      events.push("second:enter");
    });

    await Promise.all([first, second]);

    expect(events).toEqual(["first:enter", "first:exit", "second:enter"]);
  });

  it("mutually excludes storage key locks across different source locks", async () => {
    const { PostgresSourceStorageCoordinator } = await import(
      "../../infrastructure/repositories/postgres-source-storage-coordinator"
    );
    const coordinator = new PostgresSourceStorageCoordinator();
    let inside = 0;
    let overlapped = false;

    const contend = (label: string) =>
      coordinator.withSourceStorageLock(`source_key_${label}`, (transaction) =>
        transaction.withStorageKeyLock("projects/p/inputs/shared/original", async () => {
          inside += 1;
          if (inside > 1) {
            overlapped = true;
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
          inside -= 1;
        }),
      );

    await Promise.all([contend("a"), contend("b")]);

    expect(overlapped).toBe(false);
    expect(inside).toBe(0);
  });

  it("rolls back repository writes when coordinated work throws", async () => {
    const { PostgresSourceStorageCoordinator } = await import(
      "../../infrastructure/repositories/postgres-source-storage-coordinator"
    );
    const coordinator = new PostgresSourceStorageCoordinator();
    const owner = await registerUser();
    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Coordinated rollback" },
      owner.user.id,
    );

    const failure = await coordinator
      .withSourceStorageLock("source_rollback_probe", async (transaction) => {
        await transaction.sources.create({
          id: "source_rollback_probe",
          projectId: project.id,
          type: "TEXT",
          name: "Rolled back",
          uri: null,
          metadata: null,
          status: "QUEUED",
          mimeType: null,
          sizeBytes: null,
          contentHash: null,
          storageKey: null,
          errorCode: null,
          errorMessage: null,
        });
        throw new Error("force rollback");
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    await expect(
      orm.Source.where((source) => source.name.eq("Rolled back")).all(),
    ).resolves.toHaveLength(0);
  });

  it("stores parseable timestamp columns", async () => {
    const result = await registerUser();

    const rows = await orm.Session.where(
      (session) => session.userId.eq(result.user.id),
    ).all();

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(Number.isNaN(new Date(row.createdAt).getTime())).toBe(
        false,
      );

      expect(new Date(row.createdAt).toISOString()).toMatch(
        /^\d{4}-\d{2}-\d{2}T/,
      );
    }
  });

  it("enforces foreign keys across tables", async () => {
    await registerUser();

    const orphanId = `source_invalid_${Date.now()}`;

    const result = await orm.Source.create({
      id: orphanId,
      projectId: "project_missing",
      type: "TEXT",
      name: "Orphan",
      uri: null,
      metadata: null,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(result).not.toBeNull();

    expect(await orm.Source.first({ id: orphanId })).toBeNull();

    expect(result).not.toBeNull();
  });

  it("keeps the workspace_member unique constraint", async () => {
    const owner = await registerUser();

    const second = await services.workspaceService
      .addMember(owner.workspace!.id, owner.user.id, {
        userId: owner.user.id,
        role: "OWNER",
      })
      .catch((error: unknown) => error);

    expect(second).not.toBeNull();

    const rows = await orm.WorkspaceMember.where(
      (member) => member.workspaceId.eq(owner.workspace!.id),
    )
      .where((member) => member.userId.eq(owner.user.id))
      .all();

    expect(rows).toHaveLength(1);
  });
});