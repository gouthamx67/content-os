import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASE,
  cleanupUser,
  cookieFor,
  loadWritingTestContext,
  registerUser,
  request,
  type Orm,
  type Services,
} from "./helpers";

type IdContext = { params: Promise<{ id: string }> };
type JobContext = { params: Promise<{ id: string; jobId: string }> };
type DocContext = { params: Promise<{ id: string; documentId: string }> };

type GenerateRoute = {
  POST(request: Request, context: IdContext): Promise<Response>;
};
type JobRoute = {
  GET(request: Request, context: JobContext): Promise<Response>;
};
type DocumentsRoute = {
  GET(request: Request, context: IdContext): Promise<Response>;
};
type DocumentRoute = {
  GET(request: Request, context: DocContext): Promise<Response>;
};
type RewriteRoute = {
  POST(request: Request, context: DocContext): Promise<Response>;
};

let services: Services;
let orm: Orm;
let generateRoute: GenerateRoute;
let jobRoute: JobRoute;
let documentsRoute: DocumentsRoute;
let documentRoute: DocumentRoute;
let rewriteRoute: RewriteRoute;

let alice: Awaited<ReturnType<Services["authService"]["register"]>>;
let bob: Awaited<ReturnType<Services["authService"]["register"]>>;
let aliceProjectId: string;
let aliceJobId: string;

beforeAll(async () => {
  const loaded = await loadWritingTestContext();
  services = loaded.services;
  orm = loaded.orm;

  [generateRoute, jobRoute, documentsRoute, documentRoute, rewriteRoute] =
    await Promise.all([
      import("../../../app/api/projects/[id]/writing/generate/route"),
      import("../../../app/api/projects/[id]/writing/generations/[jobId]/route"),
      import("../../../app/api/projects/[id]/writing/documents/route"),
      import("../../../app/api/projects/[id]/writing/documents/[documentId]/route"),
      import(
        "../../../app/api/projects/[id]/writing/documents/[documentId]/rewrite/route"
      ),
    ]);

  alice = await registerUser(services, "cp18-sec-a");
  bob = await registerUser(services, "cp18-sec-b");

  const project = await services.projectService.createForWorkspace(
    alice.workspace!.id,
    { name: "Alice writing" },
    alice.user.id,
  );
  aliceProjectId = project.id;

  const job = await services.writingGenerationService.enqueue({
    projectId: aliceProjectId,
    requestedById: alice.user.id,
    blockType: "HEADLINE",
    tone: "BRAND",
    length: "MEDIUM",
    objective: "AWARENESS",
    prompt: "Secure",
    variantCount: 2,
  });
  aliceJobId = job.id;
});

afterAll(async () => {
  if (alice) await cleanupUser(orm, alice, aliceProjectId);
  if (bob) await cleanupUser(orm, bob);
});

describe("writing API authentication", () => {
  it("rejects enqueueing without a session", async () => {
    const response = await generateRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/writing/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blockType: "HEADLINE", prompt: "x" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(401);
  });

  it("rejects a cross-origin enqueue even with a valid cookie", async () => {
    const response = await generateRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/writing/generate`, {
        method: "POST",
        cookie: cookieFor(alice.token),
        origin: "https://evil.example",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blockType: "HEADLINE", prompt: "x" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(403);
  });
});

describe("writing API project isolation", () => {
  it("does not let an outsider enqueue", async () => {
    const response = await generateRoute.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/writing/generate`, {
        method: "POST",
        cookie: cookieFor(bob.token),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blockType: "HEADLINE", prompt: "x" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(403);
  });

  it("does not let an outsider read a job", async () => {
    const response = await jobRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/writing/generations/${aliceJobId}`,
        { cookie: cookieFor(bob.token) },
      ),
      { params: Promise.resolve({ id: aliceProjectId, jobId: aliceJobId }) },
    );
    expect(response.status).toBe(403);
  });

  it("does not let an outsider list documents", async () => {
    const response = await documentsRoute.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/writing/documents`, {
        cookie: cookieFor(bob.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(403);
  });

  it("does not let an outsider rewrite a guessed document", async () => {
    const response = await rewriteRoute.POST(
      request(
        `${BASE}/api/projects/${aliceProjectId}/writing/documents/wdoc_guess/rewrite`,
        {
          method: "POST",
          cookie: cookieFor(bob.token),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instruction: "SHORTEN" }),
        },
      ),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          documentId: "wdoc_guess",
        }),
      },
    );
    expect(response.status).toBe(403);
  });
});

describe("writing API response safety", () => {
  it("returns a job to its owner without internal documents", async () => {
    const response = await jobRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/writing/generations/${aliceJobId}`,
        { cookie: cookieFor(alice.token) },
      ),
      { params: Promise.resolve({ id: aliceProjectId, jobId: aliceJobId }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      writingGenerationJob: { id: string };
    };
    expect(body.writingGenerationJob.id).toBe(aliceJobId);
    const text = JSON.stringify(body);
    expect(text).not.toContain("generationRecipe");
    expect(text).not.toContain("contextSnapshot");
  });

  it("returns 404 for a document that does not exist", async () => {
    const response = await documentRoute.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/writing/documents/wdoc_missing`,
        { cookie: cookieFor(alice.token) },
      ),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          documentId: "wdoc_missing",
        }),
      },
    );
    expect(response.status).toBe(404);
  });
});
