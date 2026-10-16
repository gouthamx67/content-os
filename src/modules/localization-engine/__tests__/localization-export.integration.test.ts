import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASE,
  cleanupOwner,
  cleanupProject,
  cookieFor,
  createProject,
  createWritingDocument,
  loadLocalizationTestContext,
  registerUser,
  request,
  type Orm,
  type Owner,
  type Services,
} from "./helpers";

/**
 * Export proof.
 *
 * A localized artifact leaves the building only once a job has been applied, and
 * what leaves is deterministic: the same applied revision exports the same bytes,
 * with no storage keys, no raw rows and no source bytes.
 */

type IdCtx = { id: string };
type JobCtx = { id: string; jobId: string };
type Handler<P> = (
  request: Request,
  context: { params: Promise<P> },
) => Promise<Response>;
type Route<P> = { GET?: Handler<P>; POST?: Handler<P> };

type Detail = {
  job: { id: string; status: string; headRevisionNumber: number };
  snapshot: { segments: Array<{ id: string; path: string }> };
};

let services: Services;
let orm: Orm;
let localesRoute: Route<IdCtx>;
let jobsRoute: Route<IdCtx>;
let processRoute: Route<JobCtx>;
let reviewRoute: Route<JobCtx>;
let applyRoute: Route<JobCtx>;
let exportRoute: Route<JobCtx>;

let alice: Owner;
let projectId = "";

function post(url: string, cookie: string, payload: unknown): Request {
  return request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cookie,
    origin: BASE,
    body: JSON.stringify(payload),
  });
}

beforeAll(async () => {
  const loaded = await loadLocalizationTestContext();
  services = loaded.services;
  orm = loaded.orm;

  localesRoute = (await import(
    "../../../app/api/projects/[id]/locales/route"
  )) as unknown as Route<IdCtx>;
  jobsRoute = (await import(
    "../../../app/api/projects/[id]/localization/route"
  )) as unknown as Route<IdCtx>;
  processRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/process/route"
  )) as unknown as Route<JobCtx>;
  reviewRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/review/route"
  )) as unknown as Route<JobCtx>;
  applyRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/apply/route"
  )) as unknown as Route<JobCtx>;
  exportRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/export/route"
  )) as unknown as Route<JobCtx>;

  alice = await registerUser(services, "cp22-export");
  projectId = await createProject(services, alice, "Export");
  for (const [locale, isSource] of [
    ["en", true],
    ["pt-BR", false],
  ] as const) {
    const response = await localesRoute.POST!(
      post(`${BASE}/api/projects/${projectId}/locales`, cookieFor(alice.token), {
        locale,
        isSource,
        isTarget: !isSource,
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(response.status).toBe(201);
  }
});

afterAll(async () => {
  if (orm) {
    await cleanupProject(orm, alice, projectId);
    await cleanupOwner(orm, alice);
  }
});

describe("localized artifact export", () => {
  it("refuses to export before the job is applied", async () => {
    const docId = await createWritingDocument(orm, {
      projectId,
      userId: alice.user.id,
      title: "Unapplied headline",
    });
    const created = await jobsRoute.POST!(
      post(`${BASE}/api/projects/${projectId}/localization`, cookieFor(alice.token), {
        sourceType: "WRITING_DOCUMENT",
        sourceId: docId,
        targetLocale: "pt-BR",
        strategy: "TRANSLATE",
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    const job = (await created.json()) as Detail;

    const response = await exportRoute.GET!(
      request(`${BASE}/_`, { cookie: cookieFor(alice.token) }),
      { params: Promise.resolve({ id: projectId, jobId: job.job.id }) },
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe(
      "LOCALIZATION_NOT_APPROVED",
    );
  });

  it("exports a deterministic artifact once applied", async () => {
    const docId = await createWritingDocument(orm, {
      projectId,
      userId: alice.user.id,
      title: "Export headline",
      content: "Export body.",
    });
    const created = await jobsRoute.POST!(
      post(`${BASE}/api/projects/${projectId}/localization`, cookieFor(alice.token), {
        sourceType: "WRITING_DOCUMENT",
        sourceId: docId,
        targetLocale: "pt-BR",
        strategy: "TRANSLATE",
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    const job = (await created.json()) as Detail;

    const processed = await processRoute.POST!(
      post(`${BASE}/_`, cookieFor(alice.token), { expectedRevisionNumber: 1 }),
      { params: Promise.resolve({ id: projectId, jobId: job.job.id }) },
    );
    const processing = (await processed.json()) as Detail;

    const approved = await reviewRoute.POST!(
      post(`${BASE}/_`, cookieFor(alice.token), {
        expectedRevisionNumber: processing.job.headRevisionNumber,
        decision: "APPROVE",
      }),
      { params: Promise.resolve({ id: projectId, jobId: job.job.id }) },
    );
    const approvedDetail = (await approved.json()) as Detail;

    await applyRoute.POST!(
      post(`${BASE}/_`, cookieFor(alice.token), {
        expectedRevisionNumber: approvedDetail.job.headRevisionNumber,
      }),
      { params: Promise.resolve({ id: projectId, jobId: job.job.id }) },
    );

    const first = await exportRoute.GET!(
      request(`${BASE}/_`, { cookie: cookieFor(alice.token) }),
      { params: Promise.resolve({ id: projectId, jobId: job.job.id }) },
    );
    expect(first.status).toBe(200);
    const firstText = await first.text();

    const second = await exportRoute.GET!(
      request(`${BASE}/_`, { cookie: cookieFor(alice.token) }),
      { params: Promise.resolve({ id: projectId, jobId: job.job.id }) },
    );
    const secondText = await second.text();
    expect(secondText).toBe(firstText);

    const artifact = JSON.parse(firstText) as {
      schemaVersion: number;
      localizationJobId: string;
      targetHash: string;
      provider: string;
      segments: Array<{ sourceText: string; targetText: string | null }>;
    };
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.localizationJobId).toBe(job.job.id);
    expect(artifact.targetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.segments.length).toBe(2);
    expect(firstText).not.toContain("storageKey");
    expect(firstText).not.toContain("outputStorageKey");
  });
});
