import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASE,
  cleanupUser,
  cookieFor,
  loadImageTestContext,
  registerUser,
  request,
  type Orm,
  type Services,
} from "./helpers";

type IdContext = { params: Promise<{ id: string }> };
type JobContext = { params: Promise<{ id: string; jobId: string }> };
type AssetContext = { params: Promise<{ id: string; assetId: string }> };

type GenerateRoute = {
  POST(request: Request, context: IdContext): Promise<Response>;
};
type JobRoute = {
  GET(request: Request, context: JobContext): Promise<Response>;
};
type CancelRoute = {
  POST(request: Request, context: JobContext): Promise<Response>;
};
type StreamRoute = {
  GET(request: Request, context: AssetContext): Promise<Response>;
};

let services: Services;
let orm: Orm;
let generateRoute: GenerateRoute;
let jobRoute: JobRoute;
let cancelRoute: CancelRoute;
let streamRoute: StreamRoute;

let alice: Awaited<ReturnType<Services["authService"]["register"]>>;
let bob: Awaited<ReturnType<Services["authService"]["register"]>>;
let aliceProjectId: string;
let aliceJobId: string;

beforeAll(async () => {
  const context = await loadImageTestContext();
  services = context.services;
  orm = context.orm;

  [generateRoute, jobRoute, cancelRoute, streamRoute] = await Promise.all([
    import("../../../app/api/projects/[id]/images/generate/route"),
    import(
      "../../../app/api/projects/[id]/images/generations/[jobId]/route"
    ),
    import(
      "../../../app/api/projects/[id]/images/generations/[jobId]/cancel/route"
    ),
    import("../../../app/api/projects/[id]/images/assets/[assetId]/stream/route"),
  ]);

  alice = await registerUser(services, "cp17-sec-a");
  bob = await registerUser(services, "cp17-sec-b");

  const project = await services.projectService.createForWorkspace(
    alice.workspace!.id,
    { name: "Alice images" },
    alice.user.id,
  );
  aliceProjectId = project.id;

  const job = await services.imageGenerationService.enqueue({
    projectId: aliceProjectId,
    requestedById: alice.user.id,
    templateType: "SOCIAL_POST",
    prompt: "Secure",
    width: 256,
    height: 256,
  });
  aliceJobId = job.id;
});

afterAll(async () => {
  if (aliceJobId) {
    await services.imageRepository
      .requestCancel(aliceProjectId, aliceJobId)
      .catch(() => undefined);
  }
  if (alice) await cleanupUser(orm, alice, aliceProjectId);
  if (bob) await cleanupUser(orm, bob);
});

describe("image API authentication", () => {
  it("rejects enqueueing without a session", async () => {
    const response = await generateRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/images/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateType: "SOCIAL_POST", prompt: "x" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(401);
  });

  it("rejects a cross-origin enqueue even with a valid cookie", async () => {
    const response = await generateRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/images/generate`, {
        method: "POST",
        cookie: cookieFor(alice.token),
        origin: "https://evil.example",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateType: "SOCIAL_POST", prompt: "x" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(403);
  });
});

describe("image API project isolation", () => {
  it("does not let an outsider enqueue", async () => {
    const response = await generateRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/images/generate`, {
        method: "POST",
        cookie: cookieFor(bob.token),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateType: "SOCIAL_POST", prompt: "x" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(403);
  });

  it("does not let an outsider read a job", async () => {
    const response = await jobRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/images/generations/${aliceJobId}`,
        { cookie: cookieFor(bob.token) },
      ),
      { params: Promise.resolve({ id: aliceProjectId, jobId: aliceJobId }) },
    );
    expect(response.status).toBe(403);
  });

  it("does not let an outsider cancel a job", async () => {
    const response = await cancelRoute.POST(
      request(
        `${BASE}/api/projects/${aliceProjectId}/images/generations/${aliceJobId}/cancel`,
        { method: "POST", cookie: cookieFor(bob.token) },
      ),
      { params: Promise.resolve({ id: aliceProjectId, jobId: aliceJobId }) },
    );
    expect(response.status).toBe(403);
  });

  it("does not let an outsider stream a guessed asset id", async () => {
    const response = await streamRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/images/assets/iasset_guess/stream`,
        { cookie: cookieFor(bob.token) },
      ),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          assetId: "iasset_guess",
        }),
      },
    );
    expect(response.status).toBe(403);
  });
});

describe("image API response safety", () => {
  it("returns the job to its owner without leaking the recipe or storage key", async () => {
    const response = await jobRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/images/generations/${aliceJobId}`,
        { cookie: cookieFor(alice.token) },
      ),
      { params: Promise.resolve({ id: aliceProjectId, jobId: aliceJobId }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      imageGenerationJob: { id: string };
      asset: unknown;
    };
    expect(body.imageGenerationJob.id).toBe(aliceJobId);
    expect(body.asset).toBeNull();

    const text = JSON.stringify(body);
    expect(text).not.toContain("generationRecipe");
    expect(text).not.toContain("storageKey");
  });

  it("returns 404 for a not-yet-rendered asset stream", async () => {
    const response = await streamRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/images/assets/iasset_missing/stream`,
        { cookie: cookieFor(alice.token) },
      ),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          assetId: "iasset_missing",
        }),
      },
    );
    expect(response.status).toBe(404);
  });

  it("refuses a traversal-shaped asset id without touching the filesystem", async () => {
    const response = await streamRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/images/assets/..%2F..%2Fetc%2Fpasswd/stream`,
        { cookie: cookieFor(alice.token) },
      ),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          assetId: "../../etc/passwd",
        }),
      },
    );
    expect(response.status).toBe(404);
  });

  it("rejects a transparent JPEG with a 422 at the API boundary", async () => {
    const response = await generateRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/images/generate`, {
        method: "POST",
        cookie: cookieFor(alice.token),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateType: "SOCIAL_POST",
          prompt: "bad",
          outputFormat: "JPEG",
          transparent: true,
        }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(422);
  });
});
