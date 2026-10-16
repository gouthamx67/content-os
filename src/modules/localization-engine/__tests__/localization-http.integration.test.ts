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
 * HTTP-boundary proof for the localization API.
 *
 * The domain suite proves the engine's rules in isolation; this suite proves the
 * *routes* apply them: a session is required, a stranger cannot reach a project,
 * cross-origin writes are refused, a stale revision is a structured conflict, a
 * change request reaches the reviewer, and a job only exports once it is applied.
 * Each handler is invoked exactly as Next invokes it.
 */

type IdCtx = { id: string };
type JobCtx = { id: string; jobId: string };
type SegmentCtx = { id: string; jobId: string; segmentId: string };
type TermCtx = { id: string; termId: string };

type Handler<P> = (
  request: Request,
  context: { params: Promise<P> },
) => Promise<Response>;
type Route<P> = {
  GET?: Handler<P>;
  POST?: Handler<P>;
  PATCH?: Handler<P>;
  DELETE?: Handler<P>;
};

type Job = {
  id: string;
  status: string;
  headRevisionNumber: number;
  provider: string | null;
  targetLocale: string;
  sourceHash: string;
};
type Segment = {
  id: string;
  path: string;
  sourceText: string;
  targetText: string | null;
};
type Detail = {
  job: Job;
  snapshot: { segments: Segment[]; findings: Array<{ code: string }> };
  revisionNumber: number;
};

let services: Services;
let orm: Orm;

let localesRoute: Route<IdCtx>;
let jobsRoute: Route<IdCtx>;
let processRoute: Route<JobCtx>;
let validateRoute: Route<JobCtx>;
let reviewRoute: Route<JobCtx>;
let applyRoute: Route<JobCtx>;
let segmentRoute: Route<SegmentCtx>;
let historyRoute: Route<JobCtx>;
let exportRoute: Route<JobCtx>;
let glossaryRoute: Route<IdCtx>;
let termRoute: Route<TermCtx>;

let alice: Owner;
let bob: Owner;
let aliceProjectId = "";
let bobProjectId = "";

function body(
  init: RequestInit & { origin?: string; cookie?: string } = {},
): RequestInit & { origin?: string; cookie?: string } {
  return { origin: BASE, ...init };
}

async function addLocale(
  projectId: string,
  owner: Owner,
  locale: string,
  flags: { isSource?: boolean; isTarget?: boolean } = {},
): Promise<void> {
  const response = await localesRoute.POST!(
    request(
      `${BASE}/api/projects/${projectId}/locales`,
      body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie: cookieFor(owner.token),
        body: JSON.stringify({ locale, ...flags }),
      }),
    ),
    { params: Promise.resolve({ id: projectId }) },
  );
  expect(response.status).toBe(201);
}

async function createJob(
  projectId: string,
  owner: Owner,
  sourceId: string,
  targetLocale = "es",
): Promise<Detail> {
  const response = await jobsRoute.POST!(
    request(`${BASE}/api/projects/${projectId}/localization`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cookie: cookieFor(owner.token),
      origin: BASE,
      body: JSON.stringify({
        sourceType: "WRITING_DOCUMENT",
        sourceId,
        targetLocale,
        strategy: "TRANSLATE",
      }),
    }),
    { params: Promise.resolve({ id: projectId }) },
  );
  expect(response.status).toBe(201);
  return (await response.json()) as Detail;
}

function action(
  route: Route<JobCtx>,
  projectId: string,
  jobId: string,
  owner: Owner,
  payload: Record<string, unknown>,
): Promise<Response> {
  return route.POST!(
    request(`${BASE}/_`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cookie: cookieFor(owner.token),
      origin: BASE,
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id: projectId, jobId }) },
  );
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
  validateRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/validate/route"
  )) as unknown as Route<JobCtx>;
  reviewRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/review/route"
  )) as unknown as Route<JobCtx>;
  applyRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/apply/route"
  )) as unknown as Route<JobCtx>;
  segmentRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/segments/[segmentId]/route"
  )) as unknown as Route<SegmentCtx>;
  historyRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/history/route"
  )) as unknown as Route<JobCtx>;
  exportRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/export/route"
  )) as unknown as Route<JobCtx>;
  glossaryRoute = (await import(
    "../../../app/api/projects/[id]/localization/glossary/route"
  )) as unknown as Route<IdCtx>;
  termRoute = (await import(
    "../../../app/api/projects/[id]/localization/glossary/[termId]/route"
  )) as unknown as Route<TermCtx>;

  alice = await registerUser(services, "cp22-http-alice");
  bob = await registerUser(services, "cp22-http-bob");

  aliceProjectId = await createProject(services, alice, "Alice localization");
  bobProjectId = await createProject(services, bob, "Bob localization");
});

afterAll(async () => {
  if (orm) {
    await cleanupProject(orm, alice, aliceProjectId);
    await cleanupProject(orm, bob, bobProjectId);
    await cleanupOwner(orm, alice);
    await cleanupOwner(orm, bob);
  }
});

describe("localization API", () => {
  it("configures locales and canonicalizes the code", async () => {
    await addLocale(aliceProjectId, alice, "en", { isSource: true, isTarget: false });
    await addLocale(aliceProjectId, alice, "pt-br");

    const list = await localesRoute.GET!(
      request(`${BASE}/api/projects/${aliceProjectId}/locales`, {
        cookie: cookieFor(alice.token),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    const body = (await list.json()) as { locales: Array<{ locale: string }> };
    expect(body.locales.map((l) => l.locale)).toContain("pt-BR");
  });

  it("rejects a duplicate locale", async () => {
    const response = await localesRoute.POST!(
      request(`${BASE}/api/projects/${aliceProjectId}/locales`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie: cookieFor(alice.token),
        origin: BASE,
        body: JSON.stringify({ locale: "pt-BR" }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe(
      "LOCALE_ALREADY_CONFIGURED",
    );
  });

  it("runs create → process → validate → approve → apply → export", async () => {
    const docId = await createWritingDocument(orm, {
      projectId: aliceProjectId,
      userId: alice.user.id,
      title: "Launch headline",
      content: "First paragraph.\n\nSecond paragraph.",
    });

    const created = await createJob(aliceProjectId, alice, docId, "pt-BR");
    expect(created.job.status).toBe("READY_TO_LOCALIZE");
    expect(created.job.headRevisionNumber).toBe(1);
    expect(created.snapshot.segments.length).toBe(3);

    const processed = await action(processRoute, aliceProjectId, created.job.id, alice, {
      expectedRevisionNumber: 1,
    });
    expect(processed.status).toBe(200);
    const processing = (await processed.json()) as Detail;
    expect(processing.job.status).toBe("NEEDS_REVIEW");
    expect(processing.job.provider).toBe("local-rules");

    const validated = await action(validateRoute, aliceProjectId, created.job.id, alice, {
      expectedRevisionNumber: processing.job.headRevisionNumber,
    });
    expect(validated.status).toBe(200);

    const approved = await action(reviewRoute, aliceProjectId, created.job.id, alice, {
      expectedRevisionNumber: processing.job.headRevisionNumber + 1,
      decision: "APPROVE",
    });
    expect(approved.status).toBe(200);
    const approvedDetail = (await approved.json()) as Detail;
    expect(approvedDetail.job.status).toBe("APPROVED");

    const applied = await action(applyRoute, aliceProjectId, created.job.id, alice, {
      expectedRevisionNumber: approvedDetail.job.headRevisionNumber,
    });
    expect(applied.status).toBe(200);
    expect(((await applied.json()) as Detail).job.status).toBe("APPLIED");

    const history = await historyRoute.GET!(
      request(`${BASE}/_/history`, { cookie: cookieFor(alice.token) }),
      { params: Promise.resolve({ id: aliceProjectId, jobId: created.job.id }) },
    );
    expect(history.status).toBe(200);
    const historyBody = (await history.json()) as {
      total: number;
      revisions: Array<{ kind: string }>;
    };
    expect(historyBody.total).toBeGreaterThanOrEqual(6);
    expect(historyBody.revisions.map((r) => r.kind)).toContain("APPLIED");

    const exported = await exportRoute.GET!(
      request(`${BASE}/_/export`, { cookie: cookieFor(alice.token) }),
      { params: Promise.resolve({ id: aliceProjectId, jobId: created.job.id }) },
    );
    expect(exported.status).toBe(200);
    const artifact = (await exported.json()) as {
      schemaVersion: number;
      localizationJobId: string;
      targetHash: string;
    };
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.localizationJobId).toBe(created.job.id);
    expect(artifact.targetHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a stale revision with a structured conflict", async () => {
    const docId = await createWritingDocument(orm, {
      projectId: aliceProjectId,
      userId: alice.user.id,
      title: "Conflict headline",
    });
    const created = await createJob(aliceProjectId, alice, docId, "pt-BR");

    const response = await action(processRoute, aliceProjectId, created.job.id, alice, {
      expectedRevisionNumber: 999,
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe(
      "LOCALIZATION_REVISION_CONFLICT",
    );
  });

  it("surfaces a blocker and refuses approval until it is fixed", async () => {
    const docId = await createWritingDocument(orm, {
      projectId: aliceProjectId,
      userId: alice.user.id,
      title: "Blocker {brand}",
      content: "Body copy.",
    });
    const created = await createJob(aliceProjectId, alice, docId, "pt-BR");
    const processed = await action(processRoute, aliceProjectId, created.job.id, alice, {
      expectedRevisionNumber: 1,
    });
    const processing = (await processed.json()) as Detail;

    const headline = processing.snapshot.segments.find((s) => s.path.endsWith(":title"))!;
    const edited = await segmentRoute.PATCH!(
      request(`${BASE}/_`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        cookie: cookieFor(alice.token),
        origin: BASE,
        body: JSON.stringify({
          expectedRevisionNumber: processing.job.headRevisionNumber,
          targetText: "Dropped the placeholder",
        }),
      }),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          jobId: created.job.id,
          segmentId: headline.id,
        }),
      },
    );
    expect(edited.status).toBe(200);
    const editedDetail = (await edited.json()) as Detail;
    expect(
      editedDetail.snapshot.findings.some(
        (finding) => finding.code === "PLACEHOLDER_MISSING",
      ),
    ).toBe(true);

    const review = await action(reviewRoute, aliceProjectId, created.job.id, alice, {
      expectedRevisionNumber: editedDetail.job.headRevisionNumber,
      decision: "APPROVE",
    });
    expect(review.status).toBe(409);
    expect(((await review.json()) as { code: string }).code).toBe(
      "LOCALIZATION_NOT_READY",
    );
  });

  it("sends a job back for changes", async () => {
    const docId = await createWritingDocument(orm, {
      projectId: aliceProjectId,
      userId: alice.user.id,
      title: "Send back headline",
    });
    const created = await createJob(aliceProjectId, alice, docId, "pt-BR");
    const processed = await action(processRoute, aliceProjectId, created.job.id, alice, {
      expectedRevisionNumber: 1,
    });
    const processing = (await processed.json()) as Detail;

    const returned = await action(reviewRoute, aliceProjectId, created.job.id, alice, {
      expectedRevisionNumber: processing.job.headRevisionNumber,
      decision: "REQUEST_CHANGES",
    });
    expect(returned.status).toBe(200);
    expect(((await returned.json()) as Detail).job.status).toBe(
      "CHANGES_REQUESTED",
    );
  });

  it("applies the glossary during processing", async () => {
    const docId = await createWritingDocument(orm, {
      projectId: aliceProjectId,
      userId: alice.user.id,
      title: "Launch the rocket",
    });

    const added = await glossaryRoute.POST!(
      request(`${BASE}/_`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie: cookieFor(alice.token),
        origin: BASE,
        body: JSON.stringify({
          sourceLocale: "en",
          targetLocale: "pt-BR",
          term: "Launch",
          translation: "Lancamento",
        }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(added.status).toBe(201);

    const created = await createJob(aliceProjectId, alice, docId, "pt-BR");
    const processed = await action(processRoute, aliceProjectId, created.job.id, alice, {
      expectedRevisionNumber: 1,
    });
    const processing = (await processed.json()) as Detail;
    const headline = processing.snapshot.segments.find((s) => s.path.endsWith(":title"))!;
    expect(headline.targetText).toContain("Lancamento");

    const terms = await glossaryRoute.GET!(
      request(
        `${BASE}/_?sourceLocale=en&targetLocale=pt-BR`,
        { cookie: cookieFor(alice.token) },
      ),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    const termsBody = (await terms.json()) as { terms: Array<{ id: string }> };
    const termId = termsBody.terms[0]!.id;

    const removed = await termRoute.DELETE!(
      request(`${BASE}/_`, {
        method: "DELETE",
        cookie: cookieFor(alice.token),
        origin: BASE,
      }),
      { params: Promise.resolve({ id: aliceProjectId, termId }) },
    );
    expect(removed.status).toBe(200);
  });
});
