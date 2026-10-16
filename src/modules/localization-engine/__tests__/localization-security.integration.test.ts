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
 * Access-control proof for the localization API.
 *
 * A localization reads artifacts from a project, so the boundary is the same one
 * every other engine enforces: a session is required, a write must be same
 * origin, a stranger cannot reach another project's job, and a source id from
 * another project resolves to nothing rather than leaking implicitly.
 */

type IdCtx = { id: string };
type JobCtx = { id: string; jobId: string };
type Handler<P> = (
  request: Request,
  context: { params: Promise<P> },
) => Promise<Response>;
type Route<P> = { GET?: Handler<P>; POST?: Handler<P> };

let services: Services;
let orm: Orm;
let localesRoute: Route<IdCtx>;
let jobsRoute: Route<IdCtx>;
let jobRoute: Route<JobCtx>;
let processRoute: Route<JobCtx>;

let alice: Owner;
let bob: Owner;
let aliceProjectId = "";
let bobProjectId = "";

function post(url: string, cookie: string, payload: unknown): Request {
  return request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cookie,
    origin: BASE,
    body: JSON.stringify(payload),
  });
}

async function configure(projectId: string, owner: Owner): Promise<void> {
  for (const [locale, isSource] of [
    ["en", true],
    ["pt-BR", false],
  ] as const) {
    const response = await localesRoute.POST!(
      post(`${BASE}/api/projects/${projectId}/locales`, cookieFor(owner.token), {
        locale,
        isSource,
        isTarget: !isSource,
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(response.status).toBe(201);
  }
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
  jobRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/route"
  )) as unknown as Route<JobCtx>;
  processRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/process/route"
  )) as unknown as Route<JobCtx>;

  alice = await registerUser(services, "cp22-sec-alice");
  bob = await registerUser(services, "cp22-sec-bob");
  aliceProjectId = await createProject(services, alice, "Alice secure");
  bobProjectId = await createProject(services, bob, "Bob secure");
  await configure(aliceProjectId, alice);
  await configure(bobProjectId, bob);
});

afterAll(async () => {
  if (orm) {
    await cleanupProject(orm, alice, aliceProjectId);
    await cleanupProject(orm, bob, bobProjectId);
    await cleanupOwner(orm, alice);
    await cleanupOwner(orm, bob);
  }
});

describe("localization API — access control", () => {
  it("requires a session to list jobs", async () => {
    const response = await jobsRoute.GET!(
      request(`${BASE}/api/projects/${aliceProjectId}/localization`),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(401);
  });

  it("refuses a cross-origin write", async () => {
    const response = await jobsRoute.POST!(
      request(`${BASE}/api/projects/${aliceProjectId}/localization`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie: cookieFor(alice.token),
        origin: "https://evil.example",
        body: JSON.stringify({
          sourceType: "WRITING_DOCUMENT",
          sourceId: "whatever",
          targetLocale: "pt-BR",
          strategy: "TRANSLATE",
        }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(403);
  });

  it("hides another project's job from a stranger", async () => {
    const docId = await createWritingDocument(orm, {
      projectId: bobProjectId,
      userId: bob.user.id,
      title: "Bob private",
    });
    const created = await jobsRoute.POST!(
      post(`${BASE}/api/projects/${bobProjectId}/localization`, cookieFor(bob.token), {
        sourceType: "WRITING_DOCUMENT",
        sourceId: docId,
        targetLocale: "pt-BR",
        strategy: "TRANSLATE",
      }),
      { params: Promise.resolve({ id: bobProjectId }) },
    );
    expect(created.status).toBe(201);
    const job = (await created.json()) as { job: { id: string } };

    const response = await jobRoute.GET!(
      request(`${BASE}/_`, { cookie: cookieFor(alice.token) }),
      { params: Promise.resolve({ id: bobProjectId, jobId: job.job.id }) },
    );
    expect([403, 404]).toContain(response.status);
  });

  it("refuses a cross-project source instead of leaking it", async () => {
    const foreignDocId = await createWritingDocument(orm, {
      projectId: bobProjectId,
      userId: bob.user.id,
      title: "Bob source",
    });

    const response = await jobsRoute.POST!(
      post(
        `${BASE}/api/projects/${aliceProjectId}/localization`,
        cookieFor(alice.token),
        {
          sourceType: "WRITING_DOCUMENT",
          sourceId: foreignDocId,
          targetLocale: "pt-BR",
          strategy: "TRANSLATE",
        },
      ),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe(
      "SOURCE_NOT_FOUND",
    );
  });

  it("refuses an invalid locale", async () => {
    const response = await localesRoute.POST!(
      post(`${BASE}/api/projects/${aliceProjectId}/locales`, cookieFor(alice.token), {
        locale: "not a locale!",
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      "INVALID_LOCALE",
    );
  });

  it("refuses an unknown source type", async () => {
    const response = await jobsRoute.POST!(
      post(`${BASE}/api/projects/${aliceProjectId}/localization`, cookieFor(alice.token), {
        sourceType: "MADE_UP",
        sourceId: "x",
        targetLocale: "pt-BR",
        strategy: "TRANSLATE",
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(400);
  });

  it("refuses an unavailable provider by name", async () => {
    const docId = await createWritingDocument(orm, {
      projectId: aliceProjectId,
      userId: alice.user.id,
      title: "Provider headline",
    });
    const created = await jobsRoute.POST!(
      post(`${BASE}/api/projects/${aliceProjectId}/localization`, cookieFor(alice.token), {
        sourceType: "WRITING_DOCUMENT",
        sourceId: docId,
        targetLocale: "pt-BR",
        strategy: "TRANSLATE",
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    const job = (await created.json()) as { job: { id: string } };

    const processed = await processRoute.POST!(
      post(`${BASE}/_`, cookieFor(alice.token), {
        expectedRevisionNumber: 1,
        provider: "machine-magic",
      }),
      { params: Promise.resolve({ id: aliceProjectId, jobId: job.job.id }) },
    );
    expect(processed.status).toBe(503);
    expect(((await processed.json()) as { code: string }).code).toBe(
      "LOCALIZATION_PROVIDER_UNAVAILABLE",
    );
  });
});
