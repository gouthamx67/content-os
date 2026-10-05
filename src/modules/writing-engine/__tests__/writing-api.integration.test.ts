import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASE,
  cleanupUser,
  cookieFor,
  createAnalyzedProject,
  loadWritingTestContext,
  request,
  type Container,
  type Orm,
  type Services,
} from "./helpers";
import type { WritingGenerationWorker } from "../writing-generation-worker";

type IdContext = { params: Promise<{ id: string }> };
type JobContext = { params: Promise<{ id: string; jobId: string }> };
type DocContext = { params: Promise<{ id: string; documentId: string }> };
type ClaimContext = {
  params: Promise<{ id: string; documentId: string; claimId: string }>;
};

type GenerateRoute = {
  POST(request: Request, context: IdContext): Promise<Response>;
};
type GenerationsRoute = {
  GET(request: Request, context: IdContext): Promise<Response>;
};
type JobRoute = {
  GET(request: Request, context: JobContext): Promise<Response>;
};
type CancelRoute = {
  POST(request: Request, context: JobContext): Promise<Response>;
};
type DocumentsRoute = {
  GET(request: Request, context: IdContext): Promise<Response>;
};
type DocumentRoute = {
  GET(request: Request, context: DocContext): Promise<Response>;
};
type SelectVariantRoute = {
  POST(request: Request, context: DocContext): Promise<Response>;
};
type RewriteRoute = {
  POST(request: Request, context: DocContext): Promise<Response>;
};
type VariantsRoute = {
  POST(request: Request, context: DocContext): Promise<Response>;
};
type ClaimRoute = {
  GET(request: Request, context: ClaimContext): Promise<Response>;
};

let services: Services;
let container: Container;
let orm: Orm;
let worker: WritingGenerationWorker;

let generateRoute: GenerateRoute;
let generationsRoute: GenerationsRoute;
let jobRoute: JobRoute;
let cancelRoute: CancelRoute;
let documentsRoute: DocumentsRoute;
let documentRoute: DocumentRoute;
let selectVariantRoute: SelectVariantRoute;
let rewriteRoute: RewriteRoute;
let variantsRoute: VariantsRoute;
let claimRoute: ClaimRoute;

let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;
let documentId: string;
let jobId: string;

function jsonInit(
  cookie: string,
  body: unknown,
): RequestInit & { cookie: string } {
  return {
    method: "POST",
    cookie,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function drain(): Promise<void> {
  for (let guard = 0; guard < 50; guard += 1) {
    if (!(await worker.tick())) return;
  }
  throw new Error("writing queue did not drain");
}

beforeAll(async () => {
  const loaded = await loadWritingTestContext();
  services = loaded.services;
  container = loaded.container;
  orm = loaded.orm;
  worker = container.createWritingWorker();

  [
    generateRoute,
    generationsRoute,
    jobRoute,
    cancelRoute,
    documentsRoute,
    documentRoute,
    selectVariantRoute,
    rewriteRoute,
    variantsRoute,
    claimRoute,
  ] = await Promise.all([
    import("../../../app/api/projects/[id]/writing/generate/route"),
    import("../../../app/api/projects/[id]/writing/generations/route"),
    import("../../../app/api/projects/[id]/writing/generations/[jobId]/route"),
    import(
      "../../../app/api/projects/[id]/writing/generations/[jobId]/cancel/route"
    ),
    import("../../../app/api/projects/[id]/writing/documents/route"),
    import("../../../app/api/projects/[id]/writing/documents/[documentId]/route"),
    import(
      "../../../app/api/projects/[id]/writing/documents/[documentId]/select-variant/route"
    ),
    import(
      "../../../app/api/projects/[id]/writing/documents/[documentId]/rewrite/route"
    ),
    import(
      "../../../app/api/projects/[id]/writing/documents/[documentId]/variants/route"
    ),
    import(
      "../../../app/api/projects/[id]/writing/documents/[documentId]/claims/[claimId]/route"
    ),
  ]);

  const created = await createAnalyzedProject(services);
  owner = created.owner;
  projectId = created.projectId;
  await drain();
});

afterAll(async () => {
  if (owner) await cleanupUser(orm, owner, projectId);
});

describe("writing API", () => {
  it("enqueues through the route without leaking internals", async () => {
    const response = await generateRoute.POST(
      request(
        `${BASE}/api/projects/${projectId}/writing/generate`,
        jsonInit(cookieFor(owner.token), {
          blockType: "HEADLINE",
          tone: "BRAND",
          length: "MEDIUM",
          objective: "AWARENESS",
          prompt: "Route headline",
          variantCount: 3,
        }),
      ),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      writingGenerationJob: { id: string; status: string };
    };
    jobId = body.writingGenerationJob.id;
    expect(body.writingGenerationJob.status).toBe("QUEUED");

    const text = JSON.stringify(body);
    expect(text).not.toContain("generationRecipe");
    expect(text).not.toContain("contextSnapshot");
  });

  it("reports the finished job and its document", async () => {
    await drain();

    const response = await jobRoute.GET(
      request(
        `${BASE}/api/projects/${projectId}/writing/generations/${jobId}`,
        { cookie: cookieFor(owner.token) },
      ),
      { params: Promise.resolve({ id: projectId, jobId }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      writingGenerationJob: { status: string };
      documentId: string;
      document: { id: string } | null;
    };
    expect(body.writingGenerationJob.status).toBe("SUCCEEDED");
    expect(body.document).not.toBeNull();
    documentId = body.documentId;

    const text = JSON.stringify(body);
    expect(text).not.toContain("generationRecipe");
    expect(text).not.toContain("contextSnapshot");

    const list = await generationsRoute.GET(
      request(
        `${BASE}/api/projects/${projectId}/writing/generations`,
        { cookie: cookieFor(owner.token) },
      ),
      { params: Promise.resolve({ id: projectId }) },
    );
    const listBody = (await list.json()) as {
      writingGenerationJobs: Array<{ id: string }>;
    };
    expect(listBody.writingGenerationJobs.map((job) => job.id)).toContain(jobId);
  });

  it("lists and reads documents, variants and claims", async () => {
    const list = await documentsRoute.GET(
      request(`${BASE}/api/projects/${projectId}/writing/documents`, {
        cookie: cookieFor(owner.token),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      writingDocuments: Array<{ id: string }>;
    };
    expect(listBody.writingDocuments.map((doc) => doc.id)).toContain(documentId);

    const detail = await documentRoute.GET(
      request(
        `${BASE}/api/projects/${projectId}/writing/documents/${documentId}`,
        { cookie: cookieFor(owner.token) },
      ),
      { params: Promise.resolve({ id: projectId, documentId }) },
    );
    const detailBody = (await detail.json()) as {
      document: { id: string };
      variants: Array<{ id: string; selected: boolean }>;
      claims: Array<{ id: string; status: string }>;
    };
    expect(detailBody.document.id).toBe(documentId);
    expect(detailBody.variants.length).toBeGreaterThan(0);
    expect(detailBody.claims.length).toBeGreaterThan(0);

    const claimId = detailBody.claims[0]!.id;
    const claim = await claimRoute.GET(
      request(
        `${BASE}/api/projects/${projectId}/writing/documents/${documentId}/claims/${claimId}`,
        { cookie: cookieFor(owner.token) },
      ),
      { params: Promise.resolve({ id: projectId, documentId, claimId }) },
    );
    expect(claim.status).toBe(200);
    const claimBody = (await claim.json()) as {
      writingClaim: { id: string };
    };
    expect(claimBody.writingClaim.id).toBe(claimId);
  });

  it("selects a variant and rewrites it", async () => {
    const detail = await documentRoute.GET(
      request(
        `${BASE}/api/projects/${projectId}/writing/documents/${documentId}`,
        { cookie: cookieFor(owner.token) },
      ),
      { params: Promise.resolve({ id: projectId, documentId }) },
    );
    const detailBody = (await detail.json()) as {
      variants: Array<{ id: string }>;
    };
    const target = detailBody.variants[1] ?? detailBody.variants[0]!;

    const selected = await selectVariantRoute.POST(
      request(
        `${BASE}/api/projects/${projectId}/writing/documents/${documentId}/select-variant`,
        jsonInit(cookieFor(owner.token), { variantId: target.id }),
      ),
      { params: Promise.resolve({ id: projectId, documentId }) },
    );
    expect(selected.status).toBe(200);
    const selectedBody = (await selected.json()) as {
      variant: { id: string; selected: boolean };
    };
    expect(selectedBody.variant.id).toBe(target.id);
    expect(selectedBody.variant.selected).toBe(true);

    const rewritten = await rewriteRoute.POST(
      request(
        `${BASE}/api/projects/${projectId}/writing/documents/${documentId}/rewrite`,
        jsonInit(cookieFor(owner.token), { instruction: "SHORTEN" }),
      ),
      { params: Promise.resolve({ id: projectId, documentId }) },
    );
    expect(rewritten.status).toBe(200);
    const rewrittenBody = (await rewritten.json()) as {
      variant: { instruction: string; selected: boolean };
    };
    expect(rewrittenBody.variant.instruction).toBe("SHORTEN");
    expect(rewrittenBody.variant.selected).toBe(true);

    const more = await variantsRoute.POST(
      request(
        `${BASE}/api/projects/${projectId}/writing/documents/${documentId}/variants`,
        jsonInit(cookieFor(owner.token), { variantCount: 2 }),
      ),
      { params: Promise.resolve({ id: projectId, documentId }) },
    );
    expect(more.status).toBe(201);
    const moreBody = (await more.json()) as { variants: unknown[] };
    expect(moreBody.variants.length).toBeGreaterThan(0);
  });

  it("cancels a queued job through the route", async () => {
    const enqueue = await generateRoute.POST(
      request(
        `${BASE}/api/projects/${projectId}/writing/generate`,
        jsonInit(cookieFor(owner.token), {
          blockType: "HOOK",
          tone: "BOLD",
          length: "SHORT",
          objective: "AWARENESS",
          prompt: "Cancel me",
          variantCount: 2,
        }),
      ),
      { params: Promise.resolve({ id: projectId }) },
    );
    const queued = (await enqueue.json()) as {
      writingGenerationJob: { id: string };
    };

    const cancel = await cancelRoute.POST(
      request(
        `${BASE}/api/projects/${projectId}/writing/generations/${queued.writingGenerationJob.id}/cancel`,
        { method: "POST", cookie: cookieFor(owner.token) },
      ),
      {
        params: Promise.resolve({
          id: projectId,
          jobId: queued.writingGenerationJob.id,
        }),
      },
    );
    expect(cancel.status).toBe(200);
    const cancelled = (await cancel.json()) as {
      writingGenerationJob: { status: string };
    };
    expect(cancelled.writingGenerationJob.status).toBe("CANCELLED");
  });
});
