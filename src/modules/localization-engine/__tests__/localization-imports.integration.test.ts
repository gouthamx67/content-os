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
 * Source-import proof.
 *
 * Each upstream checkpoint is read through the adapter that owns it, so this
 * suite resolves a real writing document, a real editor revision, a real
 * adaptation job and a real campaign through their repositories and asserts the
 * segments that come out.
 */

type IdCtx = { id: string };
type JobCtx = { id: string; jobId: string };
type Handler<P> = (
  request: Request,
  context: { params: Promise<P> },
) => Promise<Response>;
type Route<P> = { GET?: Handler<P>; POST?: Handler<P> };

type Detail = {
  job: { id: string; status: string; headRevisionNumber: number; sourceHash: string };
  snapshot: {
    segments: Array<{ id: string; kind: string; path: string; sourceText: string }>;
  };
  revisionNumber: number;
};

let services: Services;
let orm: Orm;
let localesRoute: Route<IdCtx>;
let jobsRoute: Route<IdCtx>;
let validateRoute: Route<JobCtx>;
let campaignsRoute: Route<IdCtx>;

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

async function addLocale(locale: string, isSource: boolean): Promise<void> {
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

async function createJob(sourceType: string, sourceId: string): Promise<Detail> {
  const response = await jobsRoute.POST!(
    post(`${BASE}/api/projects/${projectId}/localization`, cookieFor(alice.token), {
      sourceType,
      sourceId,
      targetLocale: "pt-BR",
      strategy: "TRANSLATE",
    }),
    { params: Promise.resolve({ id: projectId }) },
  );
  expect(response.status).toBe(201);
  return (await response.json()) as Detail;
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
  validateRoute = (await import(
    "../../../app/api/projects/[id]/localization/[jobId]/validate/route"
  )) as unknown as Route<JobCtx>;
  campaignsRoute = (await import(
    "../../../app/api/projects/[id]/campaigns/route"
  )) as unknown as Route<IdCtx>;

  alice = await registerUser(services, "cp22-imports");
  projectId = await createProject(services, alice, "Imports");
  await addLocale("en", true);
  await addLocale("pt-BR", false);
});

afterAll(async () => {
  if (orm) {
    await cleanupProject(orm, alice, projectId);
    await cleanupOwner(orm, alice);
  }
});

describe("source imports", () => {
  it("reads a writing document into headline and body segments", async () => {
    const docId = await createWritingDocument(orm, {
      projectId,
      userId: alice.user.id,
      title: "Alpha headline",
      content: "Para one.\n\nPara two.",
    });

    const detail = await createJob("WRITING_DOCUMENT", docId);
    const kinds = detail.snapshot.segments.map((segment) => segment.kind);
    expect(kinds).toContain("HEADLINE");
    expect(kinds.filter((kind) => kind === "BODY")).toHaveLength(2);
  });

  it("marks a job stale when the writing document version moves", async () => {
    const docId = await createWritingDocument(orm, {
      projectId,
      userId: alice.user.id,
      title: "Staleness headline",
      content: "Original body.",
    });

    const detail = await createJob("WRITING_DOCUMENT", docId);

    await orm.WritingDocument.where({ id: docId }).update({ version: 2 });

    const response = await validateRoute.POST!(
      post(
        `${BASE}/_`,
        cookieFor(alice.token),
        { expectedRevisionNumber: detail.job.headRevisionNumber },
      ),
      { params: Promise.resolve({ id: projectId, jobId: detail.job.id }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { stale: boolean; job: { status: string } };
    expect(body.stale).toBe(true);
    expect(body.job.status).toBe("STALE");
  });

  it("reads an editor document's head revision text nodes", async () => {
    const documentId = `edoc-${Math.random().toString(36).slice(2, 10)}`;
    await orm.EditorDocument.create({
      id: documentId,
      projectId,
      name: "Editor doc",
      createdById: alice.user.id,
    });

    const snapshot = JSON.stringify({
      version: 1,
      documentId,
      width: 1080,
      height: 1080,
      durationMs: 3000,
      frameRate: 30,
      nodes: [
        {
          id: "node_text_1",
          parentId: null,
          type: "TEXT",
          name: "Title",
          zIndex: 0,
          transform: {},
          visible: true,
          asset: null,
          text: { value: "Editor caption text" },
          style: {},
          trim: null,
          audio: null,
          shape: null,
          motion: null,
          effects: null,
          automation: null,
          provenance: {},
        },
      ],
    });

    const { createHash } = await import("node:crypto");
    await orm.EditorRevision.create({
      id: `erev-${Math.random().toString(36).slice(2, 10)}`,
      documentId,
      revisionNumber: 1,
      operationType: "CREATE",
      operationPayload: "{}",
      snapshot,
      snapshotSha256: createHash("sha256").update(snapshot).digest("hex"),
      createdById: alice.user.id,
      sourceType: "MANUAL",
      sourceId: null,
      provenanceSourceIds: [],
    });

    const detail = await createJob("EDITOR_DOCUMENT", documentId);
    expect(detail.snapshot.segments).toHaveLength(1);
    expect(detail.snapshot.segments[0]?.kind).toBe("CAPTION");
    expect(detail.snapshot.segments[0]?.sourceText).toBe("Editor caption text");
  });

  it("reads a text adaptation job and refuses a non-text one", async () => {
    const batchId = `abatch-${Math.random().toString(36).slice(2, 10)}`;
    await orm.AdaptationBatch.create({
      id: batchId,
      projectId,
      requestedById: alice.user.id,
      sourceType: "WRITING_VARIANT",
      sourceId: "src",
      sourceSnapshot: "{}",
      sourceSha256: "0".repeat(64),
      targetCount: 1,
    });

    const textJobId = `ajob-text-${Math.random().toString(36).slice(2, 10)}`;
    await orm.AdaptationJob.create({
      id: textJobId,
      batchId,
      projectId,
      requestedById: alice.user.id,
      platformId: "linkedin",
      formatId: "post",
      kind: "COPY",
      recipe: "{}",
      recipeSha256: "0".repeat(64),
      outputText: "Adapted paragraph one.\n\nAdapted paragraph two.",
      outputMimeType: "text/plain",
    });

    const detail = await createJob("ADAPTATION_JOB", textJobId);
    expect(detail.snapshot.segments).toHaveLength(2);

    const imageJobId = `ajob-image-${Math.random().toString(36).slice(2, 10)}`;
    await orm.AdaptationJob.create({
      id: imageJobId,
      batchId,
      projectId,
      requestedById: alice.user.id,
      platformId: "linkedin",
      formatId: "square",
      kind: "IMAGE",
      recipe: "{}",
      recipeSha256: "0".repeat(64),
      outputText: null,
    });

    const response = await jobsRoute.POST!(
      post(`${BASE}/api/projects/${projectId}/localization`, cookieFor(alice.token), {
        sourceType: "ADAPTATION_JOB",
        sourceId: imageJobId,
        targetLocale: "pt-BR",
        strategy: "TRANSLATE",
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe(
      "SOURCE_NOT_FOUND",
    );
  });

  it("reads a campaign's brief fields", async () => {
    const created = await campaignsRoute.POST!(
      post(`${BASE}/api/projects/${projectId}/campaigns`, cookieFor(alice.token), {
        name: "Campaign headline",
        objective: "Drive sign-ups",
        audienceSummary: "Regulated teams",
        keyMessage: "Ship without a bottleneck",
        brief: { tone: "BRAND", launchWindow: { start: "2026-11-01T00:00:00.000Z", end: "2026-12-01T00:00:00.000Z" } },
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(created.status).toBe(201);
    const campaign = (await created.json()) as { campaign: { id: string } };

    const detail = await createJob("CAMPAIGN", campaign.campaign.id);
    const paths = detail.snapshot.segments.map((segment) => segment.path);
    expect(paths).toContain(`campaign:${campaign.campaign.id}:name`);
    expect(paths).toContain(`campaign:${campaign.campaign.id}:keyMessage`);
  });
});
