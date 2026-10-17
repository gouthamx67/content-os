import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import {
  BASE_URL,
  cleanupE2EUser,
  registerBrowserUser,
  SESSION_COOKIE,
  startStack,
  stopStack,
  type E2EStack,
  type RegisteredBrowserUser,
} from "./support/image-harness";
import type { MastodonStubController } from "./support/mastodon-stub";

/**
 * Real browser proof of CP23 analytics and optimization.
 *
 * Four posts are published through the stub provider over real HTTP; their
 * metric fixtures are read back by the worker, stored with provenance, and the
 * deterministic analyzer turns them into evidence-backed recommendations.
 * Missing metrics stay unavailable rather than zero, accepting a recommendation
 * creates a draft (never a publication), and dismissing one sticks while its
 * evidence is unchanged.
 */

type Services = typeof import("../../src/infrastructure/services");
type Orm = Awaited<ReturnType<typeof loadOrm>>["orm"];

async function loadOrm() {
  const dbModule = await import("../../src/prisma/db");
  return { orm: dbModule.db.orm.public };
}

type PublicationSnapshot = {
  id: string;
  status: string;
  externalPostId: string | null;
  recommendationId: string | null;
  originPublicationId: string | null;
};

type OverviewResponse = {
  publications: {
    publicationId: string;
    metrics: { metricKey: string; value: number; provenance: string }[];
    engagement: { value: number } | null;
  }[];
  totals: { publishedCount: number; measuredCount: number };
};

let stack: E2EStack;
let stub: MastodonStubController;
let services: Services;
let orm: Orm;
let user: RegisteredBrowserUser;
let browser: Browser;
let context: BrowserContext;
let projectId: string;
let email = "";

const publications: Record<"a" | "b" | "c" | "d", PublicationSnapshot> = {
  a: null as unknown as PublicationSnapshot,
  b: null as unknown as PublicationSnapshot,
  c: null as unknown as PublicationSnapshot,
  d: null as unknown as PublicationSnapshot,
};

async function createWritingDocument(content: string, title: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  const sha = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const id = `wdoc-${Math.random().toString(36).slice(2, 10)}`;

  await orm.WritingDocument.create({
    id,
    projectId,
    createdById: user.userId,
    title,
    blockType: "BODY",
    tone: "BRAND",
    length: "MEDIUM",
    objective: "AWARENESS",
    audience: null,
    language: "en",
    content,
    contentSha256: sha(content),
    contextSnapshot: "{}",
    contextSha256: sha("{}"),
    version: 1,
  });

  return id;
}

async function apiDetail(
  page: Page,
  publicationId: string,
): Promise<PublicationSnapshot> {
  const response = await page.request.get(
    `${BASE_URL}/api/projects/${projectId}/publishing/publications/${publicationId}`,
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { publication: PublicationSnapshot };
  return body.publication;
}

async function waitForStatus(
  page: Page,
  publicationId: string,
  expected: string[],
  timeoutMs = 30_000,
): Promise<PublicationSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let last: PublicationSnapshot | null = null;
  while (Date.now() < deadline) {
    const publication = await apiDetail(page, publicationId);
    last = publication;
    if (expected.includes(publication.status)) return publication;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `publication ${publicationId} stayed ${last?.status} instead of ${expected.join("|")}`,
  );
}

async function publishThroughWorker(
  page: Page,
  sourceId: string,
): Promise<PublicationSnapshot> {
  const connections = await page.request.get(
    `${BASE_URL}/api/projects/${projectId}/publishing/connections`,
  );
  const body = (await connections.json()) as {
    connections: { id: string; status: string }[];
  };
  const connected = body.connections.find((entry) => entry.status === "CONNECTED");
  if (!connected) throw new Error("no connected destination");

  const created = await page.request.post(
    `${BASE_URL}/api/projects/${projectId}/publishing/publications`,
    {
      data: {
        connectionId: connected.id,
        sourceType: "WRITING_DOCUMENT",
        sourceId,
      },
    },
  );
  expect(created.status()).toBe(201);
  const publication = ((await created.json()) as { publication: PublicationSnapshot })
    .publication;

  const validated = await page.request.post(
    `${BASE_URL}/api/projects/${projectId}/publishing/publications/${publication.id}/validate`,
    { data: {} },
  );
  expect(validated.status()).toBe(200);

  const queued = await page.request.post(
    `${BASE_URL}/api/projects/${projectId}/publishing/publications/${publication.id}/publish`,
    { data: {} },
  );
  expect(queued.status()).toBe(200);

  return waitForStatus(page, publication.id, ["PUBLISHED"]);
}

async function requestRefresh(page: Page, publicationId: string): Promise<void> {
  const response = await page.request.post(
    `${BASE_URL}/api/projects/${projectId}/analytics/publications/${publicationId}/refresh`,
    { data: {} },
  );
  expect(response.ok()).toBe(true);
}

async function overview(page: Page): Promise<OverviewResponse> {
  const response = await page.request.get(
    `${BASE_URL}/api/projects/${projectId}/analytics`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as OverviewResponse;
}

beforeAll(async () => {
  stack = await startStack({ withPublishingWorker: true });
  if (!stack.reachable || !stack.available || !stack.mastodonStub) return;

  stub = stack.mastodonStub;
  stub.reset();

  services = await import("../../src/infrastructure/services");
  ({ orm } = await loadOrm());

  email = `cp23-analytics-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);

  const project = await services.projectService.createForWorkspace(
    user.workspaceId,
    { name: "CP23 analytics" },
    user.userId,
  );
  projectId = project.id;

  browser = await chromium.launch({
    executablePath: stack.executablePath,
    args: ["--no-sandbox"],
  });
  context = await browser.newContext();
  await context.addCookies([
    { name: SESSION_COOKIE, value: user.cookieValue, url: BASE_URL },
  ]);

  const setup = await context.newPage();
  await setup.goto(`${BASE_URL}/projects/${projectId}/publishing`, {
    waitUntil: "domcontentloaded",
  });

  const started = await setup.request.post(
    `${BASE_URL}/api/projects/${projectId}/publishing/connections`,
    { data: { providerId: "mastodon" } },
  );
  expect(started.status()).toBe(201);
  const authorizationUrl = ((await started.json()) as { authorizationUrl: string })
    .authorizationUrl;
  const completed = await setup.request.get(authorizationUrl);
  expect(completed.ok()).toBe(true);

  publications.a = await publishThroughWorker(
    setup,
    await createWritingDocument("Wednesday morning launch note.", "Metrics headline A"),
  );
  publications.b = await publishThroughWorker(
    setup,
    await createWritingDocument("Wednesday noon follow-up note.", "Metrics headline B"),
  );
  publications.c = await publishThroughWorker(
    setup,
    await createWritingDocument("Evening recap for the team.", "Metrics headline C"),
  );
  publications.d = await publishThroughWorker(
    setup,
    await createWritingDocument("Partial reading note.", "Metrics headline D"),
  );

  // Deterministic fixture times: A and B share the 14:00 UTC window, C is alone
  // at 20:00. The analyzer runs over these stored instants, not over wall clock.
  await orm.Publication.where({ id: publications.a.id }).update({
    publishedAt: "2026-10-17T14:00:00.000Z",
  });
  await orm.Publication.where({ id: publications.b.id }).update({
    publishedAt: "2026-10-17T14:10:00.000Z",
  });
  await orm.Publication.where({ id: publications.c.id }).update({
    publishedAt: "2026-10-17T20:00:00.000Z",
  });

  stub.setMetricsFor(publications.a.externalPostId!, {
    favourites: 15,
    reblogs: 0,
    replies: 0,
  });
  stub.setMetricsFor(publications.b.externalPostId!, {
    favourites: 1,
    reblogs: 1,
    replies: 0,
  });
  stub.setMetricsFor(publications.c.externalPostId!, {
    favourites: 1,
    reblogs: 0,
    replies: 1,
  });
  stub.setMetricsFor(publications.d.externalPostId!, { reblogs: 2 });

  await requestRefresh(setup, publications.a.id);
  await requestRefresh(setup, publications.b.id);
  await requestRefresh(setup, publications.c.id);
  await requestRefresh(setup, publications.d.id);

  const deadline = Date.now() + 60_000;
  for (;;) {
    const current = await overview(setup);
    const a = current.publications.find(
      (entry) => entry.publicationId === publications.a.id,
    );
    const d = current.publications.find(
      (entry) => entry.publicationId === publications.d.id,
    );
    if (
      a?.metrics.some((metric) => metric.metricKey === "favourites") &&
      d?.metrics.some((metric) => metric.metricKey === "reblogs")
    ) {
      break;
    }
    if (Date.now() > deadline) {
      throw new Error("analytics snapshots were not collected in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  await setup.close();
});

afterAll(async () => {
  if (browser) await browser.close();
  if (user) {
    await cleanupE2EUser(email, user.workspaceId, [projectId]).catch(
      () => undefined,
    );
  }
  if (stack) stopStack(stack);
  if (stub) stub.reset();
});

describe("CP23 analytics", () => {
  it("shows collected metrics with provenance and keeps missing metrics unavailable", async () => {
    if (!stack.reachable || !stack.available) return;

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${projectId}/analytics`, {
      waitUntil: "domcontentloaded",
    });

    const rowA = page.locator(
      `[data-testid="analytics-row"][data-publication-id="${publications.a.id}"]`,
    );
    await expect
      .poll(
        async () => {
          await page.getByTestId("analytics-reload").click();
          return rowA.locator('[data-metric="favourites"]').count();
        },
        { timeout: 30_000, interval: 2_000 },
      )
      .toBe(1);

    const metricA = await rowA.locator('[data-metric="favourites"]').textContent();
    expect(metricA).toContain("15");
    expect(metricA).toContain("PROVIDER_API");
    expect(metricA).toContain("collected 20");
    expect(await rowA.getByTestId("analytics-engagement").textContent()).toContain(
      "Engagement 15",
    );

    const rowD = page.locator(
      `[data-testid="analytics-row"][data-publication-id="${publications.d.id}"]`,
    );
    expect(await rowD.locator('[data-metric="reblogs"]').count()).toBe(1);
    expect(await rowD.locator('[data-metric="favourites"]').count()).toBe(0);
    expect(await rowD.locator('[data-metric="replies"]').count()).toBe(0);
    expect(
      await rowD.getByTestId("analytics-engagement-unavailable").count(),
    ).toBe(1);

    const stored = await orm.AnalyticsSnapshot.where({
      publicationId: publications.d.id,
    }).all();
    expect(stored.map((snapshot) => snapshot.metricKey).sort()).toEqual([
      "reblogs",
    ]);
    expect(stub.metricReads).toBeGreaterThanOrEqual(4);

    await page.close();
  });

  it("generates evidence-backed recommendations and accepts one into a draft only", async () => {
    if (!stack.reachable || !stack.available) return;

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${projectId}/analytics`, {
      waitUntil: "domcontentloaded",
    });

    const statusesBefore = stub.publishedStatusIds().length;

    await page.getByTestId("recommendations-generate").click();
    await expect
      .poll(
        async () => page.getByTestId("analytics-info").textContent(),
        { timeout: 15_000 },
      )
      .toContain("Analyzed 3 measured posts");

    const outlierCard = page.locator(
      '[data-testid="recommendation-card"][data-category="PERFORMANCE_OUTLIER"]',
    );
    await outlierCard.waitFor({ state: "visible" });
    const evidence = (await outlierCard.getByTestId("recommendation-evidence").textContent()) ?? "";
    expect(evidence).toContain("observed 15");
    expect(evidence).toContain("sample 3");
    expect(evidence).toContain(publications.a.id);

    await outlierCard.getByTestId("recommendation-accept").click();
    await expect
      .poll(
        async () => page.getByTestId("analytics-info").textContent(),
        { timeout: 15_000 },
      )
      .toContain("A new draft was created");
    await expect
      .poll(
        async () => outlierCard.getByTestId("recommendation-result").count(),
        { timeout: 15_000 },
      )
      .toBe(1);

    const recommendations = await page.request.get(
      `${BASE_URL}/api/projects/${projectId}/optimization/recommendations`,
    );
    const recommendationBody = (await recommendations.json()) as {
      recommendations: {
        id: string;
        category: string;
        status: string;
        resultPublicationId: string | null;
      }[];
    };
    const accepted = recommendationBody.recommendations.find(
      (entry) => entry.category === "PERFORMANCE_OUTLIER",
    )!;
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.resultPublicationId).toBeTruthy();

    const publicationList = await page.request.get(
      `${BASE_URL}/api/projects/${projectId}/publishing/publications`,
    );
    const publicationBody = (await publicationList.json()) as {
      publications: PublicationSnapshot[];
    };
    const draft = publicationBody.publications.find(
      (entry) => entry.id === accepted.resultPublicationId,
    )!;
    expect(draft.status).toBe("DRAFT");
    expect(draft.recommendationId).toBe(accepted.id);
    expect(draft.originPublicationId).toBe(publications.a.id);

    expect(stub.publishedStatusIds().length).toBe(statusesBefore);

    await page.goto(`${BASE_URL}/projects/${projectId}/publishing`, {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(
        async () =>
          page
            .locator(
              `[data-testid="publishing-row"][data-publication-id="${draft.id}"][data-status="DRAFT"]`,
            )
            .count(),
        { timeout: 15_000 },
      )
      .toBe(1);

    await page.close();
  });

  it("keeps a dismissed recommendation dismissed while its evidence is unchanged", async () => {
    if (!stack.reachable || !stack.available) return;

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${projectId}/analytics`, {
      waitUntil: "domcontentloaded",
    });

    const timingCard = page.locator(
      '[data-testid="recommendation-card"][data-category="TIMING_WINDOW"]',
    );
    await timingCard.waitFor({ state: "visible" });
    await timingCard.getByTestId("recommendation-dismiss").click();
    await expect
      .poll(async () => timingCard.getAttribute("data-status"), {
        timeout: 15_000,
      })
      .toBe("DISMISSED");

    await page.getByTestId("recommendations-generate").click();
    await expect
      .poll(
        async () => page.getByTestId("analytics-info").textContent(),
        { timeout: 15_000 },
      )
      .toContain("0 new, 0 revived");

    const timingAfter = page.locator(
      '[data-testid="recommendation-card"][data-category="TIMING_WINDOW"]',
    );
    expect(await timingAfter.getAttribute("data-status")).toBe("DISMISSED");
    expect(await timingAfter.getByTestId("recommendation-accept").count()).toBe(0);

    await page.close();
  });
});
