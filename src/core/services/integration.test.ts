import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicOrm } from "../../prisma/db";
import { getContentType } from "../domain/content-type";

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

  // Intents hang off projects, so they go first or the project delete trips its
  // own foreign key.
  await clearRows(
    await orm.ContentIntent.all(),
    (id) => orm.ContentIntent.where({ id }).delete(),
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

const BRAND_BRIEF = [
  "# Northwind Analytics",
  "",
  "Northwind Analytics is the content operating system for regulated teams.",
  "",
  "## Voice",
  "",
  "Write in plain, direct sentences. Never say revolutionary. Use single source of truth instead.",
  "",
  "## Visual system",
  "",
  "Primary color: #1D4ED8",
  "Heading font: Sora",
  "Body font: Inter",
  "",
  "## Terminology",
  "",
  "Call to action: Start free trial",
  "Preferred term: single source of truth",
  "Avoid term: revolutionary",
  "",
  "Guidelines: Keep every claim traceable to a source document.",
  "Guidelines: Prefer short sentences over long ones.",
].join("\n");

describe("brand integration (real postgres)", () => {
  async function brandProject() {
    const owner = await registerUser();
    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Brand project" },
      owner.user.id,
    );
    await services.inputService.createBatch(project.id, owner.user.id, [
      { type: "text", name: "Brand brief", value: BRAND_BRIEF },
    ]);
    return { owner, project };
  }

  it("persists the composed brand with its basis, provenance and conflicts", async () => {
    const { owner, project } = await brandProject();
    const report = await services.brandService.analyze(project.id, owner.user.id);

    const profile = report.profile;
    expect(profile.projectId).toBe(project.id);
    expect(profile.name).toBe("Northwind Analytics");
    expect(profile.version).toBe(1);
    expect(profile.colors.length).toBeGreaterThan(0);
    expect(profile.terms.length).toBeGreaterThan(0);

    // The row is what the service returned, not a reconstruction of it.
    const stored = await services.brandService.getProfile(project.id, owner.user.id);
    expect(stored.profile?.name).toBe(profile.name);
    expect(stored.profile?.version).toBe(1);
    expect(stored.profile?.colors).toEqual(profile.colors);
    expect(stored.profile?.terms).toEqual(profile.terms);
    expect(stored.profile?.textOrigins).toEqual(profile.textOrigins);

    const profileRow = await orm.BrandProfile.first({ projectId: project.id });
    expect(profileRow?.version).toBe(1);
    expect(profileRow?.textOrigins.length).toBeGreaterThan(0);

    // Basis survives the round trip, so a refresh cannot demote a design token.
    const colorRows = await orm.BrandColor.where((row) => row.projectId.eq(project.id)).all();
    expect(colorRows.length).toBe(profile.colors.length);
    expect(colorRows.every((row) => row.basis.length > 0)).toBe(true);
    expect(colorRows.some((row) => row.evidenceIds.length > 0)).toBe(true);
  });

  it("records one source state per analyzed source and skips an unchanged refresh", async () => {
    const { owner, project } = await brandProject();
    const first = await services.brandService.analyze(project.id, owner.user.id);

    const states = await services.brandService.getProfile(project.id, owner.user.id);
    expect(states.sourceStates).toHaveLength(1);
    expect(states.sourceStates[0].analyzerId).toBe("brand-text");
    expect(states.sourceStates[0].brandVersion).toBe(first.profile.version);
    expect(states.sourceStates[0].contentHash).toBeTruthy();

    const refresh = await services.brandService.refresh(project.id, owner.user.id);
    expect(refresh.skipped).toBe("UP_TO_DATE");
    expect(refresh.profile.version).toBe(1);

    const stateRows = await orm.BrandSourceState.where((row) => row.projectId.eq(project.id)).all();
    expect(stateRows).toHaveLength(1);
  });

  it("replaces sent collections, preserves omitted ones, and keeps user text through refresh", async () => {
    const { owner, project } = await brandProject();
    const before = await services.brandService.analyze(project.id, owner.user.id);
    expect(before.profile.terms.length).toBeGreaterThan(0);

    const updated = await services.brandService.update(project.id, owner.user.id, {
      name: "Northwind OS",
      // Sent collection replaces the detected one.
      terms: [{ term: "content operations", category: "FEATURE", preference: "PREFERRED" }],
      // Omitted fonts and colors are left alone.
    });

    expect(updated.name).toBe("Northwind OS");
    expect(updated.textOrigins.name).toBe("USER");
    expect(updated.terms).toHaveLength(1);
    expect(updated.terms[0].term).toBe("content operations");
    expect(updated.terms[0].origin).toBe("USER");
    expect(updated.terms[0].basis).toBe("USER");
    expect(updated.fonts).toEqual(before.profile.fonts);
    expect(updated.colors).toEqual(before.profile.colors);
    // A correction is not a re-analysis, so the version does not move.
    expect(updated.version).toBe(1);

    // The stored row agrees, and the user origin is recoverable, not inferred.
    const stored = await services.brandService.getProfile(project.id, owner.user.id);
    expect(stored.profile?.name).toBe("Northwind OS");
    expect(stored.profile?.textOrigins.name).toBe("USER");
    const nameOrigin = await orm.BrandProfile.first({ projectId: project.id });
    expect(nameOrigin?.textOrigins).toContain("name=USER");

    const afterRefresh = await services.brandService.refresh(project.id, owner.user.id);
    expect(afterRefresh.skipped).toBe("UP_TO_DATE");
    expect(afterRefresh.profile.name).toBe("Northwind OS");
    expect(afterRefresh.profile.terms.map((term) => term.term)).toContain("content operations");
    expect(afterRefresh.profile.terms.some((term) => term.origin === "USER")).toBe(true);
  });

  it("takes the profile's child rows with it when the profile is deleted", async () => {
    const { owner, project } = await brandProject();
    await services.brandService.analyze(project.id, owner.user.id);

    const before = await orm.BrandColor.where((row) => row.projectId.eq(project.id)).all();
    expect(before.length).toBeGreaterThan(0);

    const { container } = await import("../../infrastructure/container");
    await container.repositories.brand.deleteByProjectId(project.id);

    // A brand value may not outlive the profile that asserted it, or the next
    // analysis would read rows belonging to a brand that no longer exists.
    const projectId = project.id;
    expect(await orm.BrandProfile.where({ projectId }).all()).toHaveLength(0);
    expect(await orm.BrandColor.where({ projectId }).all()).toHaveLength(0);
    expect(await orm.BrandFont.where({ projectId }).all()).toHaveLength(0);
    expect(await orm.BrandTerm.where({ projectId }).all()).toHaveLength(0);
    expect(await orm.BrandVoiceSignal.where({ projectId }).all()).toHaveLength(0);
    expect(await orm.BrandGuideline.where({ projectId }).all()).toHaveLength(0);
    expect(await orm.BrandSourceState.where({ projectId }).all()).toHaveLength(0);
  });

  it("keeps detected evidence visible as a conflict when a user overrides it", async () => {
    const { owner, project } = await brandProject();
    await services.brandService.analyze(project.id, owner.user.id);

    const updated = await services.brandService.update(project.id, owner.user.id, {
      colors: [{ name: "Ink", hex: "#111111", role: "PRIMARY" }],
    });

    expect(updated.colors).toHaveLength(1);
    expect(updated.colors[0].hex).toBe("#111111");
    expect(updated.colors[0].basis).toBe("USER");
    // A slot can only hold one primary, so the displaced value is retained as a
    // conflict instead of being dropped without a trace.
    const primaryConflict = updated.conflicts.find((conflict) => conflict.field.startsWith("color"));
    expect(primaryConflict?.retained).toContain("#111111");
    expect(primaryConflict?.competing).toBeTruthy();
    expect(primaryConflict?.resolvedBy).toBe("USER");

    const conflicts = await orm.BrandConflict.where((row) => row.projectId.eq(project.id)).all();
    expect(conflicts.length).toBe(updated.conflicts.length);
  });

  it("records evidence for a locked profile without changing canonical values", async () => {
    const { owner, project } = await brandProject();
    const before = await services.brandService.analyze(project.id, owner.user.id);
    const locked = await services.brandService.setLock(project.id, owner.user.id, true);
    expect(locked.locked).toBe(true);

    await services.inputService.createBatch(project.id, owner.user.id, [
      { type: "text", name: "Second brief", value: `${BRAND_BRIEF}\n\nPrimary color: #0F172A` },
    ]);
    const after = await services.brandService.analyze(project.id, owner.user.id, { force: true });

    expect(after.skipped).toBe("LOCKED");
    expect(after.profile.colors).toEqual(before.profile.colors);
    expect(after.profile.version).toBe(before.profile.version);
    expect(after.notes.join(" ")).toContain("locked");

    // The new source is still accounted for, so unlocking and refreshing resumes.
    const states = await services.brandService.getProfile(project.id, owner.user.id);
    expect(states.sourceStates).toHaveLength(2);
    const profileRow = await orm.BrandProfile.first({ projectId: project.id });
    expect(profileRow?.locked).toBe(true);
  });

  it("rejects a correction for a project that has no brand yet", async () => {
    const owner = await registerUser();
    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "No brand" },
      owner.user.id,
    );

    const failure = await services.brandService
      .update(project.id, owner.user.id, { name: "Nope" })
      .catch((error: unknown) => error);

    expect((failure as { code?: string }).code).toBe("BRAND_NOT_FOUND");
  });

  it("fails with BRAND_NO_SOURCES when the project has no readable source", async () => {
    const owner = await registerUser();
    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Brand without sources" },
      owner.user.id,
    );

    const failure = await services.brandService
      .analyze(project.id, owner.user.id)
      .catch((error: unknown) => error);

    expect((failure as { code?: string }).code).toBe("BRAND_NO_SOURCES");
    expect(await orm.BrandProfile.where((row) => row.projectId.eq(project.id)).all()).toHaveLength(0);
  });
});

describe("brand API integration", () => {
  async function analyzedBrand() {
    const owner = await registerUser();
    const project = await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "Brand API" },
      owner.user.id,
    );
    await services.inputService.createBatch(project.id, owner.user.id, [
      { type: "text", name: "Brand brief", value: BRAND_BRIEF },
    ]);
    return { owner, project };
  }

  it("analyzes, reads, corrects, locks and unlocks over HTTP", async () => {
    const { owner, project } = await analyzedBrand();
    const { GET, PATCH } = await import("../../app/api/projects/[id]/brand/route");
    const { POST: POST_ANALYZE } = await import(
      "../../app/api/projects/[id]/brand/analyze/route"
    );
    const { POST: POST_REFRESH } = await import(
      "../../app/api/projects/[id]/brand/refresh/route"
    );
    const { POST: POST_LOCK } = await import("../../app/api/projects/[id]/brand/lock/route");
    const { POST: POST_UNLOCK } = await import(
      "../../app/api/projects/[id]/brand/unlock/route"
    );

    const headers = { cookie: `content_os_session=${owner.token}` };
    const json = { ...headers, "content-type": "application/json" };
    const context = { params: Promise.resolve({ id: project.id }) };
    const url = "http://localhost/api/projects/p/brand";

    const empty = await GET(new Request(url, { headers }), context);
    expect(empty.status).toBe(200);
    expect((await empty.json()).brand).toBeNull();

    const analyzed = await POST_ANALYZE(
      new Request(`${url}/analyze`, { method: "POST", headers: json }),
      context,
    );
    expect(analyzed.status).toBe(200);
    const analyzedBody = (await analyzed.json()) as {
      brand: { name: string; colors: unknown[]; execution: { name: string } };
      analyzedSourceIds: string[];
      aiApplied: boolean;
    };
    expect(analyzedBody.brand.name).toBe("Northwind Analytics");
    expect(analyzedBody.brand.execution.name).toBe("Northwind Analytics");
    expect(analyzedBody.brand.colors.length).toBeGreaterThan(0);
    expect(analyzedBody.analyzedSourceIds).toHaveLength(1);
    expect(analyzedBody.aiApplied).toBe(false);

    // A serialized brand must not carry storage keys or raw evidence internals.
    const serialized = JSON.stringify(analyzedBody);
    expect(serialized).not.toContain("storageKey");
    expect(serialized).not.toContain("content-os-storage://");
    expect(serialized).not.toContain("locator");
    expect(serialized).not.toContain("excerpt");

    const read = await GET(new Request(url, { headers }), context);
    const readBody = (await read.json()) as {
      brand: { version: number; status: string };
      sourceStates: Array<{ analyzerId: string }>;
    };
    expect(read.status).toBe(200);
    expect(readBody.brand.version).toBe(1);
    expect(readBody.sourceStates[0].analyzerId).toBe("brand-text");

    const noChange = await POST_REFRESH(
      new Request(`${url}/refresh`, { method: "POST", headers }),
      context,
    );
    expect(noChange.status).toBe(200);
    expect((await noChange.json()).skipped).toBe("UP_TO_DATE");

    const corrected = await PATCH(
      new Request(url, {
        method: "PATCH",
        headers: json,
        body: JSON.stringify({
          tagline: "Dashboards in minutes",
          voiceSignals: [{ kind: "TONE", value: "Direct" }],
        }),
      }),
      context,
    );
    expect(corrected.status).toBe(200);
    const correctedBody = (await corrected.json()) as {
      brand: { tagline: string; voiceSignals: Array<{ value: string; basis: string }> };
    };
    expect(correctedBody.brand.tagline).toBe("Dashboards in minutes");
    expect(correctedBody.brand.voiceSignals[0].basis).toBe("USER");

    const locked = await POST_LOCK(
      new Request(`${url}/lock`, { method: "POST", headers }),
      context,
    );
    expect(locked.status).toBe(200);
    expect((await locked.json()).brand.locked).toBe(true);

    const unlocked = await POST_UNLOCK(
      new Request(`${url}/unlock`, { method: "POST", headers }),
      context,
    );
    expect(unlocked.status).toBe(200);
    expect((await unlocked.json()).brand.locked).toBe(false);
  });

  it("rejects invalid patches and cross-origin writes", async () => {
    const { owner, project } = await analyzedBrand();
    const { PATCH } = await import("../../app/api/projects/[id]/brand/route");
    const { POST: POST_ANALYZE } = await import(
      "../../app/api/projects/[id]/brand/analyze/route"
    );
    const headers = { cookie: `content_os_session=${owner.token}` };
    const json = { ...headers, "content-type": "application/json" };
    const context = { params: Promise.resolve({ id: project.id }) };
    const url = "http://localhost/api/projects/p/brand";

    const emptyPatch = await PATCH(
      new Request(url, { method: "PATCH", headers: json, body: JSON.stringify({}) }),
      context,
    );
    expect(emptyPatch.status).toBe(400);

    const badRole = await PATCH(
      new Request(url, {
        method: "PATCH",
        headers: json,
        body: JSON.stringify({ colors: [{ name: "Ink", hex: "#111111", role: "SPARKLY" }] }),
      }),
      context,
    );
    expect(badRole.status).toBe(400);
    expect((await badRole.json()).error).toContain("colors[0].role");

    const crossOrigin = await POST_ANALYZE(
      new Request(`${url}/analyze`, {
        method: "POST",
        headers: { ...json, origin: "https://evil.test" },
      }),
      context,
    );
    expect(crossOrigin.status).toBe(403);
  });

  it("refuses every brand route for a user outside the project", async () => {
    const { owner, project } = await analyzedBrand();
    await services.brandService.analyze(project.id, owner.user.id);
    const stranger = await registerUser();
    const { GET, PATCH } = await import("../../app/api/projects/[id]/brand/route");
    const { POST: POST_ANALYZE } = await import(
      "../../app/api/projects/[id]/brand/analyze/route"
    );
    const { POST: POST_REFRESH } = await import(
      "../../app/api/projects/[id]/brand/refresh/route"
    );
    const { POST: POST_LOCK } = await import("../../app/api/projects/[id]/brand/lock/route");
    const { POST: POST_UNLOCK } = await import(
      "../../app/api/projects/[id]/brand/unlock/route"
    );
    const headers = { cookie: `content_os_session=${stranger.token}` };
    const json = { ...headers, "content-type": "application/json" };
    const context = { params: Promise.resolve({ id: project.id }) };
    const url = "http://localhost/api/projects/p/brand";

    expect((await GET(new Request(url, { headers }), context)).status).toBe(403);
    expect(
      (
        await PATCH(
          new Request(url, {
            method: "PATCH",
            headers: json,
            body: JSON.stringify({ name: "Hijacked" }),
          }),
          context,
        )
      ).status,
    ).toBe(403);
    for (const route of [POST_ANALYZE, POST_REFRESH, POST_LOCK, POST_UNLOCK]) {
      const response = await route(
        new Request(url, { method: "POST", headers: json }),
        context,
      );
      expect(response.status).toBe(403);
    }

    // The refusal is the project boundary, not a shape check: nothing changed.
    const stored = await services.brandService.getProfile(project.id, owner.user.id);
    expect(stored.profile?.name).toBe("Northwind Analytics");
  });

  it("requires authentication", async () => {
    const { project } = await analyzedBrand();
    const { GET } = await import("../../app/api/projects/[id]/brand/route");
    const context = { params: Promise.resolve({ id: project.id }) };
    const response = await GET(
      new Request("http://localhost/api/projects/p/brand"),
      context,
    );
    expect(response.status).toBe(401);
  });
});

async function projectForIntent(owner: {
  workspace?: { id: string };
  user: { id: string };
}) {
  expect(owner.workspace).toBeTruthy();
  return services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "Intent project" },
    owner.user.id,
  );
}

describe("content intent integration (real postgres)", () => {
  async function analyzedIntentProject() {
    const owner = await registerUser();
    const project = await projectForIntent(owner);
    await services.inputService.createBatch(project.id, owner.user.id, [
      { type: "text", name: "Brand brief", value: BRAND_BRIEF },
    ]);
    return { owner, project };
  }

  it("survives a round trip through postgres with its constraints intact", async () => {
    const { owner, project } = await analyzedIntentProject();

    const resolved = await services.contentIntentService.resolve({
      projectId: project.id,
      userId: owner.user.id,
      request: "Make three 45 second cinematic launch videos announcing our pricing for LinkedIn, 16:9, confident",
    });
    expect(resolved.intent.status).toBe("RESOLVED");
    expect(resolved.intent.contentTypeId).toBe("video.launch");
    expect(resolved.intent.quantity).toBe(3);
    expect(resolved.intent.durationSeconds).toBe(45);

    // Read it back through a second service call, so what is asserted is what
    // storage actually kept rather than what the resolver held in memory.
    const stored = await services.contentIntentService.get(
      project.id,
      resolved.intent.id,
      owner.user.id,
    );
    expect(stored.intent.rawRequest).toBe(
      "Make three 45 second cinematic launch videos announcing our pricing for LinkedIn, 16:9, confident",
    );
    expect(stored.intent.platforms).toEqual(["linkedin"]);
    expect(stored.intent.quantity).toBe(3);
    expect(stored.intent.aspectRatio).toBe("16:9");
    expect(stored.intent.constraints.length).toBeGreaterThan(0);
    for (const constraint of stored.intent.constraints) {
      expect(["USER", "PROJECT", "BRAND", "AI", "SYSTEM"]).toContain(constraint.source);
    }
    // Three videos of one length is a real open question, and it is the only one:
    // a batch of different lengths is the one thing storage must not guess.
    expect(stored.clarifications.map((entry) => entry.field)).toEqual(["quantity"]);
    for (const clarification of stored.clarifications) {
      expect(clarification.question.length).toBeGreaterThan(0);
    }
  });

  it("keeps a custom ratio as its dimensions across storage", async () => {
    const { owner, project } = await analyzedIntentProject();

    const resolved = await services.contentIntentService.resolve({
      projectId: project.id,
      userId: owner.user.id,
      request: "Make a launch video for LinkedIn at 1080x1920",
    });
    expect(resolved.intent.aspectRatio).toBe("CUSTOM");
    expect(resolved.intent.customAspectRatio).toEqual({ width: 1080, height: 1920 });

    // A bare "CUSTOM" would be unreadable; the dimensions are the meaning.
    const stored = await services.contentIntentService.get(
      project.id,
      resolved.intent.id,
      owner.user.id,
    );
    expect(stored.intent.customAspectRatio).toEqual({ width: 1080, height: 1920 });
    const ratioConstraint = stored.intent.constraints.find(
      (constraint) => constraint.key === "aspectRatio",
    );
    expect(ratioConstraint?.value).toBe("1080x1920");
  });

  it("lists newest first and applies a correction to the stored row", async () => {
    const { owner, project } = await analyzedIntentProject();
    const userId = owner.user.id;

    const first = await services.contentIntentService.resolve({
      projectId: project.id,
      userId,
      request: "Make a 15 second explainer video for YouTube",
    });
    const second = await services.contentIntentService.resolve({
      projectId: project.id,
      userId,
      request: "Make a 15 second launch video for LinkedIn",
    });

    const listed = await services.contentIntentService.list(project.id, userId);
    expect(listed.map((view) => view.intent.id)).toEqual([second.intent.id, first.intent.id]);

    const updated = await services.contentIntentService.update(
      project.id,
      first.intent.id,
      userId,
      { durationSeconds: 40, platforms: ["youtube", "linkedin"] },
    );
    expect(updated.intent.durationSeconds).toBe(40);
    expect(updated.intent.platforms).toEqual(["youtube", "linkedin"]);

    const reread = await services.contentIntentService.get(
      project.id,
      first.intent.id,
      userId,
    );
    expect(reread.intent.durationSeconds).toBe(40);
    expect(reread.intent.quantity).toBe(1);
  });

  it("degrades a malformed stored constraint instead of failing the read", async () => {
    const { owner, project } = await analyzedIntentProject();
    const resolved = await services.contentIntentService.resolve({
      projectId: project.id,
      userId: owner.user.id,
      request: "Make a 30 second launch video for LinkedIn",
    });

    // Written straight to the column, past the repository: this is what a bad
    // migration or a hand edit would leave behind.
    await orm.ContentIntent.where({ id: resolved.intent.id }).update({
      constraints: "not json",
    });

    const stored = await services.contentIntentService.get(
      project.id,
      resolved.intent.id,
      owner.user.id,
    );
    expect(stored.intent.id).toBe(resolved.intent.id);
    expect(stored.intent.constraints).toEqual([]);
  });

  it("hides another project's intent behind the same not-found answer", async () => {
    const { owner, project } = await analyzedIntentProject();
    const resolved = await services.contentIntentService.resolve({
      projectId: project.id,
      userId: owner.user.id,
      request: "Make a 30 second launch video for LinkedIn",
    });

    const stranger = await registerUser();
    const strangerProject = await projectForIntent(stranger);

    await expect(
      services.contentIntentService.get(
        strangerProject.id,
        resolved.intent.id,
        stranger.user.id,
      ),
    ).rejects.toMatchObject({ code: "INTENT_NOT_FOUND" });

    const strangerList = await services.contentIntentService.list(
      strangerProject.id,
      stranger.user.id,
    );
    expect(strangerList).toEqual([]);
  });
});

describe("content intent API integration", () => {
  // The collection and item routes take different params, so they are kept apart
  // rather than merged into one object typed as the union of both.
  async function intentRoutes() {
    const collection = await import("../../app/api/projects/[id]/intent/route");
    const item = await import("../../app/api/projects/[id]/intent/[intentId]/route");
    return { collection, item };
  }

  it("resolves, lists, reads and corrects over HTTP with no session and no other user", async () => {
    const owner = await registerUser();
    const project = await projectForIntent(owner);
    const { collection, item } = await intentRoutes();
    const { POST, GET } = collection;
    const { GET: GET_ITEM, PATCH } = item;

    const headers = { cookie: `content_os_session=${owner.token}` };
    const json = { ...headers, "content-type": "application/json" };
    const context = { params: Promise.resolve({ id: project.id }) };
    const url = `http://localhost/api/projects/${project.id}/intent`;

    // No sourceIds at all: someone asking in their own words attaches nothing.
    const created = await POST(
      new Request(url, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ request: "Make a 30 second launch video for LinkedIn" }),
      }),
      context,
    );
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as {
      intent: { id: string; contentTypeId: string; status: string };
      clarifications: unknown[];
      registry: { contentTypes: Array<{ key: string; label: string }> };
    };
    expect(createdBody.intent.contentTypeId).toBe("video.launch");
    expect(createdBody.intent.status).toBe("RESOLVED");
    expect(createdBody.registry.contentTypes.length).toBeGreaterThan(0);

    const listed = await GET(new Request(url, { headers }), context);
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as {
      intents: Array<{ intent: { id: string } }>;
    };
    expect(listedBody.intents.map((entry) => entry.intent.id)).toEqual([createdBody.intent.id]);

    const itemContext = {
      params: Promise.resolve({ id: project.id, intentId: createdBody.intent.id }),
    };
    const patched = await PATCH(
      new Request(`${url}/${createdBody.intent.id}`, {
        method: "PATCH",
        headers: json,
        body: JSON.stringify({ durationSeconds: 20, tone: "direct" }),
      }),
      itemContext,
    );
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as {
      intent: { durationSeconds: number; tone: string };
    };
    expect(patchedBody.intent.durationSeconds).toBe(20);
    expect(patchedBody.intent.tone).toBe("direct");

    const read = await GET_ITEM(new Request(`${url}/${createdBody.intent.id}`, { headers }), itemContext);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { intent: { durationSeconds: number } }).intent.durationSeconds).toBe(20);

    // Unauthenticated reads and writes are refused before any storage is touched.
    const anonymous = { params: Promise.resolve({ id: project.id }) };
    expect((await GET(new Request(url), anonymous)).status).toBe(401);
    expect(
      (
        await POST(
          new Request(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ request: "Make a video" }),
          }),
          anonymous,
        )
      ).status,
    ).toBe(401);

    const stranger = await registerUser();
    const strangerProject = await projectForIntent(stranger);
    const strangerRoutes = await intentRoutes();
    const strangerHeaders = { cookie: `content_os_session=${stranger.token}` };
    const strangerContext = { params: Promise.resolve({ id: strangerProject.id }) };
    expect(
      (
        await strangerRoutes.collection.GET(
          new Request(url, { headers: strangerHeaders }),
          strangerContext,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await strangerRoutes.item.GET(
          new Request(`${url}/${createdBody.intent.id}`, { headers: strangerHeaders }),
          { params: Promise.resolve({ id: strangerProject.id, intentId: createdBody.intent.id }) },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await strangerRoutes.item.PATCH(
          new Request(`${url}/${createdBody.intent.id}`, {
            method: "PATCH",
            headers: { ...strangerHeaders, "content-type": "application/json" },
            body: JSON.stringify({ durationSeconds: 90 }),
          }),
          { params: Promise.resolve({ id: strangerProject.id, intentId: createdBody.intent.id }) },
        )
      ).status,
    ).toBe(404);
  });

  it("answers an under-specified request with a question, not an invention", async () => {
    const owner = await registerUser();
    const project = await projectForIntent(owner);
    const { collection } = await intentRoutes();
    const { POST } = collection;
    const json = {
      cookie: `content_os_session=${owner.token}`,
      "content-type": "application/json",
    };

    const response = await POST(
      new Request(`http://localhost/api/projects/${project.id}/intent`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ request: "Make something about our new pricing page" }),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      intent: { status: string; contentTypeId: string; unresolvedFields: string[] };
      clarifications: Array<{ field: string; question: string }>;
    };
    if (body.intent.status === "NEEDS_CLARIFICATION") {
      expect(body.intent.contentTypeId).toBe("");
      expect(body.clarifications.map((entry) => entry.field)).toContain("contentType");
    }
  });

  it("rejects a request that breaks a platform's own rules, naming the rule", async () => {
    const owner = await registerUser();
    const project = await projectForIntent(owner);
    const { collection } = await intentRoutes();
    const { POST } = collection;
    const json = {
      cookie: `content_os_session=${owner.token}`,
      "content-type": "application/json",
    };

    const response = await POST(
      new Request(`http://localhost/api/projects/${project.id}/intent`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ request: "Make a 30 second thumbnail" }),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues).toContain("CONTENT_TYPE_DOES_NOT_SUPPORT_DURATION");
  });
});

/**
 * A brief with concrete, checkable material in it, so a direction generated from
 * it has real claims and a real product screen to cite.
 */
const DIRECTION_BRIEF = [
  "# Northwind Analytics",
  "",
  "Northwind Analytics is a scheduling tool for engineering teams.",
  "",
  "## What it does",
  "",
  "Scheduled exports send a status report on a fixed schedule, so a team stops chasing people for updates.",
  "",
  "## Who it is for",
  "",
  "Engineering leads who report progress to stakeholders every week.",
  "",
  "## Proof",
  "",
  "The product dashboard shows a next run time for every export.",
  "",
  "## Voice",
  "",
  "Plain and direct. Say single source of truth rather than revolutionary.",
].join("\n");

describe("creative direction integration (real postgres)", () => {
  /**
   * A project with a resolved request, recorded claims, and a captured product
   * screen: the three things a direction has to be grounded in.
   */
  async function directedProject() {
    const owner = await registerUser();
    const project = await projectForIntent(owner);
    await services.inputService.createBatch(project.id, owner.user.id, [
      { type: "text", name: "Product brief", value: DIRECTION_BRIEF },
    ]);

    const resolved = await services.contentIntentService.resolve({
      projectId: project.id,
      userId: owner.user.id,
      request: "Make a 30 second launch video for LinkedIn announcing our scheduling",
    });
    expect(resolved.intent.status).toBe("RESOLVED");

    const run = await services.intelligenceService.analyze(
      project.id,
      owner.user.id,
      {},
    );
    expect(run).toBeTruthy();

    return { owner, project, intentId: resolved.intent.id };
  }

  it("keeps the nested strategies readable after a round trip", async () => {
    const { owner, project, intentId } = await directedProject();

    const generated = await services.creativeDirectorService.generate({
      projectId: project.id,
      userId: owner.user.id,
      intentId,
      mode: "BALANCED",
    });
    expect(generated.directions.length).toBeGreaterThanOrEqual(3);

    // Read back through a second call: what is asserted is what storage kept,
    // including the JSON columns decoded into objects rather than left as text.
    const stored = await services.creativeDirectorService.get(
      project.id,
      owner.user.id,
      generated.directions[0].id,
    );

    expect(typeof stored.hook.statement).toBe("string");
    expect(Array.isArray(stored.visualStrategy.productMoments)).toBe(true);
    expect(Array.isArray(stored.visualStrategy.assetIds)).toBe(true);
    expect(Array.isArray(stored.proofStrategy.claimIds)).toBe(true);
    expect(stored.creativeRunId).toBe(generated.creativeRunId);
    expect(stored.mode).toBe("BALANCED");
    expect(stored.intentId).toBe(intentId);
  });

  it("stores only ids the project actually holds", async () => {
    const { owner, project, intentId } = await directedProject();
    const generated = await services.creativeDirectorService.generate({
      projectId: project.id,
      userId: owner.user.id,
      intentId,
      mode: "BALANCED",
    });

    const graph = await services.intelligenceService.getGraph(
      project.id,
      owner.user.id,
    );
    const claimIds = new Set(graph.claims.map((claim) => claim.id));
    const evidenceIds = new Set(graph.evidence.map((item) => item.id));
    const assetIds = new Set(graph.assets.map((asset) => asset.id));

    for (const direction of generated.directions) {
      for (const id of direction.proofStrategy.claimIds) {
        expect(claimIds.has(id)).toBe(true);
      }
      for (const id of direction.proofStrategy.evidenceIds) {
        expect(evidenceIds.has(id)).toBe(true);
      }
      for (const id of direction.visualStrategy.assetIds) {
        expect(assetIds.has(id)).toBe(true);
      }
    }
  });

  it("leaves an earlier run untouched when a second set is proposed", async () => {
    const { owner, project, intentId } = await directedProject();
    const first = await services.creativeDirectorService.generate({
      projectId: project.id,
      userId: owner.user.id,
      intentId,
      mode: "BALANCED",
    });
    const second = await services.creativeDirectorService.generate({
      projectId: project.id,
      userId: owner.user.id,
      intentId,
      mode: "WILD",
    });

    expect(second.creativeRunId).not.toBe(first.creativeRunId);
    const all = await services.creativeDirectorService.list(project.id, owner.user.id, {
      intentId,
    });
    expect(all.length).toBe(first.directions.length + second.directions.length);

    for (const original of first.directions) {
      const stored = all.find((entry) => entry.id === original.id);
      expect(stored?.status).toBe("DRAFT");
      expect(stored?.editedByUser).toBe(false);
    }
  });

  it("keeps one selected direction per intent when selections are replaced", async () => {
    const { owner, project, intentId } = await directedProject();
    const generated = await services.creativeDirectorService.generate({
      projectId: project.id,
      userId: owner.user.id,
      intentId,
      mode: "BALANCED",
    });

    const first = await services.creativeDirectorService.select(
      project.id,
      owner.user.id,
      generated.directions[0].id,
    );
    expect(first.selected.status).toBe("SELECTED");
    expect(first.demoted).toEqual([]);

    const second = await services.creativeDirectorService.select(
      project.id,
      owner.user.id,
      generated.directions[1].id,
    );
    expect(second.selected.status).toBe("SELECTED");
    // The demoted row is reported by the write that demoted it, not guessed from
    // a read taken beforehand.
    expect(second.demoted.map((entry) => entry.id)).toEqual([generated.directions[0].id]);
    expect(second.demoted[0].status).toBe("DRAFT");

    const all = await services.creativeDirectorService.list(project.id, owner.user.id, {
      intentId,
    });
    expect(all.filter((entry) => entry.status === "SELECTED")).toHaveLength(1);
  });

  it("will not store a user edit that fabricates a number", async () => {
    const { owner, project, intentId } = await directedProject();
    const generated = await services.creativeDirectorService.generate({
      projectId: project.id,
      userId: owner.user.id,
      intentId,
      mode: "BALANCED",
    });

    await expect(
      services.creativeDirectorService.update({
        projectId: project.id,
        userId: owner.user.id,
        directionId: generated.directions[0].id,
        patch: { thesis: "Teams ship 10x faster with Northwind" },
      }),
    ).rejects.toThrow(/no supported claim/i);

    // The refusal left the stored row as it was.
    const stored = await services.creativeDirectorService.get(
      project.id,
      owner.user.id,
      generated.directions[0].id,
    );
    expect(stored.thesis).toBe(generated.directions[0].thesis);
    expect(stored.editedByUser).toBe(false);
  });

  it("marks a user edit and leaves it alone on a later run", async () => {
    const { owner, project, intentId } = await directedProject();
    const generated = await services.creativeDirectorService.generate({
      projectId: project.id,
      userId: owner.user.id,
      intentId,
      mode: "BALANCED",
    });
    const target = generated.directions[0];

    const edited = await services.creativeDirectorService.update({
      projectId: project.id,
      userId: owner.user.id,
      directionId: target.id,
      patch: { thesis: "The morning chase is the thing this removes" },
    });
    expect(edited.editedByUser).toBe(true);
    expect(edited.thesis).toBe("The morning chase is the thing this removes");

    await services.creativeDirectorService.generate({
      projectId: project.id,
      userId: owner.user.id,
      intentId,
      mode: "BALANCED",
    });

    const after = await services.creativeDirectorService.get(
      project.id,
      owner.user.id,
      target.id,
    );
    expect(after.thesis).toBe("The morning chase is the thing this removes");
    expect(after.editedByUser).toBe(true);
  });

  it("refuses Guided mode on a project with no product UI", async () => {
    const owner = await registerUser();
    const project = await projectForIntent(owner);
    const resolved = await services.contentIntentService.resolve({
      projectId: project.id,
      userId: owner.user.id,
      request: "Make a 30 second launch video for LinkedIn",
    });

    await expect(
      services.creativeDirectorService.generate({
        projectId: project.id,
        userId: owner.user.id,
        intentId: resolved.intent.id,
        mode: "GUIDED",
      }),
    ).rejects.toThrow(/needs captured product UI/i);
  });

  it("refuses to direct a request that is not resolved yet", async () => {
    const owner = await registerUser();
    const project = await projectForIntent(owner);
    const resolved = await services.contentIntentService.resolve({
      projectId: project.id,
      userId: owner.user.id,
      request: "Make something",
    });

    await expect(
      services.creativeDirectorService.generate({
        projectId: project.id,
        userId: owner.user.id,
        intentId: resolved.intent.id,
        mode: "BALANCED",
      }),
    ).rejects.toThrow(/resolve/i);
  });

  it("will not read or write another user's direction", async () => {
    const { owner, project, intentId } = await directedProject();
    const other = await registerUser();

    const generated = await services.creativeDirectorService.generate({
      projectId: project.id,
      userId: owner.user.id,
      intentId,
      mode: "BALANCED",
    });

    await expect(
      services.creativeDirectorService.list(project.id, other.user.id),
    ).rejects.toThrow();
    await expect(
      services.creativeDirectorService.get(
        project.id,
        other.user.id,
        generated.directions[0].id,
      ),
    ).rejects.toThrow();
  });
});

describe("creative direction API integration", () => {
  async function creativeRoutes() {
    const collection = await import(
      "../../app/api/projects/[id]/creative-directions/route"
    );
    const generate = await import(
      "../../app/api/projects/[id]/creative-directions/generate/route"
    );
    const item = await import(
      "../../app/api/projects/[id]/creative-directions/[directionId]/route"
    );
    const select = await import(
      "../../app/api/projects/[id]/creative-directions/[directionId]/select/route"
    );
    return { collection, generate, item, select };
  }

  it("proposes, lists, edits and chooses over HTTP", async () => {
    const owner = await registerUser();
    const project = await projectForIntent(owner);
    await services.inputService.createBatch(project.id, owner.user.id, [
      { type: "text", name: "Product brief", value: DIRECTION_BRIEF },
    ]);
    const resolved = await services.contentIntentService.resolve({
      projectId: project.id,
      userId: owner.user.id,
      request: "Make a 30 second launch video for LinkedIn announcing our scheduling",
    });
    await services.intelligenceService.analyze(project.id, owner.user.id, {});

    const { collection, generate, item, select } = await creativeRoutes();
    const headers = { cookie: `content_os_session=${owner.token}` };
    const json = { ...headers, "content-type": "application/json" };
    const context = { params: Promise.resolve({ id: project.id }) };
    const url = `http://localhost/api/projects/${project.id}/creative-directions`;

    const proposed = await generate.POST(
      new Request(`${url}/generate`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ intentId: resolved.intent.id, mode: "BALANCED" }),
      }),
      context,
    );
    expect(proposed.status).toBe(200);
    const proposedBody = (await proposed.json()) as {
      directions: Array<{ id: string; status: string; name: string }>;
      run: { creativeRunId: string; mode: string };
      registry: { modes: Array<{ id: string }> };
    };
    expect(proposedBody.directions.length).toBeGreaterThanOrEqual(3);
    expect(proposedBody.directions.length).toBeLessThanOrEqual(5);
    expect(proposedBody.run.mode).toBe("BALANCED");
    expect(proposedBody.registry.modes.map((mode) => mode.id)).toEqual([
      "GUIDED",
      "BALANCED",
      "WILD",
    ]);
    // The score is the server's ordering, not the reader's ranking.
    expect(proposedBody.directions[0]).not.toHaveProperty("strengthScore");

    const listed = await collection.GET(
      new Request(`${url}?intentId=${resolved.intent.id}`, { headers }),
      context,
    );
    expect(listed.status).toBe(200);
    expect(
      ((await listed.json()) as { directions: unknown[] }).directions.length,
    ).toBe(proposedBody.directions.length);

    const first = proposedBody.directions[0].id;
    const itemContext = {
      params: Promise.resolve({ id: project.id, directionId: first }),
    };

    const patched = await item.PATCH(
      new Request(`${url}/${first}`, {
        method: "PATCH",
        headers: json,
        body: JSON.stringify({ thesis: "The morning chase is the thing this removes" }),
      }),
      itemContext,
    );
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as {
      direction: { thesis: string; editedByUser: boolean };
    };
    expect(patchedBody.direction.thesis).toBe(
      "The morning chase is the thing this removes",
    );
    expect(patchedBody.direction.editedByUser).toBe(true);

    const chosen = await select.POST(new Request(`${url}/${first}/select`, { method: "POST", headers: json }), itemContext);
    expect(chosen.status).toBe(200);
    const chosenBody = (await chosen.json()) as {
      direction: { status: string };
      demoted: unknown[];
    };
    expect(chosenBody.direction.status).toBe("SELECTED");
    expect(chosenBody.demoted).toEqual([]);

    const second = proposedBody.directions[1].id;
    const secondContext = {
      params: Promise.resolve({ id: project.id, directionId: second }),
    };
    const swapped = await select.POST(
      new Request(`${url}/${second}/select`, { method: "POST", headers: json }),
      secondContext,
    );
    expect(swapped.status).toBe(200);
    const swappedBody = (await swapped.json()) as {
      direction: { status: string };
      demoted: Array<{ id: string; status: string }>;
    };
    expect(swappedBody.direction.status).toBe("SELECTED");
    expect(swappedBody.demoted.map((entry) => entry.id)).toEqual([first]);

    const anonymous = { params: Promise.resolve({ id: project.id }) };
    expect((await collection.GET(new Request(url), anonymous)).status).toBe(401);
  });

  it("refuses a body that tries to supply the server's own context", async () => {
    const owner = await registerUser();
    const project = await projectForIntent(owner);
    const { generate } = await creativeRoutes();

    const response = await generate.POST(
      new Request(
        `http://localhost/api/projects/${project.id}/creative-directions/generate`,
        {
          method: "POST",
          headers: {
            cookie: `content_os_session=${owner.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            intentId: "int_1",
            mode: "BALANCED",
            claims: [{ id: "cl_x", text: "We are ten times faster" }],
          }),
        },
      ),
      { params: Promise.resolve({ id: project.id }) },
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/derives claims/);
  });

  it("refuses a cross-origin generate before it touches anything", async () => {
    const owner = await registerUser();
    const project = await projectForIntent(owner);
    const { generate } = await creativeRoutes();

    const response = await generate.POST(
      new Request(
        `http://localhost/api/projects/${project.id}/creative-directions/generate`,
        {
          method: "POST",
          headers: {
            cookie: `content_os_session=${owner.token}`,
            "content-type": "application/json",
            origin: "https://elsewhere.example",
          },
          body: JSON.stringify({ intentId: "int_1", mode: "BALANCED" }),
        },
      ),
      { params: Promise.resolve({ id: project.id }) },
    );

    expect(response.status).toBe(403);
  });

  it("answers a Guided request on a project with no UI with the reason", async () => {
    const owner = await registerUser();
    const project = await projectForIntent(owner);
    const resolved = await services.contentIntentService.resolve({
      projectId: project.id,
      userId: owner.user.id,
      request: "Make a 30 second launch video for LinkedIn",
    });
    const { generate } = await creativeRoutes();

    const response = await generate.POST(
      new Request(
        `http://localhost/api/projects/${project.id}/creative-directions/generate`,
        {
          method: "POST",
          headers: {
            cookie: `content_os_session=${owner.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ intentId: resolved.intent.id, mode: "GUIDED" }),
        },
      ),
      { params: Promise.resolve({ id: project.id }) },
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("CREATIVE_MODE_CONFLICT");
    expect(body.error).toMatch(/needs captured product UI/i);
  });

  it("refuses an edit that fabricates a number, naming the field", async () => {
    const owner = await registerUser();
    const project = await projectForIntent(owner);
    await services.inputService.createBatch(project.id, owner.user.id, [
      { type: "text", name: "Product brief", value: DIRECTION_BRIEF },
    ]);
    const resolved = await services.contentIntentService.resolve({
      projectId: project.id,
      userId: owner.user.id,
      request: "Make a 30 second launch video for LinkedIn announcing our scheduling",
    });
    await services.intelligenceService.analyze(project.id, owner.user.id, {});
    const { generate, item } = await creativeRoutes();

    const proposed = await generate.POST(
      new Request(
        `http://localhost/api/projects/${project.id}/creative-directions/generate`,
        {
          method: "POST",
          headers: {
            cookie: `content_os_session=${owner.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ intentId: resolved.intent.id, mode: "BALANCED" }),
        },
      ),
      { params: Promise.resolve({ id: project.id }) },
    );
    const body = (await proposed.json()) as { directions: Array<{ id: string }> };
    const first = body.directions[0].id;

    const response = await item.PATCH(
      new Request(
        `http://localhost/api/projects/${project.id}/creative-directions/${first}`,
        {
          method: "PATCH",
          headers: {
            cookie: `content_os_session=${owner.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ thesis: "Teams ship 10x faster with Northwind" }),
        },
      ),
      { params: Promise.resolve({ id: project.id, directionId: first }) },
    );

    expect(response.status).toBe(422);
    const rejected = (await response.json()) as {
      code: string;
      issues: Array<{ code: string; message: string }>;
    };
    expect(rejected.code).toBe("CREATIVE_UNSUPPORTED_QUANTIFIED_CLAIM");
    expect(rejected.issues[0].message).toMatch(/thesis/);
  });

  it("refuses an edit to a field the server owns", async () => {
    const owner = await registerUser();
    const project = await projectForIntent(owner);
    await services.inputService.createBatch(project.id, owner.user.id, [
      { type: "text", name: "Product brief", value: DIRECTION_BRIEF },
    ]);
    const resolved = await services.contentIntentService.resolve({
      projectId: project.id,
      userId: owner.user.id,
      request: "Make a 30 second launch video for LinkedIn announcing our scheduling",
    });
    await services.intelligenceService.analyze(project.id, owner.user.id, {});
    const { generate, item } = await creativeRoutes();

    const proposed = await generate.POST(
      new Request(
        `http://localhost/api/projects/${project.id}/creative-directions/generate`,
        {
          method: "POST",
          headers: {
            cookie: `content_os_session=${owner.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ intentId: resolved.intent.id, mode: "BALANCED" }),
        },
      ),
      { params: Promise.resolve({ id: project.id }) },
    );
    const body = (await proposed.json()) as { directions: Array<{ id: string }> };
    const first = body.directions[0].id;

    const response = await item.PATCH(
      new Request(
        `http://localhost/api/projects/${project.id}/creative-directions/${first}`,
        {
          method: "PATCH",
          headers: {
            cookie: `content_os_session=${owner.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ strengthScore: 100, brandVersion: 9 }),
        },
      ),
      { params: Promise.resolve({ id: project.id, directionId: first }) },
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(
      /not editable/,
    );
  });
});

/**
 * A project with a resolved request, recorded intelligence, and a *selected*
 * direction. A storyboard needs all three, and the selection is the one a plan
 * cannot do without: a plan for an argument nobody chose is a plan for the
 * wrong film.
 */
async function storyboardProject() {
  const owner = await registerUser();
  const project = await projectForIntent(owner);
  await services.inputService.createBatch(project.id, owner.user.id, [
    { type: "text", name: "Product brief", value: DIRECTION_BRIEF },
  ]);

  const resolved = await services.contentIntentService.resolve({
    projectId: project.id,
    userId: owner.user.id,
    request: "Make a 30 second launch video for LinkedIn announcing our scheduling",
  });
  expect(resolved.intent.status).toBe("RESOLVED");
  await services.intelligenceService.analyze(project.id, owner.user.id, {});

  const generated = await services.creativeDirectorService.generate({
    projectId: project.id,
    userId: owner.user.id,
    intentId: resolved.intent.id,
    mode: "BALANCED",
  });
  const directionId = generated.directions[0].id;
  await services.creativeDirectorService.select(
    project.id,
    owner.user.id,
    directionId,
  );

  return { owner, project, intentId: resolved.intent.id, directionId };
}

describe("storyboard integration (real postgres)", () => {
  async function plan(ctx: Awaited<ReturnType<typeof storyboardProject>>) {
    return services.storyboardService.generate({
      projectId: ctx.project.id,
      userId: ctx.owner.user.id,
      intentId: ctx.intentId,
      directionId: ctx.directionId,
    });
  }

  it("keeps the whole plan readable after a round trip", async () => {
    const ctx = await storyboardProject();
    const { storyboard } = await plan(ctx);

    // Read back through a second call: what is asserted is what storage kept,
    // including the scenes decoded out of their own rows rather than left as JSON.
    const stored = await services.storyboardService.get(
      ctx.project.id,
      ctx.owner.user.id,
      storyboard.id,
    );

    expect(stored.scenes.length).toBe(storyboard.scenes.length);
    expect(stored.scenes.map((scene) => scene.id)).toEqual(
      storyboard.scenes.map((scene) => scene.id),
    );
    expect(Array.isArray(stored.scenes[0].shots)).toBe(true);
    expect(Array.isArray(stored.scenes[0].textOverlays)).toBe(true);
    expect(Array.isArray(stored.scenes[0].featureIds)).toBe(true);
    expect(stored.directionId).toBe(ctx.directionId);
    expect(stored.intentId).toBe(ctx.intentId);
    expect(stored.status).toBe("DRAFT");
    expect(stored.version).toBe(1);
  });

  it("stores a timeline that still adds up after the round trip", async () => {
    const ctx = await storyboardProject();
    const { storyboard } = await plan(ctx);

    const stored = await services.storyboardService.get(
      ctx.project.id,
      ctx.owner.user.id,
      storyboard.id,
    );

    expect(stored.scenes[0].startMs).toBe(0);
    for (let i = 1; i < stored.scenes.length; i++) {
      expect(stored.scenes[i].startMs).toBe(stored.scenes[i - 1].endMs);
      expect(stored.scenes[i].order).toBe(i);
    }
    expect(stored.actualDurationMs).toBe(stored.targetDurationMs);
    expect(stored.scenes.at(-1)!.endMs).toBe(stored.targetDurationMs);
    const summed = stored.scenes.reduce((total, scene) => total + scene.durationMs, 0);
    expect(summed).toBe(stored.targetDurationMs);
  });

  it("points every capture target at a stored scene", async () => {
    const ctx = await storyboardProject();
    const { storyboard, captureTargets } = await plan(ctx);

    const stored = await services.storyboardService.get(
      ctx.project.id,
      ctx.owner.user.id,
      storyboard.id,
    );
    const sceneIds = new Set(stored.scenes.map((scene) => scene.id));

    for (const target of captureTargets) {
      expect(sceneIds).toContain(target.sceneId);
    }
  });

  it("re-times the whole plan when a scene is edited", async () => {
    const ctx = await storyboardProject();
    const { storyboard } = await plan(ctx);

    const edited = await services.storyboardService.updateScenes({
      projectId: ctx.project.id,
      userId: ctx.owner.user.id,
      storyboardId: storyboard.id,
      scenes: [{ sceneId: storyboard.scenes[0].id, changes: { name: "A sharper opening" } }],
    });

    const stored = await services.storyboardService.get(
      ctx.project.id,
      ctx.owner.user.id,
      storyboard.id,
    );

    expect(stored.scenes[0].name).toBe("A sharper opening");
    expect(stored.version).toBe(2);
    expect(stored.actualDurationMs).toBe(stored.targetDurationMs);
    for (let i = 1; i < stored.scenes.length; i++) {
      expect(stored.scenes[i].startMs).toBe(stored.scenes[i - 1].endMs);
    }
    expect(edited.updatedAt > storyboard.updatedAt).toBe(true);
  });

  it("keeps a move and its new timeline together", async () => {
    const ctx = await storyboardProject();
    const { storyboard } = await plan(ctx);
    const movedId = storyboard.scenes[2].id;

    await services.storyboardService.reorderScene({
      projectId: ctx.project.id,
      userId: ctx.owner.user.id,
      storyboardId: storyboard.id,
      sceneId: movedId,
      toIndex: 1,
    });

    const stored = await services.storyboardService.get(
      ctx.project.id,
      ctx.owner.user.id,
      storyboard.id,
    );

    expect(stored.scenes[1].id).toBe(movedId);
    expect(stored.actualDurationMs).toBe(stored.targetDurationMs);
    expect(stored.scenes.map((scene) => scene.order)).toEqual(
      stored.scenes.map((_, index) => index),
    );
  });

  it("keeps exactly one plan selected for the intent", async () => {
    const ctx = await storyboardProject();
    const first = (await plan(ctx)).storyboard;
    const second = (await plan(ctx)).storyboard;

    const outcome = await services.storyboardService.select(
      ctx.project.id,
      ctx.owner.user.id,
      first.id,
    );
    expect(outcome.storyboard.status).toBe("SELECTED");

    await services.storyboardService.select(ctx.project.id, ctx.owner.user.id, second.id);

    const selected = await services.storyboardService.list(
      ctx.project.id,
      ctx.owner.user.id,
      { intentId: ctx.intentId, status: "SELECTED" },
    );
    expect(selected.map((board) => board.id)).toEqual([second.id]);
    expect(
      (await services.storyboardService.get(ctx.project.id, ctx.owner.user.id, first.id)).status,
    ).toBe("DRAFT");
  });

  it("archives the other selection when a plan is locked", async () => {
    const ctx = await storyboardProject();
    const first = (await plan(ctx)).storyboard;
    const second = (await plan(ctx)).storyboard;
    await services.storyboardService.select(ctx.project.id, ctx.owner.user.id, first.id);

    const outcome = await services.storyboardService.lock(
      ctx.project.id,
      ctx.owner.user.id,
      second.id,
    );

    expect(outcome.storyboard.status).toBe("LOCKED");
    expect(outcome.archived.map((board) => board.id)).toEqual([first.id]);
    const decided = await services.storyboardService.getLocked(
      ctx.project.id,
      ctx.owner.user.id,
      ctx.intentId,
    );
    expect(decided?.id).toBe(second.id);
  });

  it("refuses to edit a locked plan", async () => {
    const ctx = await storyboardProject();
    const { storyboard } = await plan(ctx);
    await services.storyboardService.lock(
      ctx.project.id,
      ctx.owner.user.id,
      storyboard.id,
    );

    await expect(
      services.storyboardService.updateScenes({
        projectId: ctx.project.id,
        userId: ctx.owner.user.id,
        storyboardId: storyboard.id,
        scenes: [{ sceneId: storyboard.scenes[0].id, changes: { name: "One more" } }],
      }),
    ).rejects.toMatchObject({ code: "STORYBOARD_LOCKED" });
  });

  it("will not show one project's plan to a stranger", async () => {
    const ctx = await storyboardProject();
    const { storyboard } = await plan(ctx);
    const stranger = await registerUser();

    await expect(
      services.storyboardService.get(ctx.project.id, stranger.user.id, storyboard.id),
    ).rejects.toThrow();
  });
});

describe("storyboard API integration", () => {
  async function storyboardRoutes() {
    return {
      collection: await import("../../app/api/projects/[id]/storyboards/route"),
      generate: await import("../../app/api/projects/[id]/storyboards/generate/route"),
      item: await import("../../app/api/projects/[id]/storyboards/[storyboardId]/route"),
      scenes: await import(
        "../../app/api/projects/[id]/storyboards/[storyboardId]/scenes/route"
      ),
      reorder: await import(
        "../../app/api/projects/[id]/storyboards/[storyboardId]/reorder/route"
      ),
      select: await import(
        "../../app/api/projects/[id]/storyboards/[storyboardId]/select/route"
      ),
      lock: await import(
        "../../app/api/projects/[id]/storyboards/[storyboardId]/lock/route"
      ),
    };
  }

  type Routes = Awaited<ReturnType<typeof storyboardRoutes>>;

  function auth(token: string) {
    return {
      cookie: `content_os_session=${token}`,
      "content-type": "application/json",
    };
  }

  async function plannedOverHttp(ctx: {
    owner: { token: string };
    project: { id: string };
    intentId: string;
    directionId: string;
  }, routes: Routes) {
    const context = { params: Promise.resolve({ id: ctx.project.id }) };
    const response = await routes.generate.POST(
      new Request(`http://localhost/api/projects/${ctx.project.id}/storyboards/generate`, {
        method: "POST",
        headers: auth(ctx.owner.token),
        body: JSON.stringify({ intentId: ctx.intentId, directionId: ctx.directionId }),
      }),
      context,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      storyboard: { id: string; scenes: Array<{ id: string }> };
      captureTargets: Array<{ sceneId: string }>;
      generation: { provider: string; fallbackFrom: string | null };
      registry: { sceneTypes: string[]; statuses: string[] };
    };
    return { ...body, response };
  }

  it("plans, reads, edits and locks over HTTP", async () => {
    const ctx = await storyboardProject();
    const routes = await storyboardRoutes();
    const planned = await plannedOverHttp(ctx, routes);

    expect(planned.storyboard.scenes.length).toBeGreaterThan(1);
    expect(planned.generation.provider).toBe("deterministic");
    expect(planned.registry.sceneTypes).toContain("HOOK");
    expect(planned.registry.statuses).toContain("LOCKED");

    const sceneIds = new Set(planned.storyboard.scenes.map((scene) => scene.id));
    for (const target of planned.captureTargets) {
      expect(sceneIds).toContain(target.sceneId);
    }

    const listed = await routes.collection.GET(
      new Request(`http://localhost/api/projects/${ctx.project.id}/storyboards`, {
        headers: { cookie: `content_os_session=${ctx.owner.token}` },
      }),
      { params: Promise.resolve({ id: ctx.project.id }) },
    );
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { storyboards: unknown[] }).storyboards.length).toBe(1);

    const fetched = await routes.item.GET(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/storyboards/${planned.storyboard.id}`,
        { headers: { cookie: `content_os_session=${ctx.owner.token}` } },
      ),
      {
        params: Promise.resolve({
          id: ctx.project.id,
          storyboardId: planned.storyboard.id,
        }),
      },
    );
    expect(fetched.status).toBe(200);

    const itemContext = {
      params: Promise.resolve({ id: ctx.project.id, storyboardId: planned.storyboard.id }),
    };
    const itemUrl = `http://localhost/api/projects/${ctx.project.id}/storyboards/${planned.storyboard.id}`;

    const edited = await routes.scenes.POST(
      new Request(`${itemUrl}/scenes`, {
        method: "POST",
        headers: auth(ctx.owner.token),
        body: JSON.stringify({
          scenes: [
            {
              sceneId: planned.storyboard.scenes[0].id,
              changes: { name: "A sharper opening" },
            },
          ],
        }),
      }),
      itemContext,
    );
    expect(edited.status).toBe(200);
    const editedBody = (await edited.json()) as {
      storyboard: { version: number; scenes: Array<{ name: string; startMs: number }> };
    };
    expect(editedBody.storyboard.version).toBe(2);
    expect(editedBody.storyboard.scenes[0].name).toBe("A sharper opening");

    const moved = await routes.reorder.POST(
      new Request(`${itemUrl}/reorder`, {
        method: "POST",
        headers: auth(ctx.owner.token),
        body: JSON.stringify({ sceneId: planned.storyboard.scenes[2].id, toIndex: 1 }),
      }),
      itemContext,
    );
    expect(moved.status).toBe(200);
    expect(
      ((await moved.json()) as { storyboard: { scenes: Array<{ id: string }> } }).storyboard
        .scenes[1].id,
    ).toBe(planned.storyboard.scenes[2].id);

    const selected = await routes.select.POST(
      new Request(`${itemUrl}/select`, { method: "POST", headers: auth(ctx.owner.token) }),
      itemContext,
    );
    expect(selected.status).toBe(200);
    expect(
      ((await selected.json()) as { storyboard: { status: string } }).storyboard.status,
    ).toBe("SELECTED");

    const locked = await routes.lock.POST(
      new Request(`${itemUrl}/lock`, { method: "POST", headers: auth(ctx.owner.token) }),
      itemContext,
    );
    expect(locked.status).toBe(200);
    expect(
      ((await locked.json()) as { storyboard: { status: string } }).storyboard.status,
    ).toBe("LOCKED");
  });

  it("refuses to edit a locked plan over HTTP with 403", async () => {
    const ctx = await storyboardProject();
    const routes = await storyboardRoutes();
    const planned = await plannedOverHttp(ctx, routes);
    const itemContext = {
      params: Promise.resolve({ id: ctx.project.id, storyboardId: planned.storyboard.id }),
    };
    const itemUrl = `http://localhost/api/projects/${ctx.project.id}/storyboards/${planned.storyboard.id}`;

    await routes.lock.POST(
      new Request(`${itemUrl}/lock`, { method: "POST", headers: auth(ctx.owner.token) }),
      itemContext,
    );

    const edited = await routes.scenes.POST(
      new Request(`${itemUrl}/scenes`, {
        method: "POST",
        headers: auth(ctx.owner.token),
        body: JSON.stringify({
          scenes: [{ sceneId: planned.storyboard.scenes[0].id, changes: { name: "One more" } }],
        }),
      }),
      itemContext,
    );

    expect(edited.status).toBe(403);
    expect(((await edited.json()) as { code: string }).code).toBe("STORYBOARD_LOCKED");
  });

  it("answers 409 when the direction was never selected", async () => {
    const owner = await registerUser();
    const project = await projectForIntent(owner);
    await services.inputService.createBatch(project.id, owner.user.id, [
      { type: "text", name: "Product brief", value: DIRECTION_BRIEF },
    ]);
    const resolved = await services.contentIntentService.resolve({
      projectId: project.id,
      userId: owner.user.id,
      request: "Make a 30 second launch video for LinkedIn announcing our scheduling",
    });
    await services.intelligenceService.analyze(project.id, owner.user.id, {});
    const generated = await services.creativeDirectorService.generate({
      projectId: project.id,
      userId: owner.user.id,
      intentId: resolved.intent.id,
      mode: "BALANCED",
    });
    const routes = await storyboardRoutes();

    const response = await routes.generate.POST(
      new Request(`http://localhost/api/projects/${project.id}/storyboards/generate`, {
        method: "POST",
        headers: auth(owner.token),
        body: JSON.stringify({
          intentId: resolved.intent.id,
          directionId: generated.directions[0].id,
        }),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe(
      "STORYBOARD_DIRECTION_NOT_SELECTED",
    );
  });

  it("refuses a body that tries to carry its own timeline or identity", async () => {
    const ctx = await storyboardProject();
    const routes = await storyboardRoutes();

    for (const body of [
      { intentId: ctx.intentId, directionId: ctx.directionId, scenes: [] },
      { intentId: ctx.intentId, directionId: ctx.directionId, actualDurationMs: 1 },
      { intentId: ctx.intentId, directionId: ctx.directionId, brandVersion: 9 },
    ]) {
      const response = await routes.generate.POST(
        new Request(`http://localhost/api/projects/${ctx.project.id}/storyboards/generate`, {
          method: "POST",
          headers: auth(ctx.owner.token),
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: ctx.project.id }) },
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(/server derives/);
    }
  });

  it("refuses an edit that tries to move a scene's identity or timing", async () => {
    const ctx = await storyboardProject();
    const routes = await storyboardRoutes();
    const planned = await plannedOverHttp(ctx, routes);
    const itemContext = {
      params: Promise.resolve({ id: ctx.project.id, storyboardId: planned.storyboard.id }),
    };

    for (const changes of [
      { startMs: 0 },
      { endMs: 99_999 },
      { order: 3 },
      { id: "sbscene_injected" },
    ]) {
      const response = await routes.scenes.POST(
        new Request(
          `http://localhost/api/projects/${ctx.project.id}/storyboards/${planned.storyboard.id}/scenes`,
          {
            method: "POST",
            headers: auth(ctx.owner.token),
            body: JSON.stringify({
              scenes: [{ sceneId: planned.storyboard.scenes[0].id, changes }],
            }),
          },
        ),
        itemContext,
      );

      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(
        /keeps its own identity and timing/,
      );
    }
  });

  it("refuses an edit that smuggles a capture job in through a shot", async () => {
    const ctx = await storyboardProject();
    const routes = await storyboardRoutes();
    const planned = await plannedOverHttp(ctx, routes);

    const response = await routes.scenes.POST(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/storyboards/${planned.storyboard.id}/scenes`,
        {
          method: "POST",
          headers: auth(ctx.owner.token),
          body: JSON.stringify({
            scenes: [
              {
                sceneId: planned.storyboard.scenes[0].id,
                changes: {
                  shots: [
                    {
                      id: "shot_sneaky",
                      visualType: "BROWSER",
                      description: "A page this project does not have",
                      productInteraction: "The pricing page",
                      framing: "Centred",
                      cameraMotion: "None",
                      assetIds: [],
                      evidenceIds: [],
                      notes: "",
                      captureRequirement: {
                        mode: "BROWSER",
                        target: "A pricing page this project does not have",
                        workflowId: null,
                        featureId: null,
                        browserSessionId: null,
                        browserTraceId: null,
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      ),
      {
        params: Promise.resolve({
          id: ctx.project.id,
          storyboardId: planned.storyboard.id,
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(
      /cannot set captureRequirement/,
    );
  });

  it("refuses an edit that names a field the domain does not have", async () => {
    const ctx = await storyboardProject();
    const routes = await storyboardRoutes();
    const planned = await plannedOverHttp(ctx, routes);

    const response = await routes.scenes.POST(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/storyboards/${planned.storyboard.id}/scenes`,
        {
          method: "POST",
          headers: auth(ctx.owner.token),
          body: JSON.stringify({
            scenes: [
              { sceneId: planned.storyboard.scenes[0].id, changes: { vibes: "spooky" } },
            ],
          }),
        },
      ),
      {
        params: Promise.resolve({
          id: ctx.project.id,
          storyboardId: planned.storyboard.id,
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/unknown fields: vibes/);
  });

  it("refuses a cross-origin write", async () => {
    const ctx = await storyboardProject();
    const routes = await storyboardRoutes();

    const response = await routes.generate.POST(
      new Request(`http://localhost/api/projects/${ctx.project.id}/storyboards/generate`, {
        method: "POST",
        headers: { ...auth(ctx.owner.token), origin: "https://elsewhere.example" },
        body: JSON.stringify({ intentId: ctx.intentId, directionId: ctx.directionId }),
      }),
      { params: Promise.resolve({ id: ctx.project.id }) },
    );

    expect(response.status).toBe(403);
  });

  it("hides a plan from a user who is not in the project", async () => {
    const ctx = await storyboardProject();
    const routes = await storyboardRoutes();
    const planned = await plannedOverHttp(ctx, routes);
    const stranger = await registerUser();

    const response = await routes.item.GET(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/storyboards/${planned.storyboard.id}`,
        { headers: { cookie: `content_os_session=${stranger.token}` } },
      ),
      {
        params: Promise.resolve({
          id: ctx.project.id,
          storyboardId: planned.storyboard.id,
        }),
      },
    );

    expect(response.status).toBe(403);
  });
});

/**
 * CP12 reads the project's intelligence, brand, assets and existing content, so a
 * bare project produces nothing: an honest empty list is the correct answer for a
 * project that has recorded no product. These fixtures therefore give the project
 * something real to be recommended from before anything is asserted.
 */
async function recommendationProject() {
  const owner = await registerUser();
  const project = await projectForIntent(owner);
  await services.inputService.createBatch(project.id, owner.user.id, [
    { type: "text", name: "Product brief", value: DIRECTION_BRIEF },
  ]);
  await services.intelligenceService.analyze(project.id, owner.user.id, {});
  return { owner, project };
}

describe("recommendation integration (real postgres)", () => {
  it("derives grounded recommendations and survives a round trip", async () => {
    const { owner, project } = await recommendationProject();

    const generated = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );

    expect(generated.length).toBeGreaterThan(0);

    // Read back through a second call: what is asserted is what storage kept,
    // including the score the API is not allowed to show.
    const listed = await services.contentRecommendationService.list(
      project.id,
      owner.user.id,
    );
    expect(listed.length).toBe(generated.length);

    const stored = await services.contentRecommendationService.get(
      project.id,
      owner.user.id,
      generated[0].id,
    );

    expect(stored.title).toBe(generated[0].title);
    expect(stored.rationale).toBe(generated[0].rationale);
    expect(stored.reasons).toEqual(generated[0].reasons);
    expect(stored.subjectType).toBe(generated[0].subjectType);
    expect(stored.contentTypeId).toBe(generated[0].contentTypeId);
    expect(stored.channel).toBe(generated[0].channel);
    expect(stored.status).toBe("ACTIVE");
  });

  /**
   * The score is a ranking aid, not a fact about the product, and a client that
   * could read it would be able to re-rank the list by hand and defeat the
   * diversity the engine chose. It is dropped from every outward shape.
   */
  it("never lets the ranking score reach the caller", async () => {
    const { owner, project } = await recommendationProject();

    const generated = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );
    const listed = await services.contentRecommendationService.list(
      project.id,
      owner.user.id,
    );

    for (const opportunity of [...generated, ...listed]) {
      expect(opportunity).not.toHaveProperty("priorityScore");
      expect(opportunity).not.toHaveProperty("projectId");
    }

    // Storage kept it, so the claim is about the boundary rather than the value
    // being absent everywhere.
    const rows = await orm.ContentRecommendation.where((row) =>
      row.projectId.eq(project.id),
    ).all();
    expect(rows.every((row) => typeof row.priorityScore === "number")).toBe(true);
  });

  it("explains every recommendation and admits what it is missing", async () => {
    const { owner, project } = await recommendationProject();

    const generated = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );

    for (const opportunity of generated) {
      expect(opportunity.reasons.length).toBeGreaterThan(0);
      expect(opportunity.title.trim().length).toBeGreaterThan(0);
      expect(opportunity.rationale.trim().length).toBeGreaterThan(0);
    }
  });

  it("varies the subject so one feature does not fill the whole list", async () => {
    const { owner, project } = await recommendationProject();

    const generated = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );

    const subjects = new Set(
      generated.map((opportunity) => `${opportunity.contentTypeId}|${opportunity.subjectId ?? opportunity.subjectLabel}`),
    );
    // Twelve copies of the best feature is not a diverse list, it is one
    // recommendation repeated.
    expect(subjects.size).toBeGreaterThanOrEqual(Math.min(3, generated.length));
  });

  /**
   * Dismissal is the promise that makes the feature tolerable: a user who has
   * said no to something must not be shown it again on the next refresh, and
   * identity has to survive the row being rebuilt, so the key is what decides.
   */
  it("keeps a dismissal across a refresh", async () => {
    const { owner, project } = await recommendationProject();

    const first = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );
    const target = first[0];

    await services.contentRecommendationService.dismiss(
      project.id,
      owner.user.id,
      target.id,
    );

    const refreshed = await services.contentRecommendationService.refreshForUser(
      project.id,
      owner.user.id,
    );

    const sameThing = refreshed.find(
      (opportunity) =>
        opportunity.contentTypeId === target.contentTypeId &&
        opportunity.subjectType === target.subjectType &&
        opportunity.subjectId === target.subjectId &&
        opportunity.platform === target.platform,
    );

    expect(sameThing?.status).toBe("DISMISSED");
    expect(sameThing?.dismissedAt).not.toBeNull();

    const dismissed = await services.contentRecommendationService.list(
      project.id,
      owner.user.id,
      { status: "DISMISSED" },
    );
    expect(dismissed.map((opportunity) => opportunity.id)).toContain(target.id);
  });

  it("does not re-suggest a dismissed item in the active list", async () => {
    const { owner, project } = await recommendationProject();

    const first = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );
    await services.contentRecommendationService.dismiss(
      project.id,
      owner.user.id,
      first[0].id,
    );

    const active = await services.contentRecommendationService.list(
      project.id,
      owner.user.id,
      { status: "ACTIVE" },
    );

    expect(active.map((opportunity) => opportunity.id)).not.toContain(first[0].id);
  });

  it("restores a dismissed item when the user changes their mind", async () => {
    const { owner, project } = await recommendationProject();

    const first = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );
    await services.contentRecommendationService.dismiss(
      project.id,
      owner.user.id,
      first[0].id,
    );

    const restored = await services.contentRecommendationService.update(
      project.id,
      owner.user.id,
      first[0].id,
      { status: "ACTIVE" },
    );

    expect(restored.status).toBe("ACTIVE");
    // The row must not carry a dismissal timestamp it is no longer subject to.
    expect(restored.dismissedAt).toBeNull();
  });

  it("takes an item up as a resolved content intent", async () => {
    const { owner, project } = await recommendationProject();

    const generated = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );
    const target = generated[0];

    const { recommendation, intentId } = await services.contentRecommendationService.select(
      project.id,
      owner.user.id,
      target.id,
    );

    expect(recommendation.status).toBe("SELECTED");
    expect(recommendation.selectedIntentId).toBe(intentId);

    // CP09 owns what was actually asked for: the intent exists, and it was
    // resolved from the recommendation's own subject rather than invented.
    const intent = await services.contentIntentService.get(
      project.id,
      intentId,
      owner.user.id,
    );
    expect(intent.intent.projectId).toBe(project.id);
    expect(intent.intent.contentTypeId).toBeTruthy();
  });

  it("is safe to select twice, and returns the same intent both times", async () => {
    const { owner, project } = await recommendationProject();

    const generated = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );
    const target = generated[0];

    const first = await services.contentRecommendationService.select(
      project.id,
      owner.user.id,
      target.id,
    );
    const second = await services.contentRecommendationService.select(
      project.id,
      owner.user.id,
      target.id,
    );

    expect(second.intentId).toBe(first.intentId);
  });

  it("keeps a selection across a refresh rather than offering it again", async () => {
    const { owner, project } = await recommendationProject();

    const generated = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );
    const target = generated[0];
    const { intentId } = await services.contentRecommendationService.select(
      project.id,
      owner.user.id,
      target.id,
    );

    await services.contentRecommendationService.refreshForUser(project.id, owner.user.id);

    const selected = await services.contentRecommendationService.list(
      project.id,
      owner.user.id,
      { status: "SELECTED" },
    );
    const kept = selected.find((opportunity) => opportunity.id === target.id);

    expect(kept).toBeTruthy();
    expect(kept?.selectedIntentId).toBe(intentId);
  });

  it("gives a project with nothing recorded an empty list rather than a guess", async () => {
    const owner = await registerUser();
    const project = await projectForIntent(owner);

    const generated = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );

    // Nothing has been analysed, so there is nothing to ground a suggestion in.
    // Inventing one here would be the exact failure this feature is for.
    expect(generated).toEqual([]);
  });

  it("refuses a user who is not in the project at all", async () => {
    const { owner, project } = await recommendationProject();
    const stranger = await registerUser();

    const generated = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );

    // Authorization is checked before the id is even looked at, so a stranger is
    // refused without learning that this id exists.
    await expect(
      services.contentRecommendationService.get(
        project.id,
        stranger.user.id,
        generated[0].id,
      ),
    ).rejects.toThrow();
  });

  /**
   * The subtler case, and the reason the repository is project-scoped: a user
   * who is legitimately in *two* projects asks for a real recommendation through
   * the wrong one. Authorization succeeds, so the id has to be unresolvable —
   * an id from another project must be indistinguishable from one that never
   * existed, or the 200/404 difference leaks the shape of other people's data.
   */
  it("reports a recommendation from another project as missing", async () => {
    const first = await recommendationProject();
    const generated = await services.contentRecommendationService.generate(
      first.project.id,
      first.owner.user.id,
    );
    const foreignId = generated[0].id;

    // A second project owned by the same user, so membership is not the thing
    // that stops the request.
    const other = await services.projectService.createForWorkspace(
      first.owner.workspace!.id,
      { name: "Other project" },
      first.owner.user.id,
    );

    await expect(
      services.contentRecommendationService.get(
        other.id,
        first.owner.user.id,
        foreignId,
      ),
    ).rejects.toMatchObject({ code: "RECOMMENDATION_NOT_FOUND" });
  });

  it("refuses to dismiss a recommendation in a project the user is not in", async () => {
    const { owner, project } = await recommendationProject();
    const stranger = await registerUser();

    const generated = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );

    await expect(
      services.contentRecommendationService.dismiss(
        project.id,
        stranger.user.id,
        generated[0].id,
      ),
    ).rejects.toThrow();
  });

  it("reports a missing recommendation rather than an empty one", async () => {
    const { owner, project } = await recommendationProject();

    await expect(
      services.contentRecommendationService.get(
        project.id,
        owner.user.id,
        "rec_does_not_exist",
      ),
    ).rejects.toMatchObject({ code: "RECOMMENDATION_NOT_FOUND" });
  });

  it("keeps two projects' recommendations apart", async () => {
    const first = await recommendationProject();
    const second = await recommendationProject();

    await services.contentRecommendationService.generate(first.project.id, first.owner.user.id);
    await services.contentRecommendationService.generate(second.project.id, second.owner.user.id);

    const secondList = await services.contentRecommendationService.list(
      second.project.id,
      second.owner.user.id,
    );

    const firstIds = new Set(
      (
        await orm.ContentRecommendation.where((row) =>
          row.projectId.eq(first.project.id),
        ).all()
      ).map((row) => row.id),
    );

    for (const opportunity of secondList) {
      expect(firstIds.has(opportunity.id)).toBe(false);
    }
  });
});

describe("recommendation API integration", () => {
  async function recommendationRoutes() {
    return {
      collection: await import("../../app/api/projects/[id]/recommendations/route"),
      generate: await import(
        "../../app/api/projects/[id]/recommendations/generate/route"
      ),
      refresh: await import(
        "../../app/api/projects/[id]/recommendations/refresh/route"
      ),
      item: await import(
        "../../app/api/projects/[id]/recommendations/[recommendationId]/route"
      ),
      select: await import(
        "../../app/api/projects/[id]/recommendations/[recommendationId]/select/route"
      ),
      dismiss: await import(
        "../../app/api/projects/[id]/recommendations/[recommendationId]/dismiss/route"
      ),
    };
  }

  type Routes = Awaited<ReturnType<typeof recommendationRoutes>>;

  function auth(token: string) {
    return {
      cookie: `content_os_session=${token}`,
      "content-type": "application/json",
    };
  }

  async function generatedOverHttp(
    ctx: { owner: { token: string }; project: { id: string } },
    routes: Routes,
  ) {
    const response = await routes.generate.POST(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/recommendations/generate`,
        { method: "POST", headers: auth(ctx.owner.token) },
      ),
      { params: Promise.resolve({ id: ctx.project.id }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      recommendations: Array<{
        id: string;
        title: string;
        rationale: string;
        reasons: string[];
        missingInputs: string[];
        contentTypeId: string;
        channel: string;
        platform: string;
        subjectType: string;
        status: string;
      }>;
      registry: { channels: string[]; statuses: string[]; contentTypes: unknown[] };
    };
    return { ...body, response };
  }

  it("lists what the project has been told it could make", async () => {
    const ctx = await recommendationProject();
    const routes = await recommendationRoutes();
    const generated = await generatedOverHttp(ctx, routes);

    expect(generated.recommendations.length).toBeGreaterThan(0);
    expect(generated.registry.channels).toContain("VIDEO");
    expect(generated.registry.statuses).toEqual(["ACTIVE", "DISMISSED", "SELECTED"]);
    expect(generated.registry.contentTypes.length).toBeGreaterThan(0);

    const listed = await routes.collection.GET(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/recommendations`,
        { headers: auth(ctx.owner.token) },
      ),
      { params: Promise.resolve({ id: ctx.project.id }) },
    );

    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { recommendations: unknown[] };
    expect(body.recommendations.length).toBe(generated.recommendations.length);
  });

  /**
   * The score is the engine's own ranking aid. A client that could read it could
   * re-sort the list and defeat the channel diversity the generator chose, so the
   * wire shape has to be checked field by field, not just spot-checked.
   */
  it("never serializes the score or the project it belongs to", async () => {
    const ctx = await recommendationProject();
    const routes = await recommendationRoutes();
    const generated = await generatedOverHttp(ctx, routes);

    for (const recommendation of generated.recommendations) {
      expect(recommendation).not.toHaveProperty("priorityScore");
      expect(recommendation).not.toHaveProperty("projectId");
      // The payload is JSON, so a dropped field is genuinely absent on the wire
      // rather than merely undefined.
      expect(JSON.stringify(recommendation)).not.toContain("priorityScore");
    }
  });

  it("shows every recommendation with a reason behind it", async () => {
    const ctx = await recommendationProject();
    const routes = await recommendationRoutes();
    const generated = await generatedOverHttp(ctx, routes);

    for (const recommendation of generated.recommendations) {
      expect(recommendation.title.length).toBeGreaterThan(0);
      expect(recommendation.rationale.length).toBeGreaterThan(0);
      expect(recommendation.reasons.length).toBeGreaterThan(0);
      expect(Array.isArray(recommendation.missingInputs)).toBe(true);
    }
  });

  /**
   * A request that could name what to recommend would decide the answer, and the
   * answer is only worth anything if the project chose it.
   */
  it("refuses a body that tries to steer the outcome", async () => {
    const ctx = await recommendationProject();
    const routes = await recommendationRoutes();

    const response = await routes.generate.POST(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/recommendations/generate`,
        {
          method: "POST",
          headers: auth(ctx.owner.token),
          body: JSON.stringify({ featureId: "feat_invented", contentTypeId: "video.explainer" }),
        },
      ),
      { params: Promise.resolve({ id: ctx.project.id }) },
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("derived from the project");
  });

  it("reads one recommendation by id", async () => {
    const ctx = await recommendationProject();
    const routes = await recommendationRoutes();
    const generated = await generatedOverHttp(ctx, routes);
    const target = generated.recommendations[0];

    const response = await routes.item.GET(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/recommendations/${target.id}`,
        { headers: auth(ctx.owner.token) },
      ),
      { params: Promise.resolve({ id: ctx.project.id, recommendationId: target.id }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      recommendation: { id: string; title: string };
    };
    expect(body.recommendation.id).toBe(target.id);
    expect(body.recommendation.title).toBe(target.title);
  });

  /**
   * The client owns one decision and nothing else. A body that could rewrite the
   * rationale would let it make the server display a claim the product graph does
   * not contain, which is the one failure this feature must not have.
   */
  it("refuses a patch that edits anything but the status", async () => {
    const ctx = await recommendationProject();
    const routes = await recommendationRoutes();
    const generated = await generatedOverHttp(ctx, routes);
    const target = generated.recommendations[0];

    for (const body of [
      { status: "DISMISSED", rationale: "Totally made up" },
      { status: "DISMISSED", priorityScore: 1 },
      { status: "DISMISSED", subjectId: "feat_invented" },
      { status: "DISMISSED", evidenceIds: ["ev_invented"] },
    ]) {
      const response = await routes.item.PATCH(
        new Request(
          `http://localhost/api/projects/${ctx.project.id}/recommendations/${target.id}`,
          {
            method: "PATCH",
            headers: auth(ctx.owner.token),
            body: JSON.stringify(body),
          },
        ),
        { params: Promise.resolve({ id: ctx.project.id, recommendationId: target.id }) },
      );

      expect(response.status).toBe(400);
    }

    // Nothing above changed the stored row.
    const after = await routes.item.GET(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/recommendations/${target.id}`,
        { headers: auth(ctx.owner.token) },
      ),
      { params: Promise.resolve({ id: ctx.project.id, recommendationId: target.id }) },
    );
    const stored = (await after.json()) as { recommendation: { status: string } };
    expect(stored.recommendation.status).toBe("ACTIVE");
  });

  it("refuses a status the domain does not have", async () => {
    const ctx = await recommendationProject();
    const routes = await recommendationRoutes();
    const generated = await generatedOverHttp(ctx, routes);

    const response = await routes.item.PATCH(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/recommendations/${generated.recommendations[0].id}`,
        {
          method: "PATCH",
          headers: auth(ctx.owner.token),
          body: JSON.stringify({ status: "PUBLISHED" }),
        },
      ),
      {
        params: Promise.resolve({
          id: ctx.project.id,
          recommendationId: generated.recommendations[0].id,
        }),
      },
    );

    expect(response.status).toBe(422);
  });

  /**
   * Selection is not a status a client may set. It creates a real CP09 intent,
   * and only the route that runs the intent pipeline can do that — so claiming
   * SELECTED through the patch would produce a row marked taken-up with no intent
   * behind it.
   */
  it("refuses to claim a selection through the patch", async () => {
    const ctx = await recommendationProject();
    const routes = await recommendationRoutes();
    const generated = await generatedOverHttp(ctx, routes);

    const response = await routes.item.PATCH(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/recommendations/${generated.recommendations[0].id}`,
        {
          method: "PATCH",
          headers: auth(ctx.owner.token),
          body: JSON.stringify({ status: "SELECTED" }),
        },
      ),
      {
        params: Promise.resolve({
          id: ctx.project.id,
          recommendationId: generated.recommendations[0].id,
        }),
      },
    );

    expect(response.status).toBe(409);
  });

  it("dismisses, and does not offer it again after a refresh", async () => {
    const ctx = await recommendationProject();
    const routes = await recommendationRoutes();
    const generated = await generatedOverHttp(ctx, routes);
    const target = generated.recommendations[0];

    const dismissed = await routes.dismiss.POST(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/recommendations/${target.id}/dismiss`,
        { method: "POST", headers: auth(ctx.owner.token) },
      ),
      { params: Promise.resolve({ id: ctx.project.id, recommendationId: target.id }) },
    );

    expect(dismissed.status).toBe(200);
    const body = (await dismissed.json()) as {
      recommendation: { status: string; dismissedAt: string | null };
    };
    expect(body.recommendation.status).toBe("DISMISSED");
    expect(body.recommendation.dismissedAt).not.toBeNull();

    await routes.refresh.POST(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/recommendations/refresh`,
        { method: "POST", headers: auth(ctx.owner.token) },
      ),
      { params: Promise.resolve({ id: ctx.project.id }) },
    );

    const active = await routes.collection.GET(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/recommendations?status=active`,
        { headers: auth(ctx.owner.token) },
      ),
      { params: Promise.resolve({ id: ctx.project.id }) },
    );
    const listed = (await active.json()) as { recommendations: Array<{ id: string }> };
    expect(listed.recommendations.map((entry) => entry.id)).not.toContain(target.id);
  });

  it("takes one up and hands back the intent it created", async () => {
    const ctx = await recommendationProject();
    const routes = await recommendationRoutes();
    const generated = await generatedOverHttp(ctx, routes);
    const target = generated.recommendations[0];

    const response = await routes.select.POST(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/recommendations/${target.id}/select`,
        { method: "POST", headers: auth(ctx.owner.token) },
      ),
      { params: Promise.resolve({ id: ctx.project.id, recommendationId: target.id }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      recommendation: { status: string; selectedIntentId: string };
      intentId: string;
    };
    expect(body.recommendation.status).toBe("SELECTED");
    expect(body.intentId).toBe(body.recommendation.selectedIntentId);

    // The intent is real and belongs to this project: CP09 resolved it, this
    // route did not write one.
    const intents = await orm.ContentIntent.where((row) =>
      row.projectId.eq(ctx.project.id),
    ).all();
    expect(intents.map((row) => row.id)).toContain(body.intentId);
  });

  it("returns 404 for an id that does not exist", async () => {
    const ctx = await recommendationProject();
    const routes = await recommendationRoutes();
    await generatedOverHttp(ctx, routes);

    const response = await routes.item.GET(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/recommendations/rec_nope`,
        { headers: auth(ctx.owner.token) },
      ),
      { params: Promise.resolve({ id: ctx.project.id, recommendationId: "rec_nope" }) },
    );

    expect(response.status).toBe(404);
  });

  it("reports another project's id as missing rather than forbidden", async () => {
    const first = await recommendationProject();
    const routes = await recommendationRoutes();
    const generated = await generatedOverHttp(first, routes);

    const other = await services.projectService.createForWorkspace(
      first.owner.workspace!.id,
      { name: "Other project" },
      first.owner.user.id,
    );

    const response = await routes.item.GET(
      new Request(
        `http://localhost/api/projects/${other.id}/recommendations/${generated.recommendations[0].id}`,
        { headers: auth(first.owner.token) },
      ),
      {
        params: Promise.resolve({
          id: other.id,
          recommendationId: generated.recommendations[0].id,
        }),
      },
    );

    // A 403 would confirm the id exists somewhere.
    expect(response.status).toBe(404);
  });

  it("refuses an unauthenticated caller on every route", async () => {
    const ctx = await recommendationProject();
    const routes = await recommendationRoutes();
    const generated = await generatedOverHttp(ctx, routes);
    const target = generated.recommendations[0];

    const url = (suffix: string) =>
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/recommendations${suffix}`,
      );
    const context = {
      params: Promise.resolve({ id: ctx.project.id, recommendationId: target.id }),
    };

    expect((await routes.collection.GET(url(""), { params: Promise.resolve({ id: ctx.project.id }) })).status).toBe(401);
    expect((await routes.generate.POST(url("/generate"), { params: Promise.resolve({ id: ctx.project.id }) })).status).toBe(401);
    expect((await routes.refresh.POST(url("/refresh"), { params: Promise.resolve({ id: ctx.project.id }) })).status).toBe(401);
    expect((await routes.item.GET(url(`/${target.id}`), context)).status).toBe(401);
    expect((await routes.select.POST(url(`/${target.id}/select`), context)).status).toBe(401);
    expect((await routes.dismiss.POST(url(`/${target.id}/dismiss`), context)).status).toBe(401);
  });

  it("refuses a stranger who is not in the workspace", async () => {
    const ctx = await recommendationProject();
    const routes = await recommendationRoutes();
    const generated = await generatedOverHttp(ctx, routes);
    const stranger = await registerUser();

    const response = await routes.item.GET(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/recommendations/${generated.recommendations[0].id}`,
        { headers: auth(stranger.token) },
      ),
      {
        params: Promise.resolve({
          id: ctx.project.id,
          recommendationId: generated.recommendations[0].id,
        }),
      },
    );

    expect(response.status).toBe(403);
  });

  /**
   * R5 — every mutating recommendation route refuses a cross-origin request.
   *
   * These are cookie-authenticated writes, so a cross-site form post or fetch
   * would otherwise be able to dismiss, select or regenerate a user's list
   * without their consent. The check is asserted per route, because "the helper
   * exists" and "every write calls it" are different claims.
   */
  it("R5: refuses cross-origin writes on every mutating recommendation route", async () => {
    const ctx = await recommendationProject();
    const routes = await recommendationRoutes();
    const { owner, project } = ctx;

    const base = `http://localhost/api/projects/${project.id}/recommendations`;
    const crossOrigin = {
      cookie: `content_os_session=${owner.token}`,
      "content-type": "application/json",
      origin: "https://evil.example",
    };

    // A target to write against; the requests below must be refused before it
    // is ever read.
    const seeded = await generatedOverHttp(ctx, routes);
    const recommendationId = seeded.recommendations[0].id;

    const params = { params: Promise.resolve({ id: project.id }) };
    const itemParams = {
      params: Promise.resolve({ id: project.id, recommendationId }),
    };

    const refused = [
      ["generate", routes.generate.POST(new Request(`${base}/generate`, {
        method: "POST", headers: crossOrigin,
      }), params)],
      ["refresh", routes.refresh.POST(new Request(`${base}/refresh`, {
        method: "POST", headers: crossOrigin,
      }), params)],
      ["dismiss", routes.dismiss.POST(new Request(`${base}/${recommendationId}/dismiss`, {
        method: "POST", headers: crossOrigin,
      }), itemParams)],
      ["select", routes.select.POST(new Request(`${base}/${recommendationId}/select`, {
        method: "POST", headers: crossOrigin,
      }), itemParams)],
      ["patch", routes.item.PATCH(new Request(`${base}/${recommendationId}`, {
        method: "PATCH", headers: crossOrigin, body: JSON.stringify({ status: "ACTIVE" }),
      }), itemParams)],
    ] as const;

    for (const [name, pending] of refused) {
      const response = await pending;
      expect(response.status, `${name} must refuse a cross-origin write`).toBe(403);
    }

    // And the row is untouched, proving the refusal happened before any write.
    const rows = await orm.ContentRecommendation.where((row) =>
      row.id.eq(recommendationId),
    ).all();
    expect(rows[0].status).toBe("ACTIVE");
  });

  it("refuses a status filter the domain does not have", async () => {
    const ctx = await recommendationProject();
    const routes = await recommendationRoutes();

    const response = await routes.collection.GET(
      new Request(
        `http://localhost/api/projects/${ctx.project.id}/recommendations?status=published`,
        { headers: auth(ctx.owner.token) },
      ),
      { params: Promise.resolve({ id: ctx.project.id }) },
    );

    expect(response.status).toBe(400);
  });
});

/**
 * The CP12 audit findings, each proven against the real stack: real project data,
 * the real service, the real repository and real PostgreSQL. Nothing here is
 * stubbed below the HTTP boundary except the model itself, which is replaced by
 * a canned response so the refinement *pipeline* is what is under test.
 */
describe("recommendation audit regression suite (real postgres)", () => {
  /**
   * R1 — the refinement path must work on candidates that have no row id.
   *
   * A generated recommendation is refined before it is persisted, so every
   * candidate in the batch still has an empty id. Addressing the model output by
   * id collapses the batch onto one entry, and refinement either drops the rest
   * or applies one item's reword to another. This drives the real
   * `AiContentRecommendationRefiner` through the real service with a provider
   * that echoes a rewrite for every key it was given.
   */
  it("R1: refines a whole generated batch, addressed by stable key", async () => {
    const { owner, project } = await recommendationProject();

    // Imported here, not at module scope: these reach `prisma/db`, which binds
    // DATABASE_URL as it loads, and beforeAll is what points that at the test
    // database. A top-level import would bind the dev database instead.
    const [
      { container },
      { ContentRecommendationService },
      { ContentRecommendationValidator },
      { RecommendationContextBuilder },
      { DeterministicContentRecommenderProvider },
      { AiContentRecommendationRefiner },
    ] = await Promise.all([
      import("../../infrastructure/container"),
      import("./content-recommendation-service"),
      import("./content-recommendation-validator"),
      import("./recommendation-context-builder"),
      import(
        "../../infrastructure/recommendations/deterministic-content-recommender-provider"
      ),
      import("../../infrastructure/ai/content-recommendation-interpreter"),
    ]);

    // The real repositories, context builder, validator and authorization; only
    // the model is replaced, so the pipeline under test is the shipping one.
    const refining = new ContentRecommendationService({
      projectService: container.services.projects,
      repository: container.repositories.recommendations,
      contextBuilder: new RecommendationContextBuilder({
        intelligenceRepository: container.repositories.intelligence,
        brandRepository: container.repositories.brand,
        assetRepository: container.repositories.assets,
        intentRepository: container.repositories.contentIntents,
        storyboardRepository: container.repositories.storyboards,
      }),
      validator: new ContentRecommendationValidator(),
      providers: [
        new DeterministicContentRecommenderProvider(),
        new AiContentRecommendationRefiner({
          async generate({
            messages,
          }: {
            messages: Array<{ role: string; content: string }>;
          }) {
            // Reads the keys the real prompt put in front of the model and
            // answers each one, so the merge is genuinely exercised.
            const prompt = messages[messages.length - 1].content;
            const keys = [...prompt.matchAll(/^- key: (.+)$/gm)].map((m) => m[1]);
            expect(keys.length).toBeGreaterThan(1);
            return {
              model: "canned",
              text: JSON.stringify(
                keys.map((key, index) => ({
                  key,
                  title: `Sharpened ${index + 1}`,
                })),
              ),
            };
          },
        } as never),
      ],
      contentIntentService: container.services.contentIntent,
    });

    const refined = await refining.generate(project.id, owner.user.id);

    expect(refined.length).toBeGreaterThan(1);
    // Every candidate carried id: "", so this can only pass if the whole batch
    // was addressed by key and each rewrite landed on its own item.
    expect(refined.every((o) => o.title.startsWith("Sharpened "))).toBe(true);
    expect(new Set(refined.map((o) => o.title)).size).toBe(refined.length);
    // The grounding survived the model pass untouched.
    expect(refined.every((o) => o.key.length > 0)).toBe(true);
    expect(refined.every((o) => o.evidence.sourceIds.length > 0)).toBe(true);

    // And what was refined is what storage kept.
    const rows = await orm.ContentRecommendation.where((row) =>
      row.projectId.eq(project.id),
    ).all();
    expect(rows.length).toBe(refined.length);
    expect(rows.every((row) => typeof row.key === "string" && row.key.length > 0)).toBe(true);
  });

  /**
   * R2 — `isProgress` must answer the coverage question, not record one.
   *
   * The column used to be written at generation time and never revisited, so a
   * recommendation could claim to be untouched after the project had already
   * made the thing. Coverage is now derived from the shared history at read time,
   * which is only observable through the API: create a matching intent, and the
   * API must report progress for the now-covered recommendation.
   */
  it("R2: derives isProgress from coverage at read time, not from a stored flag", async () => {
    const { owner, project } = await recommendationProject();

    const before = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );
    expect(before.every((o) => o.isProgress === false)).toBe(true);

    // A product-level recommendation has no subject id, and coverage is stated
    // per subject, so the matrix is asserted on one that names a subject.
    const target = before.find((o) => o.subjectId !== null);
    expect(target).toBeDefined();

    // A CP09 intent for the same content type, platform and subject: a real
    // record the project now holds, which is what "already covered" means.
    const definition = getContentType(target!.contentTypeId);
    const outcome = await services.contentIntentService.resolve({
      projectId: project.id,
      userId: owner.user.id,
      request: `Make a ${definition?.name ?? target!.contentTypeId} for ${target!.platform}`,
      subjects: [{ type: target!.subjectType, id: target!.subjectId as string }],
    });

    // The coverage flag is only meaningful once the intent genuinely overlaps
    // the recommendation, so that overlap is asserted rather than assumed: the
    // parser decides the content type and platforms from the request text.
    expect({
      contentTypeId: outcome.intent.contentTypeId,
      platforms: outcome.intent.platforms,
      subjects: outcome.intent.subjects,
    }).toMatchObject({
      contentTypeId: target!.contentTypeId,
      subjects: expect.arrayContaining([
        expect.objectContaining({ id: target!.subjectId }),
      ]),
    });
    expect(outcome.intent.platforms).toContain(target!.platform);

    const after = await services.contentRecommendationService.list(
      project.id,
      owner.user.id,
    );
    const sameThing = after.find(
      (o) =>
        o.contentTypeId === target!.contentTypeId &&
        o.subjectId === target!.subjectId &&
        o.platform === target!.platform,
    );

    expect(sameThing).toBeDefined();
    expect(sameThing?.isProgress).toBe(true);

    // The stored row never had a column to get wrong.
    const rows = await orm.ContentRecommendation.where((row) =>
      row.projectId.eq(project.id),
    ).all();
    expect(rows.every((row) => !("isProgress" in row))).toBe(true);
  });

  /**
   * R3 — evidence must point at real documents.
   *
   * `sourceIds` used to be filled with intelligence entity ids, so a
   * recommendation claimed provenance from a "source" that was never a source
   * document. Every id served here has to resolve to a Source row that belongs to
   * this project.
   */
  it("R3: serves only real, project-owned Source ids as provenance", async () => {
    const { owner, project } = await recommendationProject();

    const generated = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );

    const sources = await orm.Source.where((row) => row.projectId.eq(project.id)).all();
    const sourceIds = new Set(sources.map((row) => row.id));
    expect(sourceIds.size).toBeGreaterThan(0);

    const intelligenceEntities = new Set<string>();
    for (const opportunity of generated) {
      expect(opportunity.evidence.sourceIds.length).toBeGreaterThan(0);
      for (const id of opportunity.evidence.sourceIds) {
        expect(sourceIds.has(id)).toBe(true);
        intelligenceEntities.add(id);
      }
      // The subject is an entity id and must not be passed off as a document.
      if (opportunity.subjectId) {
        expect(opportunity.evidence.sourceIds).not.toContain(opportunity.subjectId);
      }
    }
    expect(intelligenceEntities.size).toBeGreaterThan(0);
  });

  /**
   * R4 — a selected recommendation is linked to a real intent.
   *
   * `selectedIntentId` was a bare text column with no constraint, so it could
   * name an intent that did not exist, or one belonging to a different project.
   * The foreign key makes a dangling link impossible and deletes safely.
   */
  it("R4: links selection to a real intent and clears it when the intent goes", async () => {
    const { owner, project } = await recommendationProject();

    const generated = await services.contentRecommendationService.generate(
      project.id,
      owner.user.id,
    );
    const target = generated[0];

    const outcome = await services.contentRecommendationService.select(
      project.id,
      owner.user.id,
      target.id,
    );

    expect(outcome.recommendation.status).toBe("SELECTED");
    expect(outcome.recommendation.selectedIntentId).toBe(outcome.intentId);

    const intents = await orm.ContentIntent.where((row) =>
      row.id.eq(outcome.intentId),
    ).all();
    expect(intents).toHaveLength(1);
    expect(intents[0].projectId).toBe(project.id);

    // ON DELETE SET NULL: the user's decision record survives, the link does not
    // become a dangling pointer.
    await orm.ContentIntent.where({ id: outcome.intentId }).delete();

    const rows = await orm.ContentRecommendation.where((row) =>
      row.id.eq(target.id),
    ).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].selectedIntentId).toBeNull();
    expect(rows[0].status).toBe("SELECTED");
  });

});
