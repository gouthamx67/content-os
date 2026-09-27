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
const INTELLIGENCE_BRIEF = [
  "# Northwind Analytics",
  "",
  "Northwind Analytics turns raw product data into live dashboards in minutes.",
  "",
  "## Real-time dashboards",
  "",
  "Every metric refreshes continuously, with no scheduled rebuild.",
  "",
  "## Slack integration",
  "",
  "Alerts and digests post straight into Slack channels.",
  "",
  "## CSV export",
  "",
  "Export any dashboard to CSV for offline analysis.",
].join("\n");

/**
 * A brief that states a pain, an outcome and an ordered flow in plain language,
 * so the narrative families are derived from the source rather than seeded into
 * a draft by the test.
 */
const NARRATIVE_BRIEF = [
  "# Launchboard",
  "",
  "Launchboard is a content operations platform for marketing teams.",
  "",
  "## Platform-specific drafts",
  "",
  "Marketing teams currently spend hours manually rewriting the same launch announcement for every channel.",
  "",
  "## Campaign workspace",
  "",
  "To publish, create a campaign, generate platform-specific drafts, review the drafts, then publish the final versions.",
  "",
  "## One brief per channel",
  "",
  "Launchboard adapts one campaign for every platform, so you can publish everywhere from a single brief.",
  "",
  "It cuts the manual work per launch and keeps every channel consistent.",
].join("\n");

describe("product intelligence integration", () => {
  const BRIEF = INTELLIGENCE_BRIEF;

  const ROADMAP = [
    "# Northwind roadmap",
    "",
    "## Guided onboarding",
    "",
    "A checklist walks new teams through their first dashboard.",
  ].join("\n");

  async function projectWithBrief(name: string) {
    const owner = await registerUser();
    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name },
      owner.user.id,
    );
    await services.inputService.createBatch(project.id, owner.user.id, [
      { type: "text", name: "Product brief", value: BRIEF },
    ]);
    return { owner, project };
  }

  /** A project whose only source states a pain, an outcome and a flow. */
  async function projectWithNarrativeBrief(name: string) {
    const owner = await registerUser();
    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name },
      owner.user.id,
    );
    await services.inputService.createBatch(project.id, owner.user.id, [
      { type: "text", name: "Launch brief", value: NARRATIVE_BRIEF },
    ]);
    return { owner, project };
  }

  async function addTextSource(
    project: { id: string },
    userId: string,
    name: string,
    value: string,
  ): Promise<string> {
    const bundle = await services.inputService.createBatch(project.id, userId, [
      { type: "text", name, value },
    ]);
    return bundle.inputs[0]!.id;
  }

  const addRoadmap = (project: { id: string }, userId: string) =>
    addTextSource(project, userId, "Roadmap", ROADMAP);

  it("persists an evidence-backed graph, run and snapshot", async () => {
    const { owner, project } = await projectWithBrief("Intelligence graph");

    const report = await services.intelligenceService.analyze(
      project.id,
      owner.user.id,
    );

    expect(report.run.status).toBe("COMPLETED");
    expect(report.aiApplied).toBe(false);
    expect(report.snapshot?.version).toBe(1);
    expect(report.snapshot?.entityCounts).toBeTruthy();

    const features = await services.intelligenceService.listFeatures(
      project.id,
      owner.user.id,
    );
    expect(features.length).toBeGreaterThan(0);
    expect(features.every((feature) => feature.projectId === project.id)).toBe(true);
    expect(features.every((feature) => feature.canonicalKey.length > 0)).toBe(true);

    const evidence = await services.intelligenceService.listEvidence(
      project.id,
      owner.user.id,
    );
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((item) => item.projectId === project.id)).toBe(true);

    const summary = await services.intelligenceService.getSummary(
      project.id,
      owner.user.id,
    );
    expect(summary.counts.features).toBe(features.length);
    expect(summary.lastRun?.id).toBe(report.run.id);
    expect(summary.lastSnapshot?.version).toBe(1);

    const stored = await orm.IntelligenceProduct.first({ projectId: project.id });
    expect(stored?.projectId).toBe(project.id);
  });

  it("skips a refresh when no source changed", async () => {
    const { owner, project } = await projectWithBrief("Intelligence no-op");

    const first = await services.intelligenceService.analyze(project.id, owner.user.id);
    const refreshed = await services.intelligenceService.refresh(project.id, owner.user.id);

    expect(refreshed.notes).toContain("No new or changed sources since the last analysis");
    expect(refreshed.run.id).toBe(first.run.id);
    expect(refreshed.snapshot?.version).toBe(1);
    expect(await services.intelligenceService.listRuns(project.id, owner.user.id)).toHaveLength(
      1,
    );
  });

  it("analyzes a new source without duplicating earlier entities", async () => {
    const { owner, project } = await projectWithBrief("Intelligence idempotency");

    const first = await services.intelligenceService.analyze(project.id, owner.user.id);
    const sourceId = await addRoadmap(project, owner.user.id);

    const refreshed = await services.intelligenceService.refresh(project.id, owner.user.id);

    expect(refreshed.run.trigger).toBe("REFRESH");
    expect(refreshed.run.sourceIds).toEqual([sourceId]);
    expect(refreshed.snapshot?.version).toBe(2);

    const features = await services.intelligenceService.listFeatures(
      project.id,
      owner.user.id,
    );
    const keys = features.map((feature) => feature.canonicalKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining(first.graph.features.map((feature) => feature.canonicalKey)),
    );
    expect(features.some((feature) => feature.name === "Guided onboarding")).toBe(true);

    const evidence = await services.intelligenceService.listEvidence(
      project.id,
      owner.user.id,
    );
    expect(evidence.length).toBeGreaterThan(first.graph.evidence.length);
    expect(
      evidence.every((item) => item.projectId === project.id && item.sourceId !== null),
    ).toBe(true);

    const runs = await services.intelligenceService.listRuns(project.id, owner.user.id);
    expect(runs.length).toBe(2);
    expect(runs.every((run) => run.status === "COMPLETED")).toBe(true);
  });

  it("keeps a user correction through a later re-analysis", async () => {
    const { owner, project } = await projectWithBrief("Intelligence corrections");

    await services.intelligenceService.analyze(project.id, owner.user.id);

    const corrected = await services.intelligenceService.correctProduct(
      project.id,
      owner.user.id,
      { name: "Northwind BI (corrected)", assertionKind: "USER_PROVIDED" },
    );

    expect(corrected?.name).toBe("Northwind BI (corrected)");
    expect(corrected?.userLocked).toBe(true);

    await addRoadmap(project, owner.user.id);
    const refreshed = await services.intelligenceService.refresh(project.id, owner.user.id);
    expect(refreshed.run.trigger).toBe("REFRESH");

    const after = await services.intelligenceService.getProduct(project.id, owner.user.id);
    expect(after?.name).toBe("Northwind BI (corrected)");
    expect(after?.userLocked).toBe(true);

    const features = await services.intelligenceService.listFeatures(
      project.id,
      owner.user.id,
    );
    expect(features.some((feature) => feature.name === "Guided onboarding")).toBe(true);

    const rows = await orm.IntelligenceProduct.where((row) =>
      row.projectId.eq(project.id),
    ).all();
    expect(rows).toHaveLength(1);
  });

  it("reconciles relationship rows to exactly the derived graph", async () => {
    const { owner, project } = await projectWithBrief("Intelligence edges");

    const first = await services.intelligenceService.analyze(project.id, owner.user.id);
    expect(first.graph.relationships.length).toBeGreaterThan(0);

    const dropped = first.graph.relationships[0]!;
    await orm.IntelligenceRelationship.where({ id: dropped.id }).delete();
    expect(
      (await orm.IntelligenceRelationship.where({ projectId: project.id }).all()).length,
    ).toBe(first.graph.relationships.length - 1);

    await addRoadmap(project, owner.user.id);
    const second = await services.intelligenceService.refresh(project.id, owner.user.id);
    expect(second.run.trigger).toBe("REFRESH");
    const rows = await orm.IntelligenceRelationship.where({ projectId: project.id }).all();

    expect(new Set(rows.map((row) => row.id))).toEqual(
      new Set(second.graph.relationships.map((edge) => edge.id)),
    );

    const entityIds = new Set([
      ...(second.graph.product ? [second.graph.product.id] : []),
      ...second.graph.features.map((item) => item.id),
      ...second.graph.problems.map((item) => item.id),
      ...second.graph.benefits.map((item) => item.id),
      ...second.graph.claims.map((item) => item.id),
      ...second.graph.evidence.map((item) => item.id),
      ...second.graph.audienceSignals.map((item) => item.id),
      ...second.graph.brandSignals.map((item) => item.id),
      ...second.graph.assets.map((item) => item.id),
      ...second.graph.workflows.map((item) => item.id),
    ]);

    expect(
      rows.every((row) => entityIds.has(row.fromId) && entityIds.has(row.toId)),
    ).toBe(true);

    await addTextSource(
      project,
      owner.user.id,
      "Changelog",
      ["# Changelog", "", "## Audit log", "", "Every dashboard change is recorded."].join("\n"),
    );
    const replay = await services.intelligenceService.refresh(project.id, owner.user.id);
    expect(replay.run.trigger).toBe("REFRESH");
    expect(
      (await orm.IntelligenceRelationship.where({ projectId: project.id }).all()).length,
    ).toBe(replay.graph.relationships.length);
  });

  it("persists corrections for every entity type and keeps them locked", async () => {
    const { owner, project } = await projectWithBrief("Intelligence entity corrections");

    const report = await services.intelligenceService.analyze(project.id, owner.user.id);
    const userId = owner.user.id;

    const feature = await services.intelligenceService.correctFeature(
      project.id,
      userId,
      report.graph.features[0]!.canonicalKey,
      { name: "Real-time dashboards (verified)", importance: "PRIMARY" },
    );
    expect(feature?.name).toBe("Real-time dashboards (verified)");
    expect(feature?.importance).toBe("PRIMARY");
    expect(feature?.userLocked).toBe(true);

    const claim = await services.intelligenceService.correctClaim(
      project.id,
      userId,
      report.graph.claims[0]!.canonicalKey,
      { text: "Exports any dashboard to CSV", assertionKind: "USER_PROVIDED" },
    );
    expect(claim?.text).toBe("Exports any dashboard to CSV");
    expect(claim?.userLocked).toBe(true);

    // Re-uploading the brief re-derives the same canonical keys, so only the
    // lock can preserve the corrected wording.
    await addTextSource(project, userId, "Product brief v2", BRIEF);
    const refreshed = await services.intelligenceService.refresh(project.id, userId);
    expect(refreshed.run.trigger).toBe("REFRESH");

    const features = await services.intelligenceService.listFeatures(project.id, userId);
    const kept = features.find((item) => item.id === feature!.id);
    expect(kept?.name).toBe("Real-time dashboards (verified)");
    expect(kept?.importance).toBe("PRIMARY");
    expect(kept?.userLocked).toBe(true);

    const claims = await services.intelligenceService.listClaims(project.id, userId);
    expect(claims.find((item) => item.id === claim!.id)?.text).toBe(
      "Exports any dashboard to CSV",
    );

    const rows = await orm.IntelligenceFeature.where((row) =>
      row.projectId.eq(project.id),
    ).all();
    expect(rows.filter((row) => row.userLocked)).toHaveLength(1);
  });

  it("rejects an entity correction across workspaces", async () => {
    const { owner, project } = await projectWithBrief("Intelligence correction scope");
    const report = await services.intelligenceService.analyze(project.id, owner.user.id);
    const stranger = await registerUser();

    const denied = await services.intelligenceService
      .correctFeature(project.id, stranger.user.id, report.graph.features[0]!.canonicalKey, {
        name: "Hijacked",
      })
      .catch((error: unknown) => error);

    expect(errorStatus(denied)).toBe(403);
    expect(
      (await services.intelligenceService.listFeatures(project.id, owner.user.id))[0]?.name,
    ).not.toBe("Hijacked");
  });

  it("removes intelligence rows when the project row is deleted", async () => {
    const { owner, project } = await projectWithBrief("Intelligence cascade");

    await services.intelligenceService.analyze(project.id, owner.user.id);

    expect(
      (await orm.IntelligenceFeature.where((row) => row.projectId.eq(project.id)).all())
        .length,
    ).toBeGreaterThan(0);

    await orm.Project.where({ id: project.id }).delete();

    expect(await orm.IntelligenceFeature.where((row) => row.projectId.eq(project.id)).all())
      .toHaveLength(0);
    expect(await orm.IntelligenceRun.where((row) => row.projectId.eq(project.id)).all())
      .toHaveLength(0);
    expect(await orm.IntelligenceSnapshot.where((row) => row.projectId.eq(project.id)).all())
      .toHaveLength(0);
  });

  it("rejects analysis and reads across workspaces", async () => {
    const { owner, project } = await projectWithBrief("Intelligence isolation");
    const stranger = await registerUser();

    await services.intelligenceService.analyze(project.id, owner.user.id);

    const deniedSummary = await services.intelligenceService
      .getSummary(project.id, stranger.user.id)
      .catch((error: unknown) => error);

    expect(errorStatus(deniedSummary)).toBe(403);

    const deniedFeatures = await services.intelligenceService
      .listFeatures(project.id, stranger.user.id)
      .catch((error: unknown) => error);

    expect(errorStatus(deniedFeatures)).toBe(403);

    const deniedAnalyze = await services.intelligenceService
      .analyze(project.id, stranger.user.id)
      .catch((error: unknown) => error);

    expect(errorStatus(deniedAnalyze)).toBe(403);

    const deniedRuns = await services.intelligenceService
      .listRuns(project.id, stranger.user.id)
      .catch((error: unknown) => error);

    expect(errorStatus(deniedRuns)).toBe(403);
  });

  it("persists extracted problems, benefits and workflows with their relationships", async () => {
    const { owner, project } = await projectWithNarrativeBrief("Intelligence narrative");
    const userId = owner.user.id;

    const report = await services.intelligenceService.analyze(project.id, userId);

    const problems = await services.intelligenceService.listProblems(project.id, userId);
    const benefits = await services.intelligenceService.listBenefits(project.id, userId);
    const workflows = await services.intelligenceService.listWorkflows(project.id, userId);
    expect(problems.length).toBeGreaterThan(0);
    expect(benefits.length).toBeGreaterThan(0);
    expect(workflows.length).toBeGreaterThan(0);

    for (const problem of problems) {
      expect(problem.projectId).toBe(project.id);
      expect(problem.canonicalKey).toMatch(/^problem:/);
      expect(problem.name.length).toBeGreaterThan(3);
      expect(problem.provenance?.sourceIds ?? []).toEqual([expect.any(String)]);
      expect(problem.provenance?.evidenceIds?.length ?? 0).toBeGreaterThan(0);
      expect(problem.provenance?.method).toBe("DETERMINISTIC");
    }
    for (const benefit of benefits) {
      expect(benefit.projectId).toBe(project.id);
      expect(benefit.canonicalKey).toMatch(/^benefit:/);
      expect(benefit.provenance?.evidenceIds?.length ?? 0).toBeGreaterThan(0);
    }
    for (const workflow of workflows) {
      expect(workflow.projectId).toBe(project.id);
      expect(workflow.canonicalKey).toMatch(/^workflow:/);
      expect(workflow.steps.length).toBeGreaterThanOrEqual(3);
      expect(workflow.steps.map((step) => step.order)).toEqual([1, 2, 3, 4]);
      expect(workflow.provenance?.evidenceIds?.length ?? 0).toBeGreaterThan(0);
    }

    const problemKeys = new Set(problems.map((problem) => problem.canonicalKey));
    const benefitKeys = new Set(benefits.map((benefit) => benefit.canonicalKey));
    const workflowKeys = new Set(workflows.map((workflow) => workflow.canonicalKey));

    const featureIds = new Set(report.graph.features.map((feature) => feature.id));
    const problemIds = new Set(problems.map((problem) => problem.id));
    const benefitIds = new Set(benefits.map((benefit) => benefit.id));
    const workflowIds = new Set(workflows.map((workflow) => workflow.id));
    expect(problemKeys.size).toBe(problemIds.size);
    expect(benefitKeys.size).toBe(benefitIds.size);
    expect(workflowKeys.size).toBe(workflowIds.size);

    const solves = report.graph.relationships.filter(
      (edge) => edge.type === "FEATURE_SOLVES_PROBLEM",
    );
    const provides = report.graph.relationships.filter(
      (edge) => edge.type === "FEATURE_PROVIDES_BENEFIT",
    );
    const uses = report.graph.relationships.filter(
      (edge) => edge.type === "WORKFLOW_USES_FEATURE",
    );
    expect(solves.length).toBeGreaterThan(0);
    expect(provides.length).toBeGreaterThan(0);
    expect(uses.length).toBeGreaterThan(0);
    for (const edge of solves) {
      expect(edge.fromType).toBe("FEATURE");
      expect(featureIds.has(edge.fromId)).toBe(true);
      expect(problemIds.has(edge.toId)).toBe(true);
    }
    for (const edge of provides) {
      expect(featureIds.has(edge.fromId)).toBe(true);
      expect(benefitIds.has(edge.toId)).toBe(true);
    }
    for (const edge of uses) {
      expect(workflowIds.has(edge.fromId)).toBe(true);
      expect(featureIds.has(edge.toId)).toBe(true);
    }

    const storedProblems = await orm.IntelligenceProblem.where((row) =>
      row.projectId.eq(project.id),
    ).all();
    const storedBenefits = await orm.IntelligenceBenefit.where((row) =>
      row.projectId.eq(project.id),
    ).all();
    const storedWorkflows = await orm.IntelligenceWorkflow.where((row) =>
      row.projectId.eq(project.id),
    ).all();
    expect(storedProblems).toHaveLength(problems.length);
    expect(storedBenefits).toHaveLength(benefits.length);
    expect(storedWorkflows).toHaveLength(workflows.length);

    const steps = await orm.IntelligenceWorkflowStep.where((row) =>
      row.workflowId.eq(storedWorkflows[0]!.id),
    ).all();
    expect(steps).toHaveLength(workflows[0]!.steps.length);
    expect(steps.map((step) => step.order)).toEqual([1, 2, 3, 4]);
    expect(steps.some((step) => step.featureIds.length > 0)).toBe(true);

    const summary = await services.intelligenceService.getSummary(project.id, userId);
    expect(summary.counts.problems).toBe(problems.length);
    expect(summary.counts.benefits).toBe(benefits.length);
    expect(summary.counts.workflows).toBe(workflows.length);
  });

  it("does not duplicate a narrative entity named by a second source", async () => {
    const { owner, project } = await projectWithNarrativeBrief("Intelligence narrative dedup");
    const userId = owner.user.id;

    const first = await services.intelligenceService.analyze(project.id, userId);
    const beforeProblems = await services.intelligenceService.listProblems(project.id, userId);
    const beforeBenefits = await services.intelligenceService.listBenefits(project.id, userId);
    const beforeWorkflows = await services.intelligenceService.listWorkflows(project.id, userId);

    await addTextSource(project, userId, "Repeated brief", NARRATIVE_BRIEF);
    const second = await services.intelligenceService.refresh(project.id, userId);
    expect(second.run.trigger).toBe("REFRESH");

    const afterProblems = await services.intelligenceService.listProblems(project.id, userId);
    const afterBenefits = await services.intelligenceService.listBenefits(project.id, userId);
    const afterWorkflows = await services.intelligenceService.listWorkflows(project.id, userId);

    expect(afterProblems).toHaveLength(beforeProblems.length);
    expect(afterBenefits).toHaveLength(beforeBenefits.length);
    expect(afterWorkflows).toHaveLength(beforeWorkflows.length);
    expect(new Set(afterProblems.map((item) => item.canonicalKey)).size).toBe(
      afterProblems.length,
    );
    expect(new Set(afterBenefits.map((item) => item.canonicalKey)).size).toBe(
      afterBenefits.length,
    );
    expect(new Set(afterWorkflows.map((item) => item.canonicalKey)).size).toBe(
      afterWorkflows.length,
    );

    // The repeat is a second piece of evidence for the same entities, so the
    // ids stay put and the provenance unions.
    const merged = afterProblems.find((item) => item.id === beforeProblems[0]!.id);
    expect(merged).toBeTruthy();
    expect(
      (merged!.provenance?.sourceIds?.length ?? 0) >=
        (beforeProblems[0]!.provenance?.sourceIds?.length ?? 0),
    ).toBe(true);
    expect(first.graph.problems.length).toBe(beforeProblems.length);
  });

  it("adds narrative entities incrementally when a new source states them", async () => {
    const { owner, project } = await projectWithNarrativeBrief("Intelligence narrative refresh");
    const userId = owner.user.id;

    const first = await services.intelligenceService.analyze(project.id, userId);
    const beforeProblems = first.graph.problems.length;
    const beforeBenefits = first.graph.benefits.length;
    const beforeWorkflows = first.graph.workflows.length;

    await addTextSource(
      project,
      userId,
      "Support notes",
      [
        "# Support notes",
        "",
        "## Escalations",
        "",
        "Support agents lose track of which launch a customer is blocked on.",
      ].join("\n"),
    );
    const second = await services.intelligenceService.refresh(project.id, userId);
    expect(second.run.trigger).toBe("REFRESH");
    expect(second.snapshot?.version).toBe(2);

    const afterProblems = await services.intelligenceService.listProblems(project.id, userId);
    const afterBenefits = await services.intelligenceService.listBenefits(project.id, userId);
    const afterWorkflows = await services.intelligenceService.listWorkflows(project.id, userId);
    expect(afterProblems.length).toBeGreaterThanOrEqual(beforeProblems);
    expect(afterBenefits.length).toBeGreaterThanOrEqual(beforeBenefits);
    expect(afterWorkflows.length).toBeGreaterThanOrEqual(beforeWorkflows);
    expect(
      afterProblems.some((problem) => /track|launch|customer|blocked/i.test(problem.name)),
    ).toBe(true);
    expect(second.graph.problems.length).toBe(afterProblems.length);
  });

  it("keeps a corrected problem, benefit and workflow through a refresh", async () => {
    const { owner, project } = await projectWithNarrativeBrief("Intelligence narrative corrections");
    const userId = owner.user.id;

    const report = await services.intelligenceService.analyze(project.id, userId);

    const problem = await services.intelligenceService.correctProblem(
      project.id,
      userId,
      report.graph.problems[0]!.canonicalKey,
      { name: "Rewriting every channel by hand (verified)" },
    );
    expect(problem?.name).toBe("Rewriting every channel by hand (verified)");
    expect(problem?.userLocked).toBe(true);

    const benefit = await services.intelligenceService.correctBenefit(
      project.id,
      userId,
      report.graph.benefits[0]!.canonicalKey,
      { name: "One brief for every channel (verified)" },
    );
    expect(benefit?.name).toBe("One brief for every channel (verified)");
    expect(benefit?.userLocked).toBe(true);

    const workflow = await services.intelligenceService.correctWorkflow(
      project.id,
      userId,
      report.graph.workflows[0]!.canonicalKey,
      { name: "Launch publishing flow (verified)" },
    );
    expect(workflow?.name).toBe("Launch publishing flow (verified)");
    expect(workflow?.userLocked).toBe(true);

    await addTextSource(project, userId, "Launch brief v2", NARRATIVE_BRIEF);
    const refreshed = await services.intelligenceService.refresh(project.id, userId);
    expect(refreshed.run.trigger).toBe("REFRESH");

    const problems = await services.intelligenceService.listProblems(project.id, userId);
    const benefits = await services.intelligenceService.listBenefits(project.id, userId);
    const workflows = await services.intelligenceService.listWorkflows(project.id, userId);
    expect(problems.find((item) => item.id === problem!.id)?.name).toBe(
      "Rewriting every channel by hand (verified)",
    );
    expect(benefits.find((item) => item.id === benefit!.id)?.name).toBe(
      "One brief for every channel (verified)",
    );
    expect(workflows.find((item) => item.id === workflow!.id)?.name).toBe(
      "Launch publishing flow (verified)",
    );
    expect(
      workflows.find((item) => item.id === workflow!.id)?.steps.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
  });

  it("rejects narrative reads and corrections across workspaces", async () => {
    const { owner, project } = await projectWithNarrativeBrief("Intelligence narrative isolation");
    const report = await services.intelligenceService.analyze(project.id, owner.user.id);
    const stranger = await registerUser();

    // Awaited one at a time so each rejection is handled before the next call,
    // rather than leaving a floating rejected promise behind.
    const deniedReads = await services.intelligenceService
      .listProblems(project.id, stranger.user.id)
      .catch((error: unknown) => error);
    expect(errorStatus(deniedReads)).toBe(403);

    const deniedBenefits = await services.intelligenceService
      .listBenefits(project.id, stranger.user.id)
      .catch((error: unknown) => error);
    expect(errorStatus(deniedBenefits)).toBe(403);

    const deniedWorkflows = await services.intelligenceService
      .listWorkflows(project.id, stranger.user.id)
      .catch((error: unknown) => error);
    expect(errorStatus(deniedWorkflows)).toBe(403);

    const deniedCorrection = await services.intelligenceService
      .correctProblem(
        project.id,
        stranger.user.id,
        report.graph.problems[0]!.canonicalKey,
        { name: "Hijacked" },
      )
      .catch((error: unknown) => error);
    expect(errorStatus(deniedCorrection)).toBe(403);

    const problems = await services.intelligenceService.listProblems(
      project.id,
      owner.user.id,
    );
    expect(problems.some((item) => item.name === "Hijacked")).toBe(false);
  });

  it("fails the run when a project has no readable sources", async () => {
    const owner = await registerUser();
    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Intelligence empty" },
      owner.user.id,
    );

    const failure = await services.intelligenceService
      .analyze(project.id, owner.user.id)
      .catch((error: unknown) => error);

    expect((failure as { code?: string }).code).toBe("INTELLIGENCE_INVALID_INPUT");
    expect(await orm.IntelligenceRun.where((run) => run.projectId.eq(project.id)).all())
      .toHaveLength(0);
  });
});

describe("intelligence API integration", () => {
  async function analyzedProject() {
    const owner = await registerUser();
    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Intelligence API" },
      owner.user.id,
    );
    await services.inputService.createBatch(project.id, owner.user.id, [
      { type: "text", name: "API brief", value: INTELLIGENCE_BRIEF },
    ]);
    await services.intelligenceService.analyze(project.id, owner.user.id);
    return { owner, project };
  }

  it("analyzes, reads and corrects over HTTP", async () => {
    const { owner, project } = await analyzedProject();
    const { GET: GET_INTELLIGENCE } = await import(
      "../../app/api/projects/[id]/intelligence/route"
    );
    const { POST: POST_CORRECTIONS } = await import(
      "../../app/api/projects/[id]/intelligence/corrections/route"
    );
    const { POST: POST_ANALYZE } = await import(
      "../../app/api/projects/[id]/intelligence/analyze/route"
    );
    const { POST: POST_REFRESH } = await import(
      "../../app/api/projects/[id]/intelligence/refresh/route"
    );
    const headers = { cookie: `content_os_session=${owner.token}` };
    const json = { ...headers, "content-type": "application/json" };
    const context = { params: Promise.resolve({ id: project.id }) };

    const readResponse = await GET_INTELLIGENCE(
      new Request("http://localhost/api/projects/p/intelligence", { headers }),
      context,
    );
    expect(readResponse.status).toBe(200);
    const payload = (await readResponse.json()) as {
      summary: { counts: { features: number } };
      graph: { features: Array<{ canonicalKey: string; name: string }> };
      runs: Array<{ status: string }>;
      snapshots: Array<{ version: number }>;
    };
    expect(payload.summary.counts.features).toBeGreaterThan(0);
    expect(payload.graph.features.length).toBeGreaterThan(0);
    expect(payload.runs[0]?.status).toBe("COMPLETED");
    expect(payload.snapshots[0]?.version).toBe(1);

    const noChange = await POST_REFRESH(
      new Request("http://localhost/api/projects/p/intelligence/refresh", {
        method: "POST",
        headers,
      }),
      context,
    );
    expect(noChange.status).toBe(200);
    expect((await noChange.json()).notes).toContain(
      "No new or changed sources since the last analysis",
    );

    const analyzeResponse = await POST_ANALYZE(
      new Request("http://localhost/api/projects/p/intelligence/analyze", {
        method: "POST",
        headers: json,
        body: JSON.stringify({}),
      }),
      context,
    );
    expect(analyzeResponse.status).toBe(200);
    const analyzed = (await analyzeResponse.json()) as { run: { trigger: string } };
    expect(analyzed.run.trigger).toBe("MANUAL");

    const target = payload.graph.features[0]!;
    const correctResponse = await POST_CORRECTIONS(
      new Request("http://localhost/api/projects/p/intelligence/corrections", {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          scope: "FEATURE",
          canonicalKey: target.canonicalKey,
          name: "Corrected over HTTP",
          importance: "PRIMARY",
        }),
      }),
      context,
    );
    expect(correctResponse.status).toBe(200);
    const corrected = (await correctResponse.json()) as {
      entity: { name: string; importance: string; userLocked: boolean };
    };
    expect(corrected.entity).toMatchObject({
      name: "Corrected over HTTP",
      importance: "PRIMARY",
      userLocked: true,
    });

    const productResponse = await POST_CORRECTIONS(
      new Request("http://localhost/api/projects/p/intelligence/corrections", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ scope: "product", name: "Northwind API" }),
      }),
      context,
    );
    expect(productResponse.status).toBe(200);

    const after = await GET_INTELLIGENCE(
      new Request("http://localhost/api/projects/p/intelligence", { headers }),
      context,
    );
    const afterPayload = (await after.json()) as {
      summary: { product: { name: string } };
      graph: { features: Array<{ name: string }> };
    };
    expect(afterPayload.summary.product.name).toBe("Northwind API");
    expect(afterPayload.graph.features.map((item) => item.name)).toContain(
      "Corrected over HTTP",
    );
  });

  it("returns extracted narrative entities over HTTP and corrects them", async () => {
    const owner = await registerUser();
    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Intelligence API narrative" },
      owner.user.id,
    );
    await services.inputService.createBatch(project.id, owner.user.id, [
      { type: "text", name: "Launch brief", value: NARRATIVE_BRIEF },
    ]);

    const { POST: POST_ANALYZE } = await import(
      "../../app/api/projects/[id]/intelligence/analyze/route"
    );
    const { GET: GET_INTELLIGENCE } = await import(
      "../../app/api/projects/[id]/intelligence/route"
    );
    const { POST: POST_CORRECTIONS } = await import(
      "../../app/api/projects/[id]/intelligence/corrections/route"
    );
    const headers = { cookie: `content_os_session=${owner.token}` };
    const json = { ...headers, "content-type": "application/json" };
    const context = { params: Promise.resolve({ id: project.id }) };
    const url = "http://localhost/api/projects/p/intelligence";

    const analyzed = await POST_ANALYZE(
      new Request(`${url}/analyze`, { method: "POST", headers: json, body: "{}" }),
      context,
    );
    expect(analyzed.status).toBe(200);

    const read = await GET_INTELLIGENCE(new Request(url, { headers }), context);
    expect(read.status).toBe(200);
    const payload = (await read.json()) as {
      summary: { counts: { problems: number; benefits: number; workflows: number } };
      graph: {
        problems: Array<{ id: string; canonicalKey: string; name: string; provenance: { evidenceIds: string[] } | null }>;
        benefits: Array<{ id: string; canonicalKey: string; name: string }>;
        workflows: Array<{
          id: string;
          canonicalKey: string;
          name: string;
          steps: Array<{ order: number; action: string }>;
        }>;
        relationships: Array<{ type: string; fromId: string; toId: string }>;
      };
    };

    expect(payload.summary.counts.problems).toBeGreaterThan(0);
    expect(payload.summary.counts.benefits).toBeGreaterThan(0);
    expect(payload.summary.counts.workflows).toBeGreaterThan(0);
    expect(payload.graph.problems.length).toBeGreaterThan(0);
    expect(payload.graph.benefits.length).toBeGreaterThan(0);
    expect(payload.graph.workflows.length).toBeGreaterThan(0);
    expect(payload.graph.problems[0]?.provenance?.evidenceIds.length ?? 0).toBeGreaterThan(0);
    expect(payload.graph.workflows[0]?.steps.length ?? 0).toBeGreaterThanOrEqual(3);

    const problemIds = new Set(payload.graph.problems.map((problem) => problem.id));
    const benefitIds = new Set(payload.graph.benefits.map((benefit) => benefit.id));
    const workflowIds = new Set(payload.graph.workflows.map((workflow) => workflow.id));
    const featureIds = new Set(
      payload.graph.relationships
        .filter((edge) => edge.type === "FEATURE_SOLVES_PROBLEM")
        .map((edge) => edge.fromId),
    );
    for (const edge of payload.graph.relationships.filter(
      (item) => item.type === "FEATURE_SOLVES_PROBLEM",
    )) {
      expect(featureIds.has(edge.fromId)).toBe(true);
      expect(problemIds.has(edge.toId)).toBe(true);
    }
    expect(
      payload.graph.relationships.filter((edge) => edge.type === "FEATURE_PROVIDES_BENEFIT").every(
        (edge) => benefitIds.has(edge.toId),
      ),
    ).toBe(true);
    expect(
      payload.graph.relationships.filter((edge) => edge.type === "WORKFLOW_USES_FEATURE").every(
        (edge) => workflowIds.has(edge.fromId),
      ),
    ).toBe(true);

    const problemResponse = await POST_CORRECTIONS(
      new Request(url, {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          scope: "PROBLEM",
          canonicalKey: payload.graph.problems[0]!.canonicalKey,
          name: "Manual per-channel rewriting (verified over HTTP)",
        }),
      }),
      context,
    );
    expect(problemResponse.status).toBe(200);
    expect(
      ((await problemResponse.json()) as { entity: { name: string; userLocked: boolean } })
        .entity,
    ).toMatchObject({ name: "Manual per-channel rewriting (verified over HTTP)", userLocked: true });

    const workflowResponse = await POST_CORRECTIONS(
      new Request(url, {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          scope: "WORKFLOW",
          canonicalKey: payload.graph.workflows[0]!.canonicalKey,
          name: "Launch publishing flow (verified over HTTP)",
        }),
      }),
      context,
    );
    expect(workflowResponse.status).toBe(200);

    const afterRead = await GET_INTELLIGENCE(new Request(url, { headers }), context);
    const afterPayload = (await afterRead.json()) as {
      graph: {
        problems: Array<{ name: string }>;
        workflows: Array<{ name: string; steps: Array<{ order: number }> }>;
      };
    };
    expect(afterPayload.graph.problems.map((item) => item.name)).toContain(
      "Manual per-channel rewriting (verified over HTTP)",
    );
    expect(afterPayload.graph.workflows.map((item) => item.name)).toContain(
      "Launch publishing flow (verified over HTTP)",
    );
    expect(afterPayload.graph.workflows[0]?.steps.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("rejects unauthenticated, cross-origin and invalid requests", async () => {
    const { owner, project } = await analyzedProject();
    const { GET: GET_INTELLIGENCE } = await import(
      "../../app/api/projects/[id]/intelligence/route"
    );
    const { POST: POST_CORRECTIONS } = await import(
      "../../app/api/projects/[id]/intelligence/corrections/route"
    );
    const { POST: POST_ANALYZE } = await import(
      "../../app/api/projects/[id]/intelligence/analyze/route"
    );
    const context = { params: Promise.resolve({ id: project.id }) };
    const url = "http://localhost/api/projects/p/intelligence";

    const anonymous = await GET_INTELLIGENCE(new Request(url), context);
    expect(anonymous.status).toBe(401);

    const stranger = await registerUser();
    const strangerHeaders = { cookie: `content_os_session=${stranger.token}` };
    const denied = await GET_INTELLIGENCE(new Request(url, { headers: strangerHeaders }), context);
    expect(denied.status).toBe(403);

    const crossOrigin = await POST_ANALYZE(
      new Request(url, {
        method: "POST",
        headers: { ...strangerHeaders, origin: "https://evil.test" },
      }),
      context,
    );
    expect(crossOrigin.status).toBe(403);

    const ownerHeaders = { cookie: `content_os_session=${owner.token}` };
    const invalidScope = await POST_CORRECTIONS(
      new Request(url, {
        method: "POST",
        headers: { ...ownerHeaders, "content-type": "application/json" },
        body: JSON.stringify({ scope: "EVIDENCE" }),
      }),
      context,
    );
    expect(invalidScope.status).toBe(400);

    const missingKey = await POST_CORRECTIONS(
      new Request(url, {
        method: "POST",
        headers: { ...ownerHeaders, "content-type": "application/json" },
        body: JSON.stringify({ scope: "FEATURE", name: "Nope" }),
      }),
      context,
    );
    expect(missingKey.status).toBe(400);

    const unknownEntity = await POST_CORRECTIONS(
      new Request(url, {
        method: "POST",
        headers: { ...ownerHeaders, "content-type": "application/json" },
        body: JSON.stringify({ scope: "FEATURE", canonicalKey: "feature:missing", name: "Nope" }),
      }),
      context,
    );
    expect(unknownEntity.status).toBe(404);
  });
});

/**
 * Browser agent HTTP boundary.
 *
 * These tests deliberately stop at the API and policy boundary: the Chromium
 * path is covered end to end in playwright-runtime.test.ts, and a full run
 * against a local fixture would require relaxing the loopback policy that
 * protects production targets. What is verified here is that a caller cannot
 * authenticate their way to a target the project never declared.
 */
describe("browser session repository integration", () => {
  async function browserFixture() {
    const owner = await registerUser();
    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Browser Repository" },
      owner.user.id,
    );
    const target = await services.sourceService.create(
      project.id,
      {
        type: "WEBSITE",
        name: "Docs site",
        uri: "https://repo.example.com/docs",
        metadata: null,
      },
      owner.user.id,
    );
    return { owner, project, target };
  }

  it("persists a session, its steps, observations and cancellation", async () => {
    const [{ db }, repositories] = await Promise.all([
      import("../../prisma/db"),
      import("../../infrastructure/repositories/postgres-browser-session-repository"),
    ]);
    const repository = new repositories.PostgresBrowserSessionRepository(db.orm.public);
    const { project, target } = await browserFixture();
    const sessionId = `brs_${Math.random().toString(36).slice(2, 12)}`;

    const created = await repository.createSession({
      id: sessionId,
      projectId: project.id,
      targetSourceId: target.id,
      targetClass: "PUBLIC",
      initialUrl: target.uri!,
      goal: "Read the docs index",
      successCriteria: 'text contains "Docs"',
      status: "RUNNING",
    });
    expect(created.status).toBe("RUNNING");
    expect(created.actionCount).toBe(0);

    // A second row for the same id must not silently duplicate history.
    const duplicateId = `brs_${Math.random().toString(36).slice(2, 12)}`;
    const duplicate = await repository.createSession({
      id: duplicateId,
      projectId: project.id,
      targetSourceId: target.id,
      targetClass: "PUBLIC",
      initialUrl: target.uri!,
      goal: "Duplicate write",
      successCriteria: null,
      status: "RUNNING",
    });
    expect(duplicate.id).toBe(duplicateId);

    const running = await repository.updateSessionState(project.id, sessionId, {
      status: "RUNNING",
      currentUrl: "https://repo.example.com/docs/intro",
      pageCount: 2,
      actionCount: 1,
      startedAt: new Date().toISOString(),
      endedAt: null,
      errorCode: null,
      errorMessage: null,
    });
    expect(running.pageCount).toBe(2);
    expect(running.actionCount).toBe(1);

    const step = {
      order: 1,
      actionType: "GOTO" as const,
      targetSummary: null,
      inputSummary: "https://repo.example.com/docs/intro",
      status: "COMPLETED" as const,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 12,
      pageStateHashBefore: "before",
      pageStateHashAfter: "after",
      result: "ok",
      errorCode: null,
      errorMessage: null,
    };
    await repository.appendStep(project.id, sessionId, step);

    await repository.recordObservation({
      sessionId,
      stepOrder: 1,
      pageId: "page-1",
      url: "https://repo.example.com/docs/intro",
      title: "Docs intro",
      pageStateHash: "after",
      payload: JSON.stringify({ url: "https://repo.example.com/docs/intro", title: "Docs intro", pageText: "Docs" }),
    });

    const trace = await repository.getTrace(project.id, sessionId);
    expect(trace?.steps).toHaveLength(1);
    expect(trace?.steps[0]?.actionType).toBe("GOTO");

    const observations = await repository.listObservations(project.id, sessionId);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.title).toBe("Docs intro");
    expect(JSON.parse(observations[0]!.payload) as { pageText: string }).toMatchObject({ pageText: "Docs" });

    const listed = await repository.listSessions(project.id);
    expect(listed.map((row) => row.id)).toContain(sessionId);
    expect(listed.map((row) => row.id)).toContain(duplicateId);

    const cancelled = await repository.cancelSession(project.id, sessionId);
    expect(cancelled?.status).toBe("CANCELLED");
    expect(cancelled?.endedAt).not.toBeNull();

    // Terminal sessions never reopen, and re-cancelling is a no-op.
    await expect(
      repository.updateSessionState(project.id, sessionId, {
        status: "RUNNING",
        currentUrl: cancelled!.currentUrl,
        pageCount: 2,
        actionCount: 2,
        startedAt: cancelled!.startedAt,
        endedAt: null,
        errorCode: null,
        errorMessage: null,
      }),
    ).rejects.toThrow(/Illegal session transition/);
    expect((await repository.cancelSession(project.id, sessionId))?.status).toBe("CANCELLED");

    // Another project cannot see or touch these rows.
    const stranger = await browserFixture();
    expect(await repository.getSession(stranger.project.id, sessionId)).toBeNull();
    expect(await repository.getTrace(stranger.project.id, sessionId)).toBeNull();
    expect(await repository.listObservations(stranger.project.id, sessionId)).toEqual([]);
    await expect(
      repository.updateSessionState(stranger.project.id, sessionId, {
        status: "CANCELLED",
        currentUrl: "https://evil.example.com",
        pageCount: 0,
        actionCount: 0,
        startedAt: null,
        endedAt: new Date().toISOString(),
        errorCode: null,
        errorMessage: null,
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("browser agent API integration", () => {
  async function browserProject() {
    const owner = await registerUser();
    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Browser API" },
      owner.user.id,
    );
    const target = await services.sourceService.create(
      project.id,
      {
        type: "WEBSITE",
        name: "Launch site",
        uri: "https://launch.example.com/docs",
        metadata: null,
      },
      owner.user.id,
    );
    return { owner, project, target };
  }

  it("serves parsed observations for a scoped session", async () => {
    const { db } = await import("../../prisma/db");
    const { project, target, owner } = await browserProject();
    const repositories = await import("../../infrastructure/repositories/postgres-browser-session-repository");
    const repository = new repositories.PostgresBrowserSessionRepository(db.orm.public);
    const sessionId = `brs_${Math.random().toString(36).slice(2, 12)}`;

    await repository.createSession({
      id: sessionId,
      projectId: project.id,
      targetSourceId: target.id,
      targetClass: "PUBLIC",
      initialUrl: target.uri!,
      goal: "Observe the docs page",
      successCriteria: null,
      status: "COMPLETED",
    });
    await repository.recordObservation({
      sessionId,
      stepOrder: 1,
      pageId: "page-1",
      url: target.uri!,
      title: "Docs",
      pageStateHash: "hash-1",
      payload: JSON.stringify({ url: target.uri, title: "Docs", pageText: "Docs index", interactiveElements: [] }),
    });

    const { GET } = await import("../../app/api/projects/[id]/browser/sessions/[sessionId]/observations/route");
    const context = { params: Promise.resolve({ id: project.id, sessionId }) };
    const headers = { cookie: `content_os_session=${owner.token}` };
    const url = "http://localhost/api/projects/p/browser/sessions/s/observations";

    const response = await GET(new Request(url, { headers }), context);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      observations: { url: string; title: string; payload: { pageText: string } }[];
    };
    expect(body.observations).toHaveLength(1);
    // Structured, not a serialized string the client has to re-parse.
    expect(typeof body.observations[0]?.payload).toBe("object");
    expect(body.observations[0]?.payload.pageText).toBe("Docs index");
    expect(body.observations[0]?.url).toBe(target.uri);

    const anonymous = await GET(new Request(url), context);
    expect(anonymous.status).toBe(401);

    const stranger = await registerUser();
    // A stranger is refused by project authorization, not by a leaked 200.
    const denied = await GET(
      new Request(url, { headers: { cookie: `content_os_session=${stranger.token}` } }),
      context,
    );
    expect(denied.status).toBe(403);
  });

  it("refuses unauthenticated, cross-origin and cross-project run requests", async () => {
    const { owner, project, target } = await browserProject();
    const { POST } = await import("../../app/api/projects/[id]/browser/run/route");
    const context = { params: Promise.resolve({ id: project.id }) };
    const url = "http://localhost/api/projects/p/browser/run";
    const body = { targetSourceId: target.id, url: target.uri, goal: "Create a project" };

    const anonymous = await POST(
      new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      context,
    );
    expect(anonymous.status).toBe(401);

    const stranger = await registerUser();
    const strangerHeaders = { cookie: `content_os_session=${stranger.token}`, "content-type": "application/json" };
    const denied = await POST(
      new Request(url, { method: "POST", headers: strangerHeaders, body: JSON.stringify(body) }),
      context,
    );
    expect(denied.status).toBe(403);

    const crossOrigin = await POST(
      new Request(url, {
        method: "POST",
        headers: { ...strangerHeaders, origin: "https://evil.test" },
        body: JSON.stringify(body),
      }),
      context,
    );
    expect(crossOrigin.status).toBe(403);

    const ownerHeaders = { cookie: `content_os_session=${owner.token}`, "content-type": "application/json" };
    const foreignTarget = await POST(
      new Request(url, {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({ ...body, targetSourceId: "source_not_in_project" }),
      }),
      context,
    );
    expect(foreignTarget.status).toBe(404);
  });

  it("refuses a start URL that leaves the target source origin", async () => {
    const { owner, project, target } = await browserProject();
    const { POST } = await import("../../app/api/projects/[id]/browser/run/route");
    const response = await POST(
      new Request("http://localhost/api/projects/p/browser/run", {
        method: "POST",
        headers: { cookie: `content_os_session=${owner.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          targetSourceId: target.id,
          url: "https://elsewhere.example.org/",
          goal: "Create a project",
        }),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("origin");
  });

  it("refuses a target source without a browsable URL", async () => {
    const { owner, project } = await browserProject();
    const document = await services.sourceService.create(
      project.id,
      {
        type: "DOCUMENT",
        name: "Brief",
        uri: "content-os-storage://local/brief.md",
        metadata: null,
      },
      owner.user.id,
    );
    const { POST } = await import("../../app/api/projects/[id]/browser/run/route");
    const response = await POST(
      new Request("http://localhost/api/projects/p/browser/run", {
        method: "POST",
        headers: { cookie: `content_os_session=${owner.token}`, "content-type": "application/json" },
        body: JSON.stringify({ targetSourceId: document.id, goal: "Read the brief" }),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(response.status).toBe(400);
  });

  it("refuses a target that resolves to cloud metadata", async () => {
    const owner = await registerUser();
    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Metadata target" },
      owner.user.id,
    );
    const target = await services.sourceService.create(
      project.id,
      {
        type: "WEBSITE",
        name: "Metadata",
        uri: "http://169.254.169.254/latest/meta-data",
        metadata: null,
      },
      owner.user.id,
    );
    const { POST } = await import("../../app/api/projects/[id]/browser/run/route");
    const response = await POST(
      new Request("http://localhost/api/projects/p/browser/run", {
        method: "POST",
        headers: { cookie: `content_os_session=${owner.token}`, "content-type": "application/json" },
        body: JSON.stringify({ targetSourceId: target.id, goal: "Read instance metadata" }),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/non-public|blocked/i);
    // A refused target must not leave a session behind.
    const sessions = await services.browserService.listSessions(project.id, owner.user.id);
    expect(sessions).toEqual([]);
  });

  it("keeps session reads scoped to the owning workspace", async () => {
    const { owner, project } = await browserProject();
    const stranger = await registerUser();
    const { GET } = await import("../../app/api/projects/[id]/browser/sessions/route");
    const { GET: GET_SESSION } = await import(
      "../../app/api/projects/[id]/browser/sessions/[sessionId]/route"
    );
    const { POST: POST_CANCEL } = await import(
      "../../app/api/projects/[id]/browser/sessions/[sessionId]/cancel/route"
    );
    const { GET: GET_OBSERVATIONS } = await import(
      "../../app/api/projects/[id]/browser/sessions/[sessionId]/observations/route"
    );
    const context = { params: Promise.resolve({ id: project.id }) };
    const ownerHeaders = { cookie: `content_os_session=${owner.token}` };
    const strangerHeaders = { cookie: `content_os_session=${stranger.token}` };

    const ownerList = await GET(
      new Request("http://localhost/api/projects/p/browser/sessions", { headers: ownerHeaders }),
      context,
    );
    expect(ownerList.status).toBe(200);
    expect((await ownerList.json()).sessions).toEqual([]);

    const strangerList = await GET(
      new Request("http://localhost/api/projects/p/browser/sessions", { headers: strangerHeaders }),
      context,
    );
    expect(strangerList.status).toBe(403);

    const sessionContext = {
      params: Promise.resolve({ id: project.id, sessionId: "bse_missing" }),
    };
    for (const route of [GET_SESSION, GET_OBSERVATIONS]) {
      const anonymous = await route(
        new Request("http://localhost/api/projects/p/browser/sessions/bse_missing"),
        sessionContext,
      );
      expect(anonymous.status).toBe(401);

      // A stranger is refused at the project boundary, before any lookup.
      const denied = await route(
        new Request("http://localhost/api/projects/p/browser/sessions/bse_missing", { headers: strangerHeaders }),
        sessionContext,
      );
      expect(denied.status).toBe(403);

      // A member of the project gets 404 for a session that does not exist,
      // which keeps the response identical for a wrong id in a real project.
      const missing = await route(
        new Request("http://localhost/api/projects/p/browser/sessions/bse_missing", { headers: ownerHeaders }),
        sessionContext,
      );
      expect(missing.status).toBe(404);
    }

    const cancelDenied = await POST_CANCEL(
      new Request("http://localhost/api/projects/p/browser/sessions/bse_missing/cancel", {
        method: "POST",
        headers: { ...strangerHeaders, origin: "https://evil.test" },
      }),
      sessionContext,
    );
    expect(cancelDenied.status).toBe(403);

    const cancelMissing = await POST_CANCEL(
      new Request("http://localhost/api/projects/p/browser/sessions/bse_missing/cancel", {
        method: "POST",
        headers: ownerHeaders,
      }),
      sessionContext,
    );
    expect(cancelMissing.status).toBe(404);
  });
});
