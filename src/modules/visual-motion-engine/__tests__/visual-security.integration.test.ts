import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicOrm } from "../../../prisma/db";

const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";

const SESSION_COOKIE = "content_os_session";
const BASE = "http://localhost";

type Services = typeof import("../../../infrastructure/services");

type CompositionsRoute = {
  POST: (
    request: Request,
    context: { params: Promise<{ id: string }> },
  ) => Promise<Response>;
};

type CompositionRoute = {
  GET: (
    request: Request,
    context: { params: Promise<{ id: string; compositionId: string }> },
  ) => Promise<Response>;
  PATCH: (
    request: Request,
    context: { params: Promise<{ id: string; compositionId: string }> },
  ) => Promise<Response>;
};

type LayersRoute = {
  POST: (
    request: Request,
    context: { params: Promise<{ id: string; compositionId: string }> },
  ) => Promise<Response>;
};

let services: Services;
let orm: PublicOrm;

let alice: Awaited<ReturnType<Services["authService"]["register"]>>;
let bob: Awaited<ReturnType<Services["authService"]["register"]>>;
let aliceProjectId: string;
let aliceCompositionId: string;

let compositionsRoute: CompositionsRoute;
let compositionRoute: CompositionRoute;
let layersRoute: LayersRoute;

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
  await orm.VisualComposition.where((row) => row.projectId.eq(projectId))
    .delete()
    .catch(() => undefined);
  await orm.Project.where({ id: projectId })
    .delete()
    .catch(() => undefined);
  await orm.WorkspaceMember.where((row) => row.userId.eq(user.user.id))
    .delete()
    .catch(() => undefined);
  await orm.Session.where((row) => row.userId.eq(user.user.id))
    .delete()
    .catch(() => undefined);
  await orm.Workspace.where({ id: user.workspace!.id })
    .delete()
    .catch(() => undefined);
  await orm.User.where({ id: user.user.id })
    .delete()
    .catch(() => undefined);
}

beforeAll(async () => {
  process.env["DATABASE_URL"] = TEST_DATABASE_URL;

  const [{ db }, loadedServices] = await Promise.all([
    import("../../../prisma/db"),
    import("../../../infrastructure/services"),
  ]);

  services = loadedServices;
  orm = db.orm.public;

  [compositionsRoute, compositionRoute, layersRoute] = await Promise.all([
    import("../../../app/api/projects/[id]/visual/compositions/route"),
    import(
      "../../../app/api/projects/[id]/visual/compositions/[compositionId]/route"
    ),
    import(
      "../../../app/api/projects/[id]/visual/compositions/[compositionId]/layers/route"
    ),
  ]);

  const stamp = Date.now();

  alice = await services.authService.register({
    email: `cp14-alice-${stamp}@test.local`,
    password: "test-password-1",
  });
  bob = await services.authService.register({
    email: `cp14-bob-${stamp}@test.local`,
    password: "test-password-1",
  });

  aliceProjectId = (
    await services.projectService.createForWorkspace(
      alice.workspace!.id,
      { name: "Alice visual" },
      alice.user.id,
    )
  ).id;

  const composition = await services.visualCompositionService.createComposition({
    projectId: aliceProjectId,
    userId: alice.user.id,
    name: "Alice composition",
  });

  aliceCompositionId = composition.id;
});

afterAll(async () => {
  if (alice) await deleteUserData(alice, aliceProjectId);
  if (bob) await deleteUserData(bob, "");
});

describe("visual API authentication", () => {
  it("rejects a mutation with no session cookie", async () => {
    const response = await compositionsRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/visual/compositions`, {
        method: "POST",
        body: JSON.stringify({ name: "Nope" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );

    expect(response.status).toBe(401);
  });

  it("rejects a cross-origin mutation even with a valid cookie", async () => {
    const response = await compositionsRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/visual/compositions`, {
        method: "POST",
        body: JSON.stringify({ name: "Nope" }),
        cookie: cookieFor(alice.token),
        origin: "https://evil.example",
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );

    expect(response.status).toBe(403);
  });
});

describe("visual API project isolation", () => {
  it("does not let a member of another project create a composition", async () => {
    const response = await compositionsRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/visual/compositions`, {
        method: "POST",
        body: JSON.stringify({ name: "Nope" }),
        cookie: cookieFor(bob.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );

    expect(response.status).toBe(403);
  });

  it("does not let a member of another project read this composition", async () => {
    const response = await compositionRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/visual/compositions/${aliceCompositionId}`,
        { cookie: cookieFor(bob.token) },
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

  it("does not let a member of another project patch this composition", async () => {
    const response = await compositionRoute.PATCH(
      request(
        `${BASE}/api/projects/${aliceProjectId}/visual/compositions/${aliceCompositionId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: "Hijacked" }),
          cookie: cookieFor(bob.token),
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

  it("returns the composition to its owner", async () => {
    const response = await compositionRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/visual/compositions/${aliceCompositionId}`,
        { cookie: cookieFor(alice.token) },
      ),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          compositionId: aliceCompositionId,
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      composition: { id: string };
    };
    expect(body.composition.id).toBe(aliceCompositionId);
  });
});

describe("visual asset references", () => {
  it("rejects a path-like assetRef", async () => {
    const response = await layersRoute.POST(
      request(
        `${BASE}/api/projects/${aliceProjectId}/visual/compositions/${aliceCompositionId}/layers`,
        {
          method: "POST",
          body: JSON.stringify({
            type: "MEDIA",
            assetRef: "../../etc/passwd",
          }),
          cookie: cookieFor(alice.token),
        },
      ),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          compositionId: aliceCompositionId,
        }),
      },
    );

    expect(response.status).toBe(400);
  });

  it("reports a capture reference that is not in the project as not found", async () => {
    const response = await layersRoute.POST(
      request(
        `${BASE}/api/projects/${aliceProjectId}/visual/compositions/${aliceCompositionId}/layers`,
        {
          method: "POST",
          body: JSON.stringify({
            type: "MEDIA",
            assetRef: "capture:does-not-exist",
          }),
          cookie: cookieFor(alice.token),
        },
      ),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          compositionId: aliceCompositionId,
        }),
      },
    );

    expect(response.status).toBe(404);
  });
});
