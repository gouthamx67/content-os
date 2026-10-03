import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicOrm } from "../../../prisma/db";

const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";

const SESSION_COOKIE = "content_os_session";
const BASE = "http://localhost";

type Services = typeof import("../../../infrastructure/services");

type RenderRoute = {
  POST: (
    request: Request,
    context: { params: Promise<{ id: string; compositionId: string }> },
  ) => Promise<Response>;
};

type RenderJobRoute = {
  GET: (
    request: Request,
    context: { params: Promise<{ id: string; renderJobId: string }> },
  ) => Promise<Response>;
};

type CancelRoute = {
  POST: (
    request: Request,
    context: { params: Promise<{ id: string; renderJobId: string }> },
  ) => Promise<Response>;
};

type StreamRoute = {
  GET: (
    request: Request,
    context: { params: Promise<{ id: string; renderJobId: string }> },
  ) => Promise<Response>;
};

let services: Services;
let orm: PublicOrm;

let alice: Awaited<ReturnType<Services["authService"]["register"]>>;
let bob: Awaited<ReturnType<Services["authService"]["register"]>>;
let aliceProjectId: string;
let aliceCompositionId: string;
let aliceRenderJobId: string;

let renderRoute: RenderRoute;
let renderJobRoute: RenderJobRoute;
let cancelRoute: CancelRoute;
let streamRoute: StreamRoute;

function cookieFor(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

function request(
  url: string,
  init: RequestInit & { cookie?: string; origin?: string } = {},
): Request {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.origin) headers.set("origin", init.origin);
  return new Request(url, { ...init, headers });
}

async function deleteUserData(
  user: Awaited<ReturnType<Services["authService"]["register"]>>,
  projectId: string,
) {
  if (projectId) {
    await orm.VisualComposition.where((row) => row.projectId.eq(projectId))
      .delete()
      .catch(() => undefined);
    await orm.Project.where({ id: projectId })
      .delete()
      .catch(() => undefined);
  }
  await orm.WorkspaceMember.where((row) => row.userId.eq(user.user.id))
    .delete()
    .catch(() => undefined);
  await orm.Session.where((row) => row.userId.eq(user.user.id))
    .delete()
    .catch(() => undefined);
  await orm.Workspace.where({ id: user.workspace!.id })
    .delete()
    .catch(() => undefined);
  await orm.User.where({ id: user.user.id }).delete().catch(() => undefined);
}

beforeAll(async () => {
  process.env["DATABASE_URL"] = TEST_DATABASE_URL;

  const [{ db }, loadedServices] = await Promise.all([
    import("../../../prisma/db"),
    import("../../../infrastructure/services"),
  ]);

  services = loadedServices;
  orm = db.orm.public;

  [renderRoute, renderJobRoute, cancelRoute, streamRoute] = await Promise.all([
    import(
      "../../../app/api/projects/[id]/visual/compositions/[compositionId]/render/route"
    ),
    import("../../../app/api/projects/[id]/renders/[renderJobId]/route"),
    import("../../../app/api/projects/[id]/renders/[renderJobId]/cancel/route"),
    import("../../../app/api/projects/[id]/renders/[renderJobId]/stream/route"),
  ]);

  const stamp = Date.now();

  alice = await services.authService.register({
    email: `cp15-alice-${stamp}@test.local`,
    password: "test-password-1",
  });
  bob = await services.authService.register({
    email: `cp15-bob-${stamp}@test.local`,
    password: "test-password-1",
  });

  aliceProjectId = (
    await services.projectService.createForWorkspace(
      alice.workspace!.id,
      { name: "Alice renders" },
      alice.user.id,
    )
  ).id;

  const composition = await services.visualCompositionService.createComposition({
    projectId: aliceProjectId,
    userId: alice.user.id,
    name: "Alice render composition",
  });
  aliceCompositionId = composition.id;

  await services.visualLayerService.addLayer({
    projectId: aliceProjectId,
    compositionId: aliceCompositionId,
    userId: alice.user.id,
    type: "TEXT",
    textContent: "Secure",
  });

  aliceRenderJobId = (
    await services.renderJobService.enqueue({
      projectId: aliceProjectId,
      compositionId: aliceCompositionId,
      userId: alice.user.id,
    })
  ).id;
});

afterAll(async () => {
  if (alice) await deleteUserData(alice, aliceProjectId);
  if (bob) await deleteUserData(bob, "");
});

describe("render API authentication", () => {
  it("rejects enqueueing without a session", async () => {
    const response = await renderRoute.POST(
      request(
        `${BASE}/api/projects/${aliceProjectId}/visual/compositions/${aliceCompositionId}/render`,
        { method: "POST" },
      ),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          compositionId: aliceCompositionId,
        }),
      },
    );

    expect(response.status).toBe(401);
  });

  it("rejects a cross-origin enqueue even with a valid cookie", async () => {
    const response = await renderRoute.POST(
      request(
        `${BASE}/api/projects/${aliceProjectId}/visual/compositions/${aliceCompositionId}/render`,
        {
          method: "POST",
          cookie: cookieFor(alice.token),
          origin: "https://evil.example",
        },
      ),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          compositionId: aliceCompositionId,
        }),
      },
    );

    expect(response.status).toBe(403);
  });
});

describe("render API project isolation", () => {
  it("does not let an outsider enqueue a render", async () => {
    const response = await renderRoute.POST(
      request(
        `${BASE}/api/projects/${aliceProjectId}/visual/compositions/${aliceCompositionId}/render`,
        { method: "POST", cookie: cookieFor(bob.token) },
      ),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          compositionId: aliceCompositionId,
        }),
      },
    );

    expect(response.status).toBe(403);
  });

  it("does not let an outsider read a render job", async () => {
    const response = await renderJobRoute.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/renders/${aliceRenderJobId}`, {
        cookie: cookieFor(bob.token),
      }),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          renderJobId: aliceRenderJobId,
        }),
      },
    );

    expect(response.status).toBe(403);
  });

  it("does not let an outsider cancel a render job", async () => {
    const response = await cancelRoute.POST(
      request(
        `${BASE}/api/projects/${aliceProjectId}/renders/${aliceRenderJobId}/cancel`,
        { method: "POST", cookie: cookieFor(bob.token) },
      ),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          renderJobId: aliceRenderJobId,
        }),
      },
    );

    expect(response.status).toBe(403);
  });

  it("does not let an outsider stream the artifact", async () => {
    const response = await streamRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/renders/${aliceRenderJobId}/stream`,
        { cookie: cookieFor(bob.token) },
      ),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          renderJobId: aliceRenderJobId,
        }),
      },
    );

    expect(response.status).toBe(403);
  });

  it("returns the job view to its owner without leaking a storage key", async () => {
    const response = await renderJobRoute.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/renders/${aliceRenderJobId}`, {
        cookie: cookieFor(alice.token),
      }),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          renderJobId: aliceRenderJobId,
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      renderJob: { id: string };
      artifact: unknown;
    };
    expect(body.renderJob.id).toBe(aliceRenderJobId);
    expect(body.artifact).toBeNull();
    expect(JSON.stringify(body)).not.toContain("storageKey");
  });

  it("reports a not-yet-rendered artifact as not found for its owner", async () => {
    const response = await streamRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/renders/${aliceRenderJobId}/stream`,
        { cookie: cookieFor(alice.token) },
      ),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          renderJobId: aliceRenderJobId,
        }),
      },
    );

    expect(response.status).toBe(404);
  });
});
