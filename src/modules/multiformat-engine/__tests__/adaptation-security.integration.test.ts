import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASE,
  cleanupUser,
  cookieFor,
  createImageSource,
  createWritingSource,
  drain,
  loadAdaptationTestContext,
  makeWorker,
  registerUser,
  request,
  type Orm,
  type Services,
} from "./helpers";
import type { AdaptationWorker } from "../adaptation-worker";

type ProjectContext = { params: Promise<{ id: string }> };
type BatchContext = {
  params: Promise<{ id: string; batchId: string }>;
};
type JobContext = {
  params: Promise<{ id: string; jobId: string }>;
};

type FormatsRoute = {
  GET(request: Request, context: ProjectContext): Promise<Response>;
};
type BatchesRoute = {
  GET(request: Request, context: ProjectContext): Promise<Response>;
  POST(request: Request, context: ProjectContext): Promise<Response>;
};
type BatchRoute = { GET(request: Request, context: BatchContext): Promise<Response> };
type BatchCancelRoute = {
  POST(request: Request, context: BatchContext): Promise<Response>;
};
type JobRoute = { GET(request: Request, context: JobContext): Promise<Response> };
type JobCancelRoute = {
  POST(request: Request, context: JobContext): Promise<Response>;
};
type JobTextRoute = {
  GET(request: Request, context: JobContext): Promise<Response>;
};
type JobStreamRoute = {
  GET(request: Request, context: JobContext): Promise<Response>;
};

let services: Services;
let orm: Orm;
let worker: AdaptationWorker;

const routes: {
  formats: FormatsRoute;
  batches: BatchesRoute;
  batch: BatchRoute;
  batchCancel: BatchCancelRoute;
  job: JobRoute;
  jobCancel: JobCancelRoute;
  jobText: JobTextRoute;
  jobStream: JobStreamRoute;
} = {} as never;

let alice: Awaited<ReturnType<Services["authService"]["register"]>>;
let bob: Awaited<ReturnType<Services["authService"]["register"]>>;
let aliceProjectId: string;
let bobProjectId: string;
let aliceBatchId: string;
let aliceJobId: string;
let aliceImageAssetId: string;

const json = { "content-type": "application/json" };

beforeAll(async () => {
  const context = await loadAdaptationTestContext();
  services = context.services;
  orm = context.orm;
  worker = makeWorker(context.container);

  [
    routes.formats,
    routes.batches,
    routes.batch,
    routes.batchCancel,
    routes.job,
    routes.jobCancel,
    routes.jobText,
    routes.jobStream,
  ] = await Promise.all([
    import("../../../app/api/projects/[id]/multiformat/formats/route"),
    import("../../../app/api/projects/[id]/multiformat/batches/route"),
    import("../../../app/api/projects/[id]/multiformat/batches/[batchId]/route"),
    import("../../../app/api/projects/[id]/multiformat/batches/[batchId]/cancel/route"),
    import("../../../app/api/projects/[id]/multiformat/jobs/[jobId]/route"),
    import("../../../app/api/projects/[id]/multiformat/jobs/[jobId]/cancel/route"),
    import("../../../app/api/projects/[id]/multiformat/jobs/[jobId]/text/route"),
    import("../../../app/api/projects/[id]/multiformat/jobs/[jobId]/stream/route"),
  ]);

  alice = await registerUser(services, "cp19-sec-a");
  bob = await registerUser(services, "cp19-sec-b");

  aliceProjectId = (
    await services.projectService.createForWorkspace(
      alice.workspace!.id,
      { name: "Alice multiformat" },
      alice.user.id,
    )
  ).id;
  bobProjectId = (
    await services.projectService.createForWorkspace(
      bob.workspace!.id,
      { name: "Bob multiformat" },
      bob.user.id,
    )
  ).id;

  const writing = await createWritingSource(orm, services, {
    projectId: aliceProjectId,
    userId: alice.user.id,
  });
  const image = await createImageSource(
    services,
    { projectId: aliceProjectId, userId: alice.user.id },
    { width: 800, height: 600 },
  );
  aliceImageAssetId = image.assetId;

  const batch = await services.adaptationService.createBatch({
    projectId: aliceProjectId,
    userId: alice.user.id,
    sourceType: "WRITING_VARIANT",
    sourceId: writing.variantId,
    targets: [{ formatId: "COPY_SHORT" }],
  });
  aliceBatchId = batch.batch.id;
  aliceJobId = batch.jobs[0]!.id;

  await drain(worker);
});

afterAll(async () => {
  if (alice) await cleanupUser(orm, alice, aliceProjectId);
  if (bob) await cleanupUser(orm, bob, bobProjectId);
});

describe("multiformat API authentication", () => {
  it("refuses a listing with no session", async () => {
    const response = await routes.batches.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/multiformat/batches`),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );

    expect(response.status).toBe(401);
  });

  it("refuses a cross-origin create even with a valid cookie", async () => {
    const response = await routes.batches.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/multiformat/batches`, {
        method: "POST",
        cookie: cookieFor(alice.token),
        origin: "https://evil.example",
        headers: json,
        body: JSON.stringify({
          sourceType: "GENERATED_IMAGE",
          sourceId: aliceImageAssetId,
          targets: [{ formatId: "IMAGE_SQUARE" }],
        }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );

    expect(response.status).toBe(403);
  });

  it("refuses a cancel from another origin", async () => {
    const response = await routes.batchCancel.POST(
      request(
        `${BASE}/api/projects/${aliceProjectId}/multiformat/batches/${aliceBatchId}/cancel`,
        {
          method: "POST",
          cookie: cookieFor(alice.token),
          origin: "https://evil.example",
        },
      ),
      { params: Promise.resolve({ id: aliceProjectId, batchId: aliceBatchId }) },
    );

    expect(response.status).toBe(403);
  });
});

describe("multiformat API project isolation", () => {
  it("does not let an outsider create a batch", async () => {
    const response = await routes.batches.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/multiformat/batches`, {
        method: "POST",
        cookie: cookieFor(bob.token),
        headers: json,
        body: JSON.stringify({
          sourceType: "GENERATED_IMAGE",
          sourceId: aliceImageAssetId,
          targets: [{ formatId: "IMAGE_SQUARE" }],
        }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );

    expect(response.status).toBe(403);
  });

  it("does not let an outsider list batches", async () => {
    const response = await routes.batches.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/multiformat/batches`, {
        cookie: cookieFor(bob.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );

    expect(response.status).toBe(403);
  });

  it("does not let an outsider read a batch", async () => {
    const response = await routes.batch.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/multiformat/batches/${aliceBatchId}`, {
        cookie: cookieFor(bob.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId, batchId: aliceBatchId }) },
    );

    expect(response.status).toBe(403);
  });

  it("does not let an outsider read a job", async () => {
    const response = await routes.job.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/multiformat/jobs/${aliceJobId}`,
        { cookie: cookieFor(bob.token) },
      ),
      { params: Promise.resolve({ id: aliceProjectId, jobId: aliceJobId }) },
    );

    expect(response.status).toBe(403);
  });

  it("does not let an outsider read a job's text", async () => {
    const response = await routes.jobText.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/multiformat/jobs/${aliceJobId}/text`,
        { cookie: cookieFor(bob.token) },
      ),
      { params: Promise.resolve({ id: aliceProjectId, jobId: aliceJobId }) },
    );

    expect(response.status).toBe(403);
  });

  it("does not let an outsider cancel a batch", async () => {
    const response = await routes.batchCancel.POST(
      request(
        `${BASE}/api/projects/${aliceProjectId}/multiformat/batches/${aliceBatchId}/cancel`,
        { method: "POST", cookie: cookieFor(bob.token) },
      ),
      { params: Promise.resolve({ id: aliceProjectId, batchId: aliceBatchId }) },
    );

    expect(response.status).toBe(403);
  });

  it("does not let an outsider cancel a job", async () => {
    const response = await routes.jobCancel.POST(
      request(
        `${BASE}/api/projects/${aliceProjectId}/multiformat/jobs/${aliceJobId}/cancel`,
        { method: "POST", cookie: cookieFor(bob.token) },
      ),
      { params: Promise.resolve({ id: aliceProjectId, jobId: aliceJobId }) },
    );

    expect(response.status).toBe(403);
  });

  it("does not let an outsider read the format catalogue", async () => {
    const response = await routes.formats.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/multiformat/formats`, {
        cookie: cookieFor(bob.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );

    expect(response.status).toBe(403);
  });
});

describe("multiformat API cross-project ids", () => {
  it("will not read a batch through a project the caller does own", async () => {
    // Bob holds a valid session and a valid project id, but not this batch.
    const response = await routes.batch.GET(
      request(`${BASE}/api/projects/${bobProjectId}/multiformat/batches/${aliceBatchId}`, {
        cookie: cookieFor(bob.token),
      }),
      { params: Promise.resolve({ id: bobProjectId, batchId: aliceBatchId }) },
    );

    expect(response.status).toBe(404);
  });

  it("will not read a job through a project the caller does own", async () => {
    const response = await routes.job.GET(
      request(`${BASE}/api/projects/${bobProjectId}/multiformat/jobs/${aliceJobId}`, {
        cookie: cookieFor(bob.token),
      }),
      { params: Promise.resolve({ id: bobProjectId, jobId: aliceJobId }) },
    );

    expect(response.status).toBe(404);
  });

  it("will not use a source that belongs to another project", async () => {
    const response = await routes.batches.POST(
      request(`${BASE}/api/projects/${bobProjectId}/multiformat/batches`, {
        method: "POST",
        cookie: cookieFor(bob.token),
        headers: json,
        body: JSON.stringify({
          sourceType: "GENERATED_IMAGE",
          sourceId: aliceImageAssetId,
          targets: [{ formatId: "IMAGE_SQUARE" }],
        }),
      }),
      { params: Promise.resolve({ id: bobProjectId }) },
    );

    expect(response.status).toBe(404);
  });

  it("answers a guessed batch id with 404 rather than 403", async () => {
    const response = await routes.batch.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/multiformat/batches/batch_guess`, {
        cookie: cookieFor(alice.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId, batchId: "batch_guess" }) },
    );

    expect(response.status).toBe(404);
  });
});

describe("multiformat API response safety", () => {
  it("serves the batch without the frozen recipe or the storage key", async () => {
    const response = await routes.batch.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/multiformat/batches/${aliceBatchId}`, {
        cookie: cookieFor(alice.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId, batchId: aliceBatchId }) },
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      batch: { id: string; status: string; progressPct: number };
      jobs: Array<{ id: string; formatId: string; status: string; outputText: string | null }>;
    };

    expect(body.batch.id).toBe(aliceBatchId);
    expect(body.batch.status).toBe("SUCCEEDED");
    expect(body.batch.progressPct).toBe(100);
    expect(body.jobs).toHaveLength(1);

    const text = JSON.stringify(body);

    // The recipe carries the frozen snapshot text; neither it nor the on-disk
    // location may cross the wire.
    expect(text).not.toContain('"recipe"');
    expect(text).not.toContain("outputStorageKey");
    expect(text).not.toContain("First sentence here");
  });

  it("serves the adapted text itself", async () => {
    const response = await routes.jobText.GET(
      request(
        `${BASE}/api/projects/${aliceProjectId}/multiformat/jobs/${aliceJobId}/text`,
        { cookie: cookieFor(alice.token) },
      ),
      { params: Promise.resolve({ id: aliceProjectId, jobId: aliceJobId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");

    const text = await response.text();

    expect(text).toBeTruthy();
    expect(text.length).toBeLessThanOrEqual(80);
  });

  it("reports a malformed create as a 422 rather than a crash", async () => {
    const response = await routes.batches.POST(
      request(`${BASE}/api/projects/${aliceProjectId}/multiformat/batches`, {
        method: "POST",
        cookie: cookieFor(alice.token),
        headers: json,
        body: JSON.stringify({ sourceType: "GENERATED_IMAGE", targets: [] }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );

    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string; code?: string };

    expect(body.code === undefined || /^ADAPTATION_/.test(body.code)).toBe(true);
    expect(body.error).toBeTruthy();
  });

  it("offers a format catalogue scoped to the project", async () => {
    const response = await routes.formats.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/multiformat/formats?kind=IMAGE`, {
        cookie: cookieFor(alice.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      formats: Array<{ id: string; kind: string }>;
    };

    expect(body.formats.length).toBeGreaterThan(0);
    expect(body.formats.every((format) => format.kind === "IMAGE")).toBe(true);
  });

  it("shows provenance but never the storage key on a job", async () => {
    const response = await routes.job.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/multiformat/jobs/${aliceJobId}`, {
        cookie: cookieFor(alice.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId, jobId: aliceJobId }) },
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      job: { provenanceSourceIds: string[]; recipeSha256: string; outputStorageKey?: unknown };
    };

    expect(body.job.recipeSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.job.provenanceSourceIds.length).toBeGreaterThan(0);
    expect(body.job.outputStorageKey).toBeUndefined();
  });

  it("has no artifact to stream for a copy job", async () => {
    const response = await routes.jobStream.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/multiformat/jobs/${aliceJobId}/stream`, {
        cookie: cookieFor(alice.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId, jobId: aliceJobId }) },
    );

    // Copy output is read as text, so there is no artifact here to stream.
    expect(response.status).toBe(409);
  });

  it("does not let an outsider stream a job's artifact", async () => {
    const response = await routes.jobStream.GET(
      request(`${BASE}/api/projects/${aliceProjectId}/multiformat/jobs/${aliceJobId}/stream`, {
        cookie: cookieFor(bob.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId, jobId: aliceJobId }) },
    );

    expect(response.status).toBe(403);
  });
});
