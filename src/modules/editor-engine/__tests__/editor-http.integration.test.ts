import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupEditorProject,
  loadEditorTestContext,
  request,
  textNode,
} from "./helpers";
import { createId } from "../../../lib/id";

/**
 * HTTP-boundary proof for the editor API.
 *
 * The service suite proves the engine's rules; this suite proves the *route*
 * layer actually applies them before any work happens — a session is required,
 * only members reach a project, cross-origin writes are refused, a RESTORE
 * can't be smuggled over the wire, finalize validates and publishes readiness,
 * and asset bytes only stream to a member of the owning project. Each route is
 * invoked exactly as Next invokes it, so the guards under test are the real
 * ones, not a re-implementation.
 */

const BASE = "http://localhost";
const SESSION_COOKIE = "content_os_session";

type Services = Awaited<ReturnType<typeof loadEditorTestContext>>["services"];
type Orm = Awaited<ReturnType<typeof loadEditorTestContext>>["orm"];
type Owner = Awaited<ReturnType<Services["authService"]["register"]>>;

type IdContext = { params: Promise<{ id: string }> };
type DocContext = { params: Promise<{ id: string; documentId: string }> };
type RevContext = {
  params: Promise<{ id: string; documentId: string; revisionId: string }>;
};
type AssetContext = { params: Promise<{ id: string; ref: string }> };

type IdRoute = {
  GET(request: Request, context: IdContext): Promise<Response>;
  POST(request: Request, context: IdContext): Promise<Response>;
};
type DocRoute = {
  GET(request: Request, context: DocContext): Promise<Response>;
};
type WriteRoute = {
  POST(request: Request, context: DocContext): Promise<Response>;
};
type HistoryRoute = {
  GET(request: Request, context: DocContext): Promise<Response>;
};
type RevisionRoute = {
  GET(request: Request, context: RevContext): Promise<Response>;
};
type AssetRoute = {
  GET(request: Request, context: AssetContext): Promise<Response>;
};

let services: Services;
let orm: Orm;
let storage: {
  put(key: string, data: Buffer, mimeType?: string): Promise<{ uri: string }>;
};

let listRoute: IdRoute;
let importsRoute: IdRoute;
let documentRoute: DocRoute;
let operationsRoute: WriteRoute;
let undoRoute: WriteRoute;
let redoRoute: WriteRoute;
let restoreRoute: WriteRoute;
let finalizeRoute: WriteRoute;
let historyRoute: HistoryRoute;
let revisionRoute: RevisionRoute;
let proposeRoute: WriteRoute;
let applyRoute: WriteRoute;
let assetRoute: AssetRoute;

let alice: Owner;
let bob: Owner;
let aliceProjectId = "";
let bobProjectId = "";
let aliceOtherProjectId = "";

let documentId = "";
let revisionId = "";
let nodeId = "";

let foreignAssetId = "";
let ownAssetRef = "";

async function registerOwner(prefix: string): Promise<Owner> {
  return services.authService.register({
    email: `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`,
    password: "test-password-1",
  });
}

async function createProject(owner: Owner, name: string): Promise<string> {
  const project = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name },
    owner.user.id,
  );
  return project.id;
}

async function createDocument(): Promise<{
  documentId: string;
  revisionId: string;
  nodeId: string;
}> {
  const id = createId("enode");
  const detail = await services.editorService.createDocument({
    projectId: aliceProjectId,
    userId: alice.user.id,
    name: `HTTP ${id}`,
    nodes: [textNode({ id })],
  });
  return {
    documentId: detail.document.id,
    revisionId: detail.revision.id,
    nodeId: id,
  };
}

function cookieForToken(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

beforeAll(async () => {
  const loaded = await loadEditorTestContext();
  orm = loaded.orm;
  services = loaded.services;

  const containerModule = await import("../../../infrastructure/container");
  storage = containerModule.container.providers.storage;

  listRoute = (await import(
    "../../../app/api/projects/[id]/editor/route"
  )) as unknown as IdRoute;
  importsRoute = (await import(
    "../../../app/api/projects/[id]/editor/imports/route"
  )) as unknown as IdRoute;
  documentRoute = (await import(
    "../../../app/api/projects/[id]/editor/[documentId]/route"
  )) as unknown as DocRoute;
  operationsRoute = (await import(
    "../../../app/api/projects/[id]/editor/[documentId]/operations/route"
  )) as unknown as WriteRoute;
  undoRoute = (await import(
    "../../../app/api/projects/[id]/editor/[documentId]/undo/route"
  )) as unknown as WriteRoute;
  redoRoute = (await import(
    "../../../app/api/projects/[id]/editor/[documentId]/redo/route"
  )) as unknown as WriteRoute;
  restoreRoute = (await import(
    "../../../app/api/projects/[id]/editor/[documentId]/restore/route"
  )) as unknown as WriteRoute;
  finalizeRoute = (await import(
    "../../../app/api/projects/[id]/editor/[documentId]/finalize/route"
  )) as unknown as WriteRoute;
  historyRoute = (await import(
    "../../../app/api/projects/[id]/editor/[documentId]/history/route"
  )) as unknown as HistoryRoute;
  revisionRoute = (await import(
    "../../../app/api/projects/[id]/editor/[documentId]/revisions/[revisionId]/route"
  )) as unknown as RevisionRoute;
  proposeRoute = (await import(
    "../../../app/api/projects/[id]/editor/[documentId]/ai/propose/route"
  )) as unknown as WriteRoute;
  applyRoute = (await import(
    "../../../app/api/projects/[id]/editor/[documentId]/ai/apply/route"
  )) as unknown as WriteRoute;
  assetRoute = (await import(
    "../../../app/api/projects/[id]/editor/assets/[ref]/route"
  )) as unknown as AssetRoute;

  alice = await registerOwner("cp20-http-alice");
  bob = await registerOwner("cp20-http-bob");

  aliceProjectId = await createProject(alice, "Alice editor");
  bobProjectId = await createProject(bob, "Bob editor");
  aliceOtherProjectId = await createProject(alice, "Alice other");

  const doc = await createDocument();
  documentId = doc.documentId;
  revisionId = doc.revisionId;
  nodeId = doc.nodeId;

  // An asset owned by a *different* project of the same user: proves a ref can
  // never cross the project boundary even for an authorized member.
  const foreign = await services.assetService.create(
    aliceOtherProjectId,
    {
      type: "IMAGE",
      name: "foreign.png",
      uri: "content-os-storage://local/cp20/foreign.png",
    },
    alice.user.id,
  );
  foreignAssetId = foreign.id;

  // A real asset in the tested project, with real bytes in storage, so the
  // happy path proves the route streams bytes rather than merely authorizing.
  const stored = await storage.put(
    "cp20/poster.png",
    Buffer.from("cp20-editor-stream-fixture"),
    "image/png",
  );
  const own = await services.assetService.create(
    aliceProjectId,
    { type: "IMAGE", name: "poster.png", uri: stored.uri },
    alice.user.id,
  );
  ownAssetRef = `asset:${own.id}`;
});

afterAll(async () => {
  for (const projectId of [aliceProjectId, aliceOtherProjectId, bobProjectId]) {
    if (!projectId) continue;
    await orm.Asset.where((row) => row.projectId.eq(projectId))
      .delete()
      .catch(() => undefined);
    await orm.Project.where({ id: projectId }).delete().catch(() => undefined);
  }

  await cleanupEditorProject(orm, alice, aliceProjectId).catch(() => undefined);
  await orm.WorkspaceMember.where((row) => row.userId.eq(bob.user.id))
    .delete()
    .catch(() => undefined);
  await orm.Session.where((row) => row.userId.eq(bob.user.id))
    .delete()
    .catch(() => undefined);
  if (bob.workspace) {
    await orm.Workspace.where({ id: bob.workspace.id })
      .delete()
      .catch(() => undefined);
  }
  await orm.User.where({ id: bob.user.id }).delete().catch(() => undefined);

  const storageRoot =
    process.env["CONTENT_OS_STORAGE_PATH"] ??
    path.join(process.cwd(), ".content-os", "storage");
  await rm(path.join(storageRoot, "cp20"), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
});

describe("editor API authentication", () => {
  it("rejects creating a document without a session", async () => {
    const response = await listRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(401);
  });

  it("rejects reading a document without a session", async () => {
    const response = await documentRoute.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}`),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    expect(response.status).toBe(401);
  });

  it("rejects applying an operation, undo, redo and restore without a session", async () => {
    const headers = { "content-type": "application/json" };
    const operation = { type: "MOVE", nodeId, x: 1, y: 1 };
    const ops = await operationsRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/operations`, {
        method: "POST",
        headers,
        body: JSON.stringify({ baseRevision: revisionId, operation }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    const undo = await undoRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/undo`, {
        method: "POST",
        headers,
        body: JSON.stringify({ baseRevision: revisionId }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    const redo = await redoRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/redo`, {
        method: "POST",
        headers,
        body: JSON.stringify({ baseRevision: revisionId }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    const restore = await restoreRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/restore`, {
        method: "POST",
        headers,
        body: JSON.stringify({ baseRevision: revisionId, revisionId }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    expect([ops.status, undo.status, redo.status, restore.status]).toEqual([
      401, 401, 401, 401,
    ]);
  });

  it("rejects finalize without a session", async () => {
    const response = await finalizeRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseRevision: revisionId }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    expect(response.status).toBe(401);
  });

  it("rejects history and revision reads without a session", async () => {
    const history = await historyRoute.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/history`),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    const revision = await revisionRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/revisions/${revisionId}`,
      ),
      {
        params: Promise.resolve({ id: aliceProjectId, documentId, revisionId }),
      },
    );
    expect([history.status, revision.status]).toEqual([401, 401]);
  });

  it("rejects AI propose and apply without a session", async () => {
    const headers = { "content-type": "application/json" };
    const propose = await proposeRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/ai/propose`, {
        method: "POST",
        headers,
        body: JSON.stringify({ baseRevision: revisionId, instructions: "move right" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    const apply = await applyRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/ai/apply`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          baseRevision: revisionId,
          operation: { type: "MOVE", nodeId, x: 1, y: 1 },
        }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    expect([propose.status, apply.status]).toEqual([401, 401]);
  });

  it("rejects streaming an asset without a session", async () => {
    const response = await assetRoute.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/assets/${ownAssetRef}`),
      { params: Promise.resolve({ id: aliceProjectId, ref: ownAssetRef }) },
    );
    expect(response.status).toBe(401);
  });

  it("rejects an import without a session", async () => {
    const response = await importsRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/imports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "GENERATED_IMAGE", sourceId: "x" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(401);
  });
});

describe("editor API same-origin enforcement", () => {
  const evil = "https://evil.example";
  const headers = { "content-type": "application/json" };
  const operation = () => ({ type: "MOVE", nodeId, x: 1, y: 1 });

  it("refuses a cross-origin create even with a valid cookie", async () => {
    const response = await listRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor`, {
        method: "POST",
        cookie: cookieForToken(alice.token),
        origin: evil,
        headers,
        body: JSON.stringify({ name: "x" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(403);
  });

  it("refuses cross-origin operations, restore, finalize and AI apply", async () => {
    const cookie = cookieForToken(alice.token);
    const ops = await operationsRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/operations`, {
        method: "POST",
        cookie,
        origin: evil,
        headers,
        body: JSON.stringify({ baseRevision: revisionId, operation: operation() }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    const restore = await restoreRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/restore`, {
        method: "POST",
        cookie,
        origin: evil,
        headers,
        body: JSON.stringify({ baseRevision: revisionId, revisionId }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    const finalize = await finalizeRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/finalize`, {
        method: "POST",
        cookie,
        origin: evil,
        headers,
        body: JSON.stringify({ baseRevision: revisionId }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    const apply = await applyRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/ai/apply`, {
        method: "POST",
        cookie,
        origin: evil,
        headers,
        body: JSON.stringify({ baseRevision: revisionId, operation: operation() }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    const imports = await importsRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/imports`, {
        method: "POST",
        cookie,
        origin: evil,
        headers,
        body: JSON.stringify({ kind: "GENERATED_IMAGE", sourceId: "x" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect([
      ops.status,
      restore.status,
      finalize.status,
      apply.status,
      imports.status,
    ]).toEqual([403, 403, 403, 403, 403]);
  });
});

describe("editor API project isolation", () => {
  it("does not let an outsider read or list Alice's documents", async () => {
    const read = await documentRoute.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}`, {
        cookie: cookieForToken(bob.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    const list = await listRoute.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/editor`, {
        cookie: cookieForToken(bob.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect([read.status, list.status]).toEqual([403, 403]);
  });

  it("does not let an outsider write, restore or finalize", async () => {
    const cookie = cookieForToken(bob.token);
    const headers = { "content-type": "application/json" };
    const ops = await operationsRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/operations`, {
        method: "POST",
        cookie,
        headers,
        body: JSON.stringify({
          baseRevision: revisionId,
          operation: { type: "MOVE", nodeId, x: 1, y: 1 },
        }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    const restore = await restoreRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/restore`, {
        method: "POST",
        cookie,
        headers,
        body: JSON.stringify({ baseRevision: revisionId, revisionId }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    const finalize = await finalizeRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/finalize`, {
        method: "POST",
        cookie,
        headers,
        body: JSON.stringify({ baseRevision: revisionId }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    expect([ops.status, restore.status, finalize.status]).toEqual([403, 403, 403]);
  });

  it("does not let an outsider read history or a revision or propose/apply AI", async () => {
    const cookie = cookieForToken(bob.token);
    const headers = { "content-type": "application/json" };
    const history = await historyRoute.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/history`, {
        cookie,
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    const revision = await revisionRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/revisions/${revisionId}`,
        { cookie },
      ),
      {
        params: Promise.resolve({ id: aliceProjectId, documentId, revisionId }),
      },
    );
    const propose = await proposeRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/ai/propose`, {
        method: "POST",
        cookie,
        headers,
        body: JSON.stringify({ baseRevision: revisionId, instructions: "move right" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    const apply = await applyRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/ai/apply`, {
        method: "POST",
        cookie,
        headers,
        body: JSON.stringify({
          baseRevision: revisionId,
          operation: { type: "MOVE", nodeId, x: 1, y: 1 },
        }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    expect([history.status, revision.status, propose.status, apply.status]).toEqual([
      403, 403, 403, 403,
    ]);
  });

  it("does not let an outsider stream an asset", async () => {
    const response = await assetRoute.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/assets/${ownAssetRef}`, {
        cookie: cookieForToken(bob.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId, ref: ownAssetRef }) },
    );
    expect(response.status).toBe(403);
  });
});

describe("editor API wire rules", () => {
  const cookie = (): string => cookieForToken(alice.token);

  it("refuses a RESTORE smuggled through the operations route", async () => {
    const response = await operationsRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/operations`, {
        method: "POST",
        cookie: cookie(),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseRevision: revisionId,
          operation: { type: "RESTORE", nodeId, revisionId },
        }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("EDITOR_INVALID_OPERATION");
  });

  it("refuses an operation with no base revision", async () => {
    const response = await operationsRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/operations`, {
        method: "POST",
        cookie: cookie(),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: { type: "MOVE", nodeId, x: 1, y: 1 } }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    expect(response.status).toBe(400);
  });

  it("refuses a non-JSON body", async () => {
    const response = await operationsRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${documentId}/operations`, {
        method: "POST",
        cookie: cookie(),
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId }) },
    );
    expect(response.status).toBe(400);
  });

  it("refuses an import with an unknown kind", async () => {
    const response = await importsRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/imports`, {
        method: "POST",
        cookie: cookie(),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "NOPE", sourceId: "x" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(400);
  });
});

describe("editor API asset streaming", () => {
  const cookie = (): string => cookieForToken(alice.token);

  it("streams a member's own asset with the real bytes", async () => {
    const response = await assetRoute.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/assets/${ownAssetRef}`, {
        cookie: cookie(),
      }),
      { params: Promise.resolve({ id: aliceProjectId, ref: ownAssetRef }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.toString("utf8")).toBe("cp20-editor-stream-fixture");
  });

  it("refuses a ref owned by another project of the same user", async () => {
    const ref = `asset:${foreignAssetId}`;
    const response = await assetRoute.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/assets/${ref}`, {
        cookie: cookie(),
      }),
      { params: Promise.resolve({ id: aliceProjectId, ref }) },
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("EDITOR_CROSS_PROJECT_ASSET");
  });

  it("returns 404 for a generated ref the project does not own", async () => {
    const ref = "generated:nope";
    const response = await assetRoute.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/assets/${ref}`, {
        cookie: cookie(),
      }),
      { params: Promise.resolve({ id: aliceProjectId, ref }) },
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("EDITOR_ASSET_UNAVAILABLE");
  });
});

describe("editor API finalize", () => {
  const cookie = (): string => cookieForToken(alice.token);
  const headers = { "content-type": "application/json" };

  it("publishes readiness for the owner and reports it as READY", async () => {
    const doc = await createDocument();
    const response = await finalizeRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${doc.documentId}/finalize`, {
        method: "POST",
        cookie: cookie(),
        headers,
        body: JSON.stringify({ baseRevision: doc.revisionId }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId: doc.documentId }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      document: { id: string; status: string; revisionCount: number };
    };
    expect(body.document.status).toBe("READY");
    expect(body.document.id).toBe(doc.documentId);
  });

  it("refuses finalize built on a superseded revision", async () => {
    const doc = await createDocument();
    const stale = await finalizeRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${doc.documentId}/finalize`, {
        method: "POST",
        cookie: cookie(),
        headers,
        body: JSON.stringify({ baseRevision: "rev-stale" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId: doc.documentId }) },
    );
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { code?: string };
    expect(body.code).toBe("EDITOR_REVISION_CONFLICT");
  });

  it("refuses finalize while a node is still empty", async () => {
    const id = createId("enode");
    const created = await services.editorService.createDocument({
      projectId: aliceProjectId,
      userId: alice.user.id,
      name: "Incomplete",
      nodes: [textNode({ id, text: { value: "   " } })],
    });
    const response = await finalizeRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/editor/${created.document.id}/finalize`, {
        method: "POST",
        cookie: cookie(),
        headers,
        body: JSON.stringify({ baseRevision: created.revision.id }),
      }),
      { params: Promise.resolve({ id: aliceProjectId, documentId: created.document.id }) },
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("EDITOR_DOCUMENT_LOCKED");
  });
});
