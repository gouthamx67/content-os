import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASE,
  cleanupOwner,
  cleanupProject,
  cookieFor,
  createProject,
  createWritingDocument,
  loadCampaignTestContext,
  registerUser,
  request,
  type Orm,
  type Owner,
  type Services,
} from "./helpers";

/**
 * HTTP-boundary proof for the campaign API.
 *
 * The domain suite proves the engine's rules in isolation; this suite proves the
 * *routes* apply them: a session is required, a stranger cannot reach a project,
 * cross-origin writes are refused, a stale revision is a structured conflict, an
 * artifact from another project cannot be linked, approval is dropped by a later
 * material change, and a launch kit only leaves the building once it is frozen.
 * Each handler is invoked exactly as Next invokes it.
 */

type IdCtx = { id: string };
type CampaignCtx = { id: string; campaignId: string };
type DeliverableCtx = { id: string; campaignId: string; deliverableId: string };

type Handler<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;
type Route<P> = {
  GET?: Handler<P>;
  POST?: Handler<P>;
  PATCH?: Handler<P>;
  DELETE?: Handler<P>;
};

type CampaignDetail = {
  campaign: {
    id: string;
    status: string;
    revisionNumber: number;
    approvalHash: string | null;
    strategy: unknown;
    plan: unknown;
  };
  deliverables: Array<{ id: string; title: string; status: string }>;
};

let services: Services;
let orm: Orm;

let listRoute: Route<IdCtx>;
let detailRoute: Route<CampaignCtx>;
let planRoute: Route<CampaignCtx>;
let proposeRoute: Route<CampaignCtx>;
let deliverablesRoute: Route<CampaignCtx>;
let deliverableRoute: Route<DeliverableCtx>;
let readinessRoute: Route<CampaignCtx>;
let reviewRoute: Route<CampaignCtx>;
let approveRoute: Route<CampaignCtx>;
let returnRoute: Route<CampaignCtx>;
let scheduleRoute: Route<CampaignCtx>;
let assembleRoute: Route<CampaignCtx>;
let exportRoute: Route<CampaignCtx>;
let historyRoute: Route<CampaignCtx>;

let alice: Owner;
let bob: Owner;
let aliceProjectId = "";
let aliceOtherProjectId = "";
let bobProjectId = "";

const WINDOW = {
  start: "2026-11-01T00:00:00.000Z",
  end: "2026-12-01T00:00:00.000Z",
};
const WITHIN_WINDOW = "2026-11-15T12:00:00.000Z";

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function body(
  init: RequestInit & { origin?: string; cookie?: string } = {},
): RequestInit & { origin?: string; cookie?: string } {
  return { origin: BASE, ...init };
}

async function createCampaign(
  projectId: string,
  owner: Owner,
  name = "Launch",
): Promise<CampaignDetail> {
  const response = await listRoute.POST!(
    request(`${BASE}/api/projects/${projectId}/campaigns`, body({
      method: "POST",
      headers: { "content-type": "application/json" },
      cookie: cookieFor(owner.token),
      body: JSON.stringify({
        name,
        objective: "Drive sign-ups",
        audienceSummary: "Regulated product teams",
        keyMessage: "Ship content without a legal bottleneck",
        brief: { tone: "BRAND", launchWindow: WINDOW },
      }),
    })),
    { params: Promise.resolve({ id: projectId }) },
  );
  expect(response.status).toBe(201);
  return json<CampaignDetail>(response);
}

beforeAll(async () => {
  const loaded = await loadCampaignTestContext();
  services = loaded.services;
  orm = loaded.orm;

  listRoute = (await import(
    "../../../app/api/projects/[id]/campaigns/route"
  )) as unknown as Route<IdCtx>;
  detailRoute = (await import(
    "../../../app/api/projects/[id]/campaigns/[campaignId]/route"
  )) as unknown as Route<CampaignCtx>;
  planRoute = (await import(
    "../../../app/api/projects/[id]/campaigns/[campaignId]/plan/route"
  )) as unknown as Route<CampaignCtx>;
  proposeRoute = (await import(
    "../../../app/api/projects/[id]/campaigns/[campaignId]/propose/route"
  )) as unknown as Route<CampaignCtx>;
  deliverablesRoute = (await import(
    "../../../app/api/projects/[id]/campaigns/[campaignId]/deliverables/route"
  )) as unknown as Route<CampaignCtx>;
  deliverableRoute = (await import(
    "../../../app/api/projects/[id]/campaigns/[campaignId]/deliverables/[deliverableId]/route"
  )) as unknown as Route<DeliverableCtx>;
  readinessRoute = (await import(
    "../../../app/api/projects/[id]/campaigns/[campaignId]/readiness/route"
  )) as unknown as Route<CampaignCtx>;
  reviewRoute = (await import(
    "../../../app/api/projects/[id]/campaigns/[campaignId]/review/route"
  )) as unknown as Route<CampaignCtx>;
  approveRoute = (await import(
    "../../../app/api/projects/[id]/campaigns/[campaignId]/approve/route"
  )) as unknown as Route<CampaignCtx>;
  returnRoute = (await import(
    "../../../app/api/projects/[id]/campaigns/[campaignId]/return/route"
  )) as unknown as Route<CampaignCtx>;
  scheduleRoute = (await import(
    "../../../app/api/projects/[id]/campaigns/[campaignId]/schedule/route"
  )) as unknown as Route<CampaignCtx>;
  assembleRoute = (await import(
    "../../../app/api/projects/[id]/campaigns/[campaignId]/assemble/route"
  )) as unknown as Route<CampaignCtx>;
  exportRoute = (await import(
    "../../../app/api/projects/[id]/campaigns/[campaignId]/export/route"
  )) as unknown as Route<CampaignCtx>;
  historyRoute = (await import(
    "../../../app/api/projects/[id]/campaigns/[campaignId]/history/route"
  )) as unknown as Route<CampaignCtx>;

  alice = await registerUser(services, "cp21-http-alice");
  bob = await registerUser(services, "cp21-http-bob");

  aliceProjectId = await createProject(services, alice, "Alice campaign");
  aliceOtherProjectId = await createProject(services, alice, "Alice other");
  bobProjectId = await createProject(services, bob, "Bob campaign");
});

afterAll(async () => {
  if (orm) {
    await cleanupProject(orm, alice, aliceProjectId);
    await cleanupProject(orm, alice, aliceOtherProjectId);
    await cleanupProject(orm, bob, bobProjectId);
    await cleanupOwner(orm, alice);
    await cleanupOwner(orm, bob);
  }
});

describe("campaign API — access control", () => {
  it("requires a session to list campaigns", async () => {
    const response = await listRoute.GET!(
      request(`${BASE}/api/projects/${aliceProjectId}/campaigns`),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(401);
  });

  it("refuses a cross-origin write", async () => {
    const response = await listRoute.POST!(
      request(`${BASE}/api/projects/${aliceProjectId}/campaigns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie: cookieFor(alice.token),
        origin: "http://evil.example",
        body: JSON.stringify({
          name: "Injected",
          objective: "x",
          audienceSummary: "x",
          keyMessage: "x",
        }),
      }),
      { params: Promise.resolve({ id: aliceProjectId }) },
    );
    expect(response.status).toBe(403);
  });

  it("hides a project the caller is not a member of", async () => {
    const detail = await createCampaign(bobProjectId, bob, "Bob launch");
    const response = await detailRoute.GET!(
      request(`${BASE}/api/projects/${bobProjectId}/campaigns/${detail.campaign.id}`, {
        cookie: cookieFor(alice.token),
      }),
      { params: Promise.resolve({ id: bobProjectId, campaignId: detail.campaign.id }) },
    );
    expect([403, 404]).toContain(response.status);
  });
});

describe("campaign API — planning and lifecycle", () => {
  it("creates, plans, reviews, approves, assembles and exports a campaign", async () => {
    const created = await createCampaign(aliceProjectId, alice, "Full path");
    const campaignId = created.campaign.id;
    const ctx = { params: Promise.resolve({ id: aliceProjectId, campaignId }) };
    const cookie = cookieFor(alice.token);

    expect(created.campaign.status).toBe("DRAFT");

    // A fresh draft is not ready: no strategy, no plan.
    const blockedReadiness = await readinessRoute.POST!(
      request(`${BASE}/_`, { method: "POST", cookie }),
      ctx,
    );
    const readiness0 = await json<{ ready: boolean; checks: Array<{ code: string }> }>(
      blockedReadiness,
    );
    expect(readiness0.ready).toBe(false);
    expect(readiness0.checks.map((c) => c.code)).toContain("STRATEGY_MISSING");
    expect(readiness0.checks.map((c) => c.code)).toContain("PLAN_MISSING");

    // A draft cannot be submitted at all: the lifecycle refuses before the
    // readiness gate is even consulted.
    const earlyReview = await reviewRoute.POST!(
      request(`${BASE}/_`, body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie,
        body: JSON.stringify({ expectedRevisionNumber: created.campaign.revisionNumber }),
      })),
      ctx,
    );
    expect(earlyReview.status).toBe(409);
    expect((await json<{ code: string }>(earlyReview)).code).toBe(
      "CAMPAIGN_INVALID_LIFECYCLE_TRANSITION",
    );

    // The deterministic planner produces the strategy and plan in one write.
    const planned = await planRoute.POST!(
      request(`${BASE}/_`, body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie,
        body: JSON.stringify({ expectedRevisionNumber: created.campaign.revisionNumber }),
      })),
      ctx,
    );
    expect(planned.status).toBe(200);
    const plannedDetail = await json<CampaignDetail>(planned);
    expect(plannedDetail.campaign.status).toBe("PLANNED");
    expect(plannedDetail.campaign.strategy).toBeTruthy();
    expect(plannedDetail.deliverables.length).toBeGreaterThan(0);

    // Schedule a deliverable inside the window.
    const target = plannedDetail.deliverables[0]!;
    const scheduled = await scheduleRoute.POST!(
      request(`${BASE}/_`, body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie,
        body: JSON.stringify({
          expectedRevisionNumber: plannedDetail.campaign.revisionNumber,
          entries: [{ deliverableId: target.id, scheduledFor: WITHIN_WINDOW }],
        }),
      })),
      ctx,
    );
    expect(scheduled.status).toBe(200);
    const scheduledDetail = await json<CampaignDetail>(scheduled);

    const review = await reviewRoute.POST!(
      request(`${BASE}/_`, body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie,
        body: JSON.stringify({
          expectedRevisionNumber: scheduledDetail.campaign.revisionNumber,
        }),
      })),
      ctx,
    );
    expect(review.status).toBe(200);
    const reviewed = await json<CampaignDetail>(review);
    expect(reviewed.campaign.status).toBe("IN_REVIEW");

    const approvedReal = await approveRoute.POST!(
      request(`${BASE}/_`, body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie,
        body: JSON.stringify({
          expectedRevisionNumber: reviewed.campaign.revisionNumber,
        }),
      })),
      ctx,
    );
    expect(approvedReal.status).toBe(200);
    const approvedDetail = await json<CampaignDetail>(approvedReal);
    expect(approvedDetail.campaign.status).toBe("APPROVED");
    expect(approvedDetail.campaign.approvalHash).toBeTruthy();

    // Export before assembly is a structured refusal, not an empty file.
    const earlyExport = await exportRoute.GET!(
      request(`${BASE}/_`, { cookie }),
      ctx,
    );
    expect(earlyExport.status).toBe(409);
    expect((await json<{ code: string }>(earlyExport)).code).toBe(
      "CAMPAIGN_LAUNCH_KIT_NOT_ASSEMBLED",
    );

    const assembled = await assembleRoute.POST!(
      request(`${BASE}/_`, body({ method: "POST", cookie })),
      ctx,
    );
    expect(assembled.status).toBe(200);
    const kit = await json<{ hash: string; kit: { deliverables: unknown[] } }>(assembled);
    expect(kit.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(kit.kit.deliverables.length).toBe(plannedDetail.deliverables.length);

    const exported = await exportRoute.GET!(
      request(`${BASE}/_`, { cookie }),
      ctx,
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-disposition")).toContain("attachment");
    const document = await json<{
      schema: string;
      version: number;
      launchKit: { campaign: { id: string }; deliverables: unknown[] };
    }>(exported);
    expect(document.schema).toBe("content-os.campaign-launch-kit");
    expect(document.version).toBe(1);
    expect(document.launchKit.campaign.id).toBe(campaignId);

    const history = await historyRoute.GET!(
      request(`${BASE}/_/history`, { cookie }),
      ctx,
    );
    expect(history.status).toBe(200);
    const historyBody = await json<{ total: number; revisions: Array<{ kind: string }> }>(
      history,
    );
    expect(historyBody.total).toBeGreaterThanOrEqual(5);
    expect(historyBody.revisions.map((r) => r.kind)).toContain("APPROVED");
    expect(historyBody.revisions.map((r) => r.kind)).toContain("ASSEMBLED");
  });

  it("drops approval when the campaign is edited after approval", async () => {
    const created = await createCampaign(aliceProjectId, alice, "Invalidate");
    const campaignId = created.campaign.id;
    const ctx = { params: Promise.resolve({ id: aliceProjectId, campaignId }) };
    const cookie = cookieFor(alice.token);

    const planned = await planRoute.POST!(
      request(`${BASE}/_`, body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie,
        body: JSON.stringify({ expectedRevisionNumber: created.campaign.revisionNumber }),
      })),
      ctx,
    );
    const plannedDetail = await json<CampaignDetail>(planned);

    await reviewRoute.POST!(
      request(`${BASE}/_`, body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie,
        body: JSON.stringify({ expectedRevisionNumber: plannedDetail.campaign.revisionNumber }),
      })),
      ctx,
    );

    const approved = await approveRoute.POST!(
      request(`${BASE}/_`, body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie,
        body: JSON.stringify({ expectedRevisionNumber: plannedDetail.campaign.revisionNumber + 1 }),
      })),
      ctx,
    );
    const approvedDetail = await json<CampaignDetail>(approved);
    expect(approvedDetail.campaign.status).toBe("APPROVED");

    const edited = await detailRoute.PATCH!(
      request(`${BASE}/_`, body({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        cookie,
        body: JSON.stringify({
          expectedRevisionNumber: approvedDetail.campaign.revisionNumber,
          keyMessage: "A materially different promise",
        }),
      })),
      ctx,
    );
    expect(edited.status).toBe(200);
    const editedDetail = await json<CampaignDetail>(edited);
    expect(editedDetail.campaign.status).toBe("PLANNED");
    expect(editedDetail.campaign.approvalHash).toBeNull();
  });

  it("rejects a stale revision with a structured conflict", async () => {
    const created = await createCampaign(aliceProjectId, alice, "Stale");
    const campaignId = created.campaign.id;
    const response = await detailRoute.PATCH!(
      request(`${BASE}/_`, body({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        cookie: cookieFor(alice.token),
        body: JSON.stringify({ expectedRevisionNumber: 999, keyMessage: "stale" }),
      })),
      { params: Promise.resolve({ id: aliceProjectId, campaignId }) },
    );
    expect(response.status).toBe(409);
    expect((await json<{ code: string }>(response)).code).toBe(
      "CAMPAIGN_REVISION_CONFLICT",
    );
  });

  it("returns an in-review campaign to planning", async () => {
    const created = await createCampaign(aliceProjectId, alice, "Send back");
    const campaignId = created.campaign.id;
    const ctx = { params: Promise.resolve({ id: aliceProjectId, campaignId }) };
    const cookie = cookieFor(alice.token);

    const planned = await planRoute.POST!(
      request(`${BASE}/_`, body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie,
        body: JSON.stringify({ expectedRevisionNumber: created.campaign.revisionNumber }),
      })),
      ctx,
    );
    const plannedDetail = await json<CampaignDetail>(planned);

    const review = await reviewRoute.POST!(
      request(`${BASE}/_`, body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie,
        body: JSON.stringify({
          expectedRevisionNumber: plannedDetail.campaign.revisionNumber,
        }),
      })),
      ctx,
    );
    const reviewed = await json<CampaignDetail>(review);
    expect(reviewed.campaign.status).toBe("IN_REVIEW");

    const returned = await returnRoute.POST!(
      request(`${BASE}/_`, body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie,
        body: JSON.stringify({
          expectedRevisionNumber: reviewed.campaign.revisionNumber,
        }),
      })),
      ctx,
    );
    expect(returned.status).toBe(200);
    const returnedDetail = await json<CampaignDetail>(returned);
    expect(returnedDetail.campaign.status).toBe("PLANNED");
  });

  it("refuses review while a blocking finding remains", async () => {
    const created = await createCampaign(aliceProjectId, alice, "Blocked");
    const campaignId = created.campaign.id;
    const ctx = { params: Promise.resolve({ id: aliceProjectId, campaignId }) };
    const cookie = cookieFor(alice.token);

    const planned = await planRoute.POST!(
      request(`${BASE}/_`, body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie,
        body: JSON.stringify({ expectedRevisionNumber: created.campaign.revisionNumber }),
      })),
      ctx,
    );
    expect(planned.status).toBe(200);
    const plannedDetail = await json<CampaignDetail>(planned);

    const blocked = await deliverableRoute.PATCH!(
      request(`${BASE}/_`, body({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        cookie,
        body: JSON.stringify({
          expectedRevisionNumber: plannedDetail.campaign.revisionNumber,
          status: "BLOCKED",
        }),
      })),
      {
        params: Promise.resolve({
          id: aliceProjectId,
          campaignId,
          deliverableId: plannedDetail.deliverables[0].id,
        }),
      },
    );
    expect(blocked.status).toBe(200);
    const blockedDetail = await json<CampaignDetail>(blocked);

    const review = await reviewRoute.POST!(
      request(`${BASE}/_`, body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie,
        body: JSON.stringify({
          expectedRevisionNumber: blockedDetail.campaign.revisionNumber,
        }),
      })),
      ctx,
    );
    expect(review.status).toBe(409);
    expect((await json<{ code: string }>(review)).code).toBe("CAMPAIGN_NOT_READY");
  });
});

describe("campaign API — cross-project artifacts", () => {
  it("refuses to link a writing document owned by another project", async () => {
    const foreignDoc = await createWritingDocument(orm, {
      projectId: aliceOtherProjectId,
      userId: alice.user.id,
    });
    const created = await createCampaign(aliceProjectId, alice, "Cross link");
    const campaignId = created.campaign.id;

    const response = await deliverablesRoute.POST!(
      request(`${BASE}/_`, body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie: cookieFor(alice.token),
        body: JSON.stringify({
          expectedRevisionNumber: created.campaign.revisionNumber,
          title: "Linked post",
          platformId: "linkedin",
          channel: "TEXT",
          brief: { objective: "Reach", keyMessage: "One claim" },
          links: { writingDocumentId: foreignDoc },
        }),
      })),
      { params: Promise.resolve({ id: aliceProjectId, campaignId }) },
    );

    expect(response.status).toBe(403);
    expect((await json<{ code: string }>(response)).code).toBe(
      "CAMPAIGN_CROSS_PROJECT_ARTIFACT",
    );
  });

  it("previews a proposal without persisting it", async () => {
    const created = await createCampaign(aliceProjectId, alice, "Preview");
    const campaignId = created.campaign.id;
    const ctx = { params: Promise.resolve({ id: aliceProjectId, campaignId }) };

    const preview = await proposeRoute.POST!(
      request(`${BASE}/_`, body({
        method: "POST",
        headers: { "content-type": "application/json" },
        cookie: cookieFor(alice.token),
        body: JSON.stringify({}),
      })),
      ctx,
    );
    expect(preview.status).toBe(200);
    const proposal = await json<{ plan: { deliverables: unknown[] } }>(preview);
    expect(proposal.plan.deliverables.length).toBeGreaterThan(0);

    const after = await detailRoute.GET!(
      request(`${BASE}/_`, { cookie: cookieFor(alice.token) }),
      ctx,
    );
    const detail = await json<CampaignDetail>(after);
    expect(detail.campaign.status).toBe("DRAFT");
    expect(detail.campaign.plan).toBeNull();
    expect(detail.deliverables.length).toBe(0);
  });
});
