import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicOrm } from "../../../prisma/db";
import type { CaptureTakeRecord } from "../capture-types";

const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";

const FIXTURE = Buffer.from("content-os-cp13-real-capture-fixture", "utf8");
const CAPTURE_ROOT = path.join(process.cwd(), ".content-os", "captures");
const SESSION_COOKIE = "content_os_session";

type Services = typeof import("../../../infrastructure/services");

let services: Services;
let orm: PublicOrm;

let alice: Awaited<ReturnType<Services["authService"]["register"]>>;
let bob: Awaited<ReturnType<Services["authService"]["register"]>>;
let aliceProjectId: string;
let bobProjectId: string;
let aliceSessionId: string;
let aliceTake: CaptureTakeRecord;

type StartRoute = {
  POST: (
    request: Request,
    context: { params: Promise<{ id: string; sessionId: string }> },
  ) => Promise<Response>;
};

type SessionRoute = {
  GET: (
    request: Request,
    context: { params: Promise<{ id: string; sessionId: string }> },
  ) => Promise<Response>;
};

type StreamRoute = {
  GET: (
    request: Request,
    context: { params: Promise<{ id: string; takeId: string }> },
  ) => Promise<Response>;
};

let startRoute: StartRoute;
let sessionRoute: SessionRoute;
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

const BASE = "http://localhost";

async function deleteUserData(
  user: Awaited<ReturnType<Services["authService"]["register"]>>,
  projectId: string,
) {
  await orm.CaptureTake.where((row) => row.projectId.eq(projectId))
    .delete()
    .catch(() => undefined);
  await orm.CaptureSession.where((row) => row.projectId.eq(projectId))
    .delete()
    .catch(() => undefined);
  await rm(path.join(CAPTURE_ROOT, projectId), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
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

  [
    startRoute,
    sessionRoute,
    streamRoute,
  ] = await Promise.all([
    import("../../../app/api/projects/[id]/capture/sessions/[sessionId]/start/route"),
    import("../../../app/api/projects/[id]/capture/sessions/[sessionId]/route"),
    import("../../../app/api/projects/[id]/capture/takes/[takeId]/stream/route"),
  ]);

  const stamp = Date.now();

  alice = await services.authService.register({
    email: `cp13-alice-${stamp}@test.local`,
    password: "test-password-1",
  });
  bob = await services.authService.register({
    email: `cp13-bob-${stamp}@test.local`,
    password: "test-password-1",
  });

  aliceProjectId = (
    await services.projectService.createForWorkspace(
      alice.workspace!.id,
      { name: "Alice project" },
      alice.user.id,
    )
  ).id;

  bobProjectId = (
    await services.projectService.createForWorkspace(
      bob.workspace!.id,
      { name: "Bob project" },
      bob.user.id,
    )
  ).id;

  const session = await services.captureService.createSession({
    projectId: aliceProjectId,
    userId: alice.user.id,
  });

  aliceSessionId = session.id;

  await services.captureService.startSession({
    projectId: aliceProjectId,
    sessionId: aliceSessionId,
    userId: alice.user.id,
  });

  aliceTake = await services.captureService.addTake({
    projectId: aliceProjectId,
    sessionId: aliceSessionId,
    userId: alice.user.id,
    mode: "CAMERA",
    mimeType: "video/webm",
    filename: "alice.webm",
    bytes: FIXTURE,
  });
});

afterAll(async () => {
  if (alice) await deleteUserData(alice, aliceProjectId);
  if (bob) await deleteUserData(bob, bobProjectId);
});

describe("capture API authentication", () => {
  it("rejects a mutation with no session cookie", async () => {
    const response = await startRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/capture/sessions/${aliceSessionId}/start`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: aliceProjectId, sessionId: aliceSessionId }) },
    );

    expect(response.status).toBe(401);
  });

  it("rejects a cross-origin mutation even with a valid cookie", async () => {
    const response = await startRoute.POST(
      request(
        `${BASE}/api/projects/${aliceProjectId}/capture/sessions/${aliceSessionId}/start`,
        {
          method: "POST",
          cookie: cookieFor(alice.token),
          origin: "https://evil.example",
        },
      ),
      { params: Promise.resolve({ id: aliceProjectId, sessionId: aliceSessionId }) },
    );

    expect(response.status).toBe(403);
  });
});

describe("capture API project isolation", () => {
  it("does not let a member of another project start this project's session", async () => {
    const response = await startRoute.POST(
      request(
        `${BASE}/api/projects/${aliceProjectId}/capture/sessions/${aliceSessionId}/start`,
        {
          method: "POST",
          cookie: cookieFor(bob.token),
        },
      ),
      { params: Promise.resolve({ id: aliceProjectId, sessionId: aliceSessionId }) },
    );

    expect(response.status).toBe(403);
  });

  it("does not let a member of another project read this project's session", async () => {
    const response = await sessionRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/capture/sessions/${aliceSessionId}`,
        { cookie: cookieFor(bob.token) },
      ),
      { params: Promise.resolve({ id: aliceProjectId, sessionId: aliceSessionId }) },
    );

    expect(response.status).toBe(403);
  });

  it("never puts the storage key on the session response", async () => {
    const response = await sessionRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/capture/sessions/${aliceSessionId}`,
        { cookie: cookieFor(alice.token) },
      ),
      { params: Promise.resolve({ id: aliceProjectId, sessionId: aliceSessionId }) },
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      takes: Array<Record<string, unknown>>;
    };

    expect(body.takes.length).toBeGreaterThan(0);
    for (const take of body.takes) {
      expect(take).not.toHaveProperty("storageKey");
      expect(take).not.toHaveProperty("compiledPath");
    }
  });

  it("reports a project A take requested through project B as not found", async () => {
    const response = await streamRoute.GET(
      request(`${BASE}/api/projects/${bobProjectId}/capture/takes/${aliceTake.id}/stream`, {
        cookie: cookieFor(bob.token),
      }),
      { params: Promise.resolve({ id: bobProjectId, takeId: aliceTake.id }) },
    );

    // 404 rather than 403: a 403 would confirm the take id exists in project A.
    expect(response.status).toBe(404);
  });
});

describe("capture stream", () => {
  it("serves the bytes to a member, ignoring a storageKey query parameter", async () => {
    const plain = await streamRoute.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/capture/takes/${aliceTake.id}/stream`, {
        cookie: cookieFor(alice.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId, takeId: aliceTake.id }) },
    );

    const tampered = await streamRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/capture/takes/${aliceTake.id}/stream?storageKey=../../etc/passwd`,
        { cookie: cookieFor(alice.token) },
      ),
      { params: Promise.resolve({ id: aliceProjectId, takeId: aliceTake.id }) },
    );

    expect(plain.status).toBe(200);
    expect(tampered.status).toBe(200);
    expect(plain.headers.get("content-disposition")).toContain("inline");

    const plainBytes = Buffer.from(await plain.arrayBuffer());
    const tamperedBytes = Buffer.from(await tampered.arrayBuffer());

    expect(plainBytes).toEqual(FIXTURE);
    expect(tamperedBytes).toEqual(FIXTURE);
  });
});
