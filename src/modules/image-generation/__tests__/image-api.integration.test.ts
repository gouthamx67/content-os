import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { imageStorage } from "../storage/image-storage";
import {
  BASE,
  cleanupUser,
  cookieFor,
  loadImageTestContext,
  registerUser,
  request,
  type Container,
  type Orm,
  type Services,
} from "./helpers";

type IdContext = { params: Promise<{ id: string }> };
type JobContext = { params: Promise<{ id: string; jobId: string }> };
type AssetContext = { params: Promise<{ id: string; assetId: string }> };

type GenerateRoute = {
  POST(request: Request, context: IdContext): Promise<Response>;
  GET(request: Request, context: IdContext): Promise<Response>;
};
type VariantsRoute = {
  POST(request: Request, context: IdContext): Promise<Response>;
};
type JobsRoute = {
  GET(request: Request, context: IdContext): Promise<Response>;
};
type JobRoute = {
  GET(request: Request, context: JobContext): Promise<Response>;
};
type CancelRoute = {
  POST(request: Request, context: JobContext): Promise<Response>;
};
type AssetsRoute = {
  GET(request: Request, context: IdContext): Promise<Response>;
};
type AssetRoute = {
  GET(request: Request, context: AssetContext): Promise<Response>;
};
type StreamRoute = {
  GET(request: Request, context: AssetContext): Promise<Response>;
};

let services: Services;
let container: Container;
let orm: Orm;
let worker: ReturnType<Container["createImageWorker"]>;

let generateRoute: GenerateRoute;
let variantsRoute: VariantsRoute;
let jobsRoute: JobsRoute;
let jobRoute: JobRoute;
let cancelRoute: CancelRoute;
let assetsRoute: AssetsRoute;
let assetRoute: AssetRoute;
let streamRoute: StreamRoute;

let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;
const storageKeys: string[] = [];

function jsonInit(
  cookie: string | undefined,
  body: unknown,
  method = "POST",
): RequestInit {
  return {
    method,
    ...(cookie ? { cookie } : {}),
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function drain(): Promise<void> {
  let worked = await worker.tick();
  while (worked) worked = await worker.tick();
}

beforeAll(async () => {
  const context = await loadImageTestContext();
  services = context.services;
  container = context.container;
  orm = context.orm;

  worker = container.createImageWorker();

  [generateRoute, variantsRoute, jobsRoute, jobRoute, cancelRoute, assetsRoute, assetRoute, streamRoute] =
    await Promise.all([
      import("../../../app/api/projects/[id]/images/generate/route"),
      import("../../../app/api/projects/[id]/images/generate-variants/route"),
      import("../../../app/api/projects/[id]/images/generations/route"),
      import(
        "../../../app/api/projects/[id]/images/generations/[jobId]/route"
      ),
      import(
        "../../../app/api/projects/[id]/images/generations/[jobId]/cancel/route"
      ),
      import("../../../app/api/projects/[id]/images/assets/route"),
      import("../../../app/api/projects/[id]/images/assets/[assetId]/route"),
      import(
        "../../../app/api/projects/[id]/images/assets/[assetId]/stream/route"
      ),
    ]);

  owner = await registerUser(services, "cp17-api");
  const project = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "CP17 API project" },
    owner.user.id,
  );
  projectId = project.id;
});

afterAll(async () => {
  for (const key of storageKeys) {
    await imageStorage.delete(key).catch(() => undefined);
  }
  if (owner) await cleanupUser(orm, owner, projectId);
});

describe("image generation API", () => {
  let jobId: string;

  it("enqueues, renders, and serves a real image through the routes", async () => {
    const enqueue = await generateRoute.POST(
      request(
        `${BASE}/api/projects/${projectId}/images/generate`,
        jsonInit(cookieFor(owner.token), {
          templateType: "PRODUCT_HERO",
          prompt: "Ship a hero",
          width: 480,
          height: 480,
        }),
      ),
      { params: Promise.resolve({ id: projectId }) },
    );

    expect(enqueue.status).toBe(201);
    const enqueued = (await enqueue.json()) as {
      imageGenerationJob: { id: string; status: string };
    };
    jobId = enqueued.imageGenerationJob.id;
    expect(enqueued.imageGenerationJob.status).toBe("QUEUED");

    await drain();

    const jobResponse = await jobRoute.GET(
      request(
        `${BASE}/api/projects/${projectId}/images/generations/${jobId}`,
        { cookie: cookieFor(owner.token) },
      ),
      { params: Promise.resolve({ id: projectId, jobId }) },
    );
    expect(jobResponse.status).toBe(200);
    const jobBody = (await jobResponse.json()) as {
      imageGenerationJob: { status: string; progressPct: number };
      asset: { id: string; streamUrl: string; checksumSha256: string } | null;
    };
    expect(jobBody.imageGenerationJob.status).toBe("SUCCEEDED");
    expect(jobBody.imageGenerationJob.progressPct).toBe(100);
    expect(jobBody.asset).not.toBeNull();

    const asset = jobBody.asset!;
    expect(asset.streamUrl).toContain(`/images/assets/${asset.id}/stream`);
    expect(JSON.stringify(jobBody)).not.toContain("storageKey");

    const stored = await services.imageRepository.getAsset(projectId, asset.id);
    expect(stored).not.toBeNull();
    storageKeys.push(stored!.storageKey);

    const streamResponse = await streamRoute.GET(
      request(
        `${BASE}/api/projects/${projectId}/images/assets/${asset.id}/stream`,
        { cookie: cookieFor(owner.token) },
      ),
      { params: Promise.resolve({ id: projectId, assetId: asset.id }) },
    );
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type")).toBe("image/png");
    expect(streamResponse.headers.get("content-disposition")).toContain(
      "inline",
    );

    const bytes = Buffer.from(await streamResponse.arrayBuffer());
    expect(bytes.subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(digest).toBe(asset.checksumSha256);
  });

  it("lists the job and the asset library", async () => {
    const jobsResponse = await jobsRoute.GET(
      request(`${BASE}/api/projects/${projectId}/images/generations`, {
        cookie: cookieFor(owner.token),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    const jobsBody = (await jobsResponse.json()) as {
      imageGenerationJobs: Array<{ id: string }>;
    };
    expect(jobsBody.imageGenerationJobs.map((job) => job.id)).toContain(jobId);

    const assetsResponse = await assetsRoute.GET(
      request(`${BASE}/api/projects/${projectId}/images/assets`, {
        cookie: cookieFor(owner.token),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    const assetsBody = (await assetsResponse.json()) as {
      assets: Array<{ id: string; streamUrl: string }>;
    };
    expect(assetsBody.assets.length).toBeGreaterThan(0);
    expect(assetsBody.assets[0]!.streamUrl).toContain("/stream");
    expect(JSON.stringify(assetsBody)).not.toContain("storageKey");
  });

  it("serves one asset by id through the asset route", async () => {
    const assets = await services.imageRepository.listAssets(projectId);
    const target = assets[0]!;

    const response = await assetRoute.GET(
      request(
        `${BASE}/api/projects/${projectId}/images/assets/${target.id}`,
        { cookie: cookieFor(owner.token) },
      ),
      { params: Promise.resolve({ id: projectId, assetId: target.id }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      asset: { id: string };
    };
    expect(body.asset.id).toBe(target.id);
  });

  it("cancels a queued job through the route", async () => {
    const enqueue = await generateRoute.POST(
      request(
        `${BASE}/api/projects/${projectId}/images/generate`,
        jsonInit(cookieFor(owner.token), {
          templateType: "SOCIAL_POST",
          prompt: "Cancel this one",
          width: 256,
          height: 256,
        }),
      ),
      { params: Promise.resolve({ id: projectId }) },
    );
    const queued = (await enqueue.json()) as {
      imageGenerationJob: { id: string };
    };

    const cancel = await cancelRoute.POST(
      request(
        `${BASE}/api/projects/${projectId}/images/generations/${queued.imageGenerationJob.id}/cancel`,
        { method: "POST", cookie: cookieFor(owner.token) },
      ),
      {
        params: Promise.resolve({
          id: projectId,
          jobId: queued.imageGenerationJob.id,
        }),
      },
    );
    expect(cancel.status).toBe(200);
    const cancelled = (await cancel.json()) as {
      imageGenerationJob: { status: string };
    };
    expect(cancelled.imageGenerationJob.status).toBe("CANCELLED");
  });

  it("enqueues one job per platform variant", async () => {
    const response = await variantsRoute.POST(
      request(
        `${BASE}/api/projects/${projectId}/images/generate-variants`,
        jsonInit(cookieFor(owner.token), {
          templateType: "SOCIAL_POST",
          prompt: "Variant brief",
        }),
      ),
      { params: Promise.resolve({ id: projectId }) },
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      imageGenerationJobs: Array<{ id: string; width: number; height: number }>;
    };
    expect(body.imageGenerationJobs).toHaveLength(4);

    // Clean the queue for later files.
    for (const job of body.imageGenerationJobs) {
      await services.imageRepository.requestCancel(projectId, job.id);
    }
  });
});
