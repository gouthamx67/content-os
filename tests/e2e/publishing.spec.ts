import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import {
  BASE_URL,
  cleanupE2EUser,
  registerBrowserUser,
  SESSION_COOKIE,
  spawnPublishingWorker,
  startStack,
  stopPublishingWorker,
  stopStack,
  type E2EStack,
  type RegisteredBrowserUser,
} from "./support/image-harness";
import type { MastodonStubController } from "./support/mastodon-stub";

/**
 * Real browser proof of CP23 publishing.
 *
 * The server and the publishing worker talk to the clearly-labeled stub
 * Mastodon (see mastodon-stub.ts) over real HTTP, so this spec covers the
 * whole boundary: the OAuth redirect, a confirmed status POST with its
 * Idempotency-Key, a provider rejection that stays visible, an ambiguous
 * attempt that reconciles onto the same post, and an edit that turns a queued
 * publication stale before any provider call is made.
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
  externalUrl: string | null;
  lastErrorCode: string | null;
  attemptedCount: number;
  idempotencyKey: string;
};

let stack: E2EStack;
let stub: MastodonStubController;
let services: Services;
let orm: Orm;
let user: RegisteredBrowserUser;
let browser: Browser;
let context: BrowserContext;
let projectId: string;
let otherProjectId: string;
let firstDocumentId: string;
let retryDocumentId: string;
let reconcileDocumentId: string;
let staleDocumentId: string;
let email = "";

const FIRST_CONTENT = "The first launch post from the writing engine.";

async function createWritingDocument(args: {
  content: string;
  title: string;
  version?: number;
}): Promise<string> {
  const { createHash } = await import("node:crypto");
  const sha = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const id = `wdoc-${Math.random().toString(36).slice(2, 10)}`;

  await orm.WritingDocument.create({
    id,
    projectId,
    createdById: user.userId,
    title: args.title,
    blockType: "BODY",
    tone: "BRAND",
    length: "MEDIUM",
    objective: "AWARENESS",
    audience: null,
    language: "en",
    content: args.content,
    contentSha256: sha(args.content),
    contextSnapshot: "{}",
    contextSha256: sha("{}"),
    version: args.version ?? 1,
  });

  return id;
}

async function connectionId(): Promise<string> {
  const response = await fetch(
    `${BASE_URL}/api/projects/${projectId}/publishing/connections`,
    { headers: { cookie: `${SESSION_COOKIE}=${user.cookieValue}` } },
  );
  const body = (await response.json()) as {
    connections: { id: string; status: string }[];
  };
  const connected = body.connections.find((entry) => entry.status === "CONNECTED");
  if (!connected) throw new Error("no connected destination");
  return connected.id;
}

async function apiPublication(page: Page, sourceId: string): Promise<PublicationSnapshot> {
  const response = await page.request.post(
    `${BASE_URL}/api/projects/${projectId}/publishing/publications`,
    {
      data: {
        connectionId: await connectionId(),
        sourceType: "WRITING_DOCUMENT",
        sourceId,
      },
    },
  );
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { publication: PublicationSnapshot };
  return body.publication;
}

async function createValidated(
  page: Page,
  sourceId: string,
): Promise<PublicationSnapshot> {
  const publication = await apiPublication(page, sourceId);
  const validated = await page.request.post(
    `${BASE_URL}/api/projects/${projectId}/publishing/publications/${publication.id}/validate`,
    { data: {} },
  );
  expect(validated.status()).toBe(200);
  return publication;
}

async function apiDetail(
  page: Page,
  publicationId: string,
): Promise<{ publication: PublicationSnapshot; attempts: unknown[] }> {
  const response = await page.request.get(
    `${BASE_URL}/api/projects/${projectId}/publishing/publications/${publicationId}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    publication: PublicationSnapshot;
    attempts: unknown[];
  };
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
    const { publication } = await apiDetail(page, publicationId);
    last = publication;
    if (expected.includes(publication.status)) return publication;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `publication ${publicationId} stayed ${last?.status} (${last?.lastErrorCode}) instead of ${expected.join("|")}`,
  );
}

beforeAll(async () => {
  stack = await startStack({ withPublishingWorker: true });
  if (!stack.reachable || !stack.available || !stack.mastodonStub) return;

  stub = stack.mastodonStub;
  stub.reset();

  services = await import("../../src/infrastructure/services");
  ({ orm } = await loadOrm());

  email = `cp23-publishing-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);

  const project = await services.projectService.createForWorkspace(
    user.workspaceId,
    { name: "CP23 publishing" },
    user.userId,
  );
  projectId = project.id;

  const other = await services.projectService.createForWorkspace(
    user.workspaceId,
    { name: "CP23 other project" },
    user.userId,
  );
  otherProjectId = other.id;

  firstDocumentId = await createWritingDocument({
    content: FIRST_CONTENT,
    title: "Publishing headline one",
  });
  retryDocumentId = await createWritingDocument({
    content: "This post will be rejected once, then retried.",
    title: "Publishing headline retry",
  });
  reconcileDocumentId = await createWritingDocument({
    content: "This post reaches the provider but loses its response.",
    title: "Publishing headline reconcile",
  });
  staleDocumentId = await createWritingDocument({
    content: "This post will be edited after it is queued.",
    title: "Publishing headline stale",
  });

  browser = await chromium.launch({
    executablePath: stack.executablePath,
    args: ["--no-sandbox"],
  });
  context = await browser.newContext();
  await context.addCookies([
    { name: SESSION_COOKIE, value: user.cookieValue, url: BASE_URL },
  ]);
});

afterAll(async () => {
  if (browser) await browser.close();
  if (user) {
    await cleanupE2EUser(email, user.workspaceId, [
      projectId,
      otherProjectId,
    ]).catch(() => undefined);
  }
  if (stack) await stopStack(stack);
  if (stub) stub.reset();
});

describe("CP23 publishing", () => {
  it("connects through the real OAuth round trip and confirms a provider post", async () => {
    if (!stack.reachable || !stack.available) return;

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${projectId}/publishing`, {
      waitUntil: "domcontentloaded",
    });

    expect(await page.getByTestId("publishing-secrets-warning").count()).toBe(0);
    await page.getByTestId("connect-mastodon").waitFor({ state: "visible" });
    await page.getByTestId("connect-mastodon").click();

    await page.waitForURL(
      new RegExp(`/projects/${projectId}/publishing\\?connected=1`),
      { timeout: 30_000 },
    );
    await page.getByTestId("publishing-notice").waitFor({ state: "visible" });
    await expect
      .poll(
        async () =>
          page
            .locator('[data-testid="connection-row"][data-status="CONNECTED"]')
            .count(),
        { timeout: 15_000 },
      )
      .toBe(1);
    expect(stub.tokenExchanges).toBe(1);
    expect(stub.credentialChecks).toBeGreaterThanOrEqual(1);

    await page
      .getByTestId("publication-source")
      .selectOption({ label: "Publishing headline one" });
    await page.getByTestId("publication-create").click();
    await page.getByTestId("publication-detail").waitFor({ state: "visible" });
    const publicationId = await page
      .locator('[data-testid="publishing-row"][data-status="DRAFT"]')
      .first()
      .getAttribute("data-publication-id");
    if (!publicationId) throw new Error("no publication id in the list");

    await expect
      .poll(async () => page.getByTestId("publication-status").textContent())
      .toContain("DRAFT");

    await page.getByTestId("publication-validate").click();
    await expect
      .poll(
        async () => page.getByTestId("publication-status").textContent(),
        { timeout: 15_000 },
      )
      .toContain("READY");
    const findings = (await page.getByTestId("publication-findings").textContent()) ?? "";
    expect(findings).toContain("SOURCE_GROUNDING_NOT_EVALUATED");

    await page.getByTestId("publication-publish").click();
    await expect
      .poll(
        async () => page.getByTestId("publication-status").textContent(),
        { timeout: 30_000 },
      )
      .toContain("PUBLISHED");

    const externalUrl = await page
      .getByTestId("publication-external-url")
      .getAttribute("href");
    expect(externalUrl).toContain("/@contentos_e2e/e2e-post-");
    await expect
      .poll(
        async () => page.getByTestId("publication-attempts").textContent(),
        { timeout: 15_000 },
      )
      .toContain("SUCCEEDED");
    const attemptsText =
      (await page.getByTestId("publication-attempts").textContent()) ?? "";
    expect(attemptsText).toContain("request e2e-request-1");

    const connectedStubStatusIds = stub.publishedStatusIds();
    expect(connectedStubStatusIds).toHaveLength(1);
    const postedId = connectedStubStatusIds[0]!;
    const posted = stub.statuses.get(postedId)!;
    expect(posted.body).toBe(FIRST_CONTENT);
    expect(posted.idempotencyKey.length).toBeGreaterThan(0);
    expect(stub.publishRequests).toHaveLength(1);
    expect(stub.publishRequests[0]!.idempotencyKey).toBe(posted.idempotencyKey);

    const publishRequestsBefore = stub.publishRequests.length;
    await page.goto(`${BASE_URL}/projects/${projectId}/analytics`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByTestId("analytics-row").first().waitFor({ state: "visible" });
    await page.goto(`${BASE_URL}/projects/${projectId}/publishing`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator(`[data-publication-id="${publicationId}"]`)
      .first()
      .click();
    await page.getByTestId("publication-status").waitFor({ state: "visible" });
    expect(stub.publishRequests.length).toBe(publishRequestsBefore);
    const detail = await apiDetail(page, publicationId);
    expect(detail.attempts).toHaveLength(1);

    await page.close();
  });

  it("keeps a provider rejection visible, records it, and lets a retry publish", async () => {
    if (!stack.reachable || !stack.available) return;

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${projectId}/publishing`, {
      waitUntil: "domcontentloaded",
    });

    stub.setPublishMode("reject");
    const created = await createValidated(page, retryDocumentId);
    const published = await page.request.post(
      `${BASE_URL}/api/projects/${projectId}/publishing/publications/${created.id}/publish`,
      { data: {} },
    );
    expect(published.status()).toBe(200);

    const failed = await waitForStatus(page, created.id, ["FAILED"]);
    expect(failed.lastErrorCode).toBe("PUBLISHING_PROVIDER_REJECTED");
    expect(failed.externalPostId).toBeNull();
    expect(failed.externalUrl).toBeNull();

    await page.goto(`${BASE_URL}/projects/${projectId}/publishing`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator(`[data-publication-id="${created.id}"]`)
      .first()
      .click();
    await page.getByTestId("publication-status").waitFor({ state: "visible" });
    await expect
      .poll(async () => page.getByTestId("publication-status").textContent())
      .toContain("FAILED");
    expect(await page.getByTestId("publication-external-url").count()).toBe(0);
    const failureDetail = (await page.getByTestId("publication-detail").textContent()) ?? "";
    expect(failureDetail).toContain("PUBLISHING_PROVIDER_REJECTED");
    await expect
      .poll(
        async () => page.getByTestId("publication-attempts").textContent(),
        { timeout: 15_000 },
      )
      .toContain("FAILED");

    const statusesBeforeRetry = stub.publishedStatusIds().length;
    stub.setPublishMode("accept");
    await expect
      .poll(async () => page.getByTestId("publication-retry").isEnabled(), {
        timeout: 15_000,
      })
      .toBe(true);
    await page.getByTestId("publication-retry").click();

    await expect
      .poll(
        async () => page.getByTestId("publication-status").textContent(),
        { timeout: 30_000 },
      )
      .toContain("PUBLISHED");
    await page.getByTestId("publication-external-url").waitFor({ state: "visible" });
    expect(stub.publishedStatusIds().length).toBe(statusesBeforeRetry + 1);
    const attemptsText =
      (await page.getByTestId("publication-attempts").textContent()) ?? "";
    expect(attemptsText).toContain("SUCCEEDED");

    await page.close();
  });

  it("reconciles an ambiguous attempt onto the same provider post without duplicating it", async () => {
    if (!stack.reachable || !stack.available) return;

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${projectId}/publishing`, {
      waitUntil: "domcontentloaded",
    });

    stub.setPublishMode("abort-after-record");
    const created = await createValidated(page, reconcileDocumentId);
    const published = await page.request.post(
      `${BASE_URL}/api/projects/${projectId}/publishing/publications/${created.id}/publish`,
      { data: {} },
    );
    expect(published.status()).toBe(200);

    const ambiguous = await waitForStatus(page, created.id, ["AMBIGUOUS"]);
    expect(ambiguous.lastErrorCode).toBe("PUBLISHING_PROVIDER_AMBIGUOUS");
    expect(ambiguous.externalPostId).toBeNull();

    const recordedIds = stub.publishedStatusIds();
    const recordedId = recordedIds[recordedIds.length - 1]!;
    const requestsForPublication = () =>
      stub.publishRequests.filter(
        (request) => request.idempotencyKey === created.idempotencyKey,
      );
    expect(requestsForPublication()).toHaveLength(1);

    await page.goto(`${BASE_URL}/projects/${projectId}/publishing`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator(`[data-publication-id="${created.id}"]`)
      .first()
      .click();
    await expect
      .poll(async () => page.getByTestId("publication-status").textContent(), {
        timeout: 15_000,
      })
      .toContain("AMBIGUOUS");

    await expect
      .poll(async () => page.getByTestId("publication-reconcile").isEnabled(), {
        timeout: 15_000,
      })
      .toBe(true);
    await page.getByTestId("publication-reconcile").click();

    await expect
      .poll(
        async () => page.getByTestId("publication-status").textContent(),
        { timeout: 30_000 },
      )
      .toContain("PUBLISHED");

    const reconciled = await apiDetail(page, created.id);
    expect(reconciled.publication.externalPostId).toBe(recordedId);
    expect(reconciled.publication.externalUrl).toContain(recordedId);

    const requests = requestsForPublication();
    expect(requests).toHaveLength(2);
    expect(requests[1]!.replayed).toBe(true);
    expect(requests[1]!.postId).toBe(recordedId);
    expect(stub.publishedStatusIds()).toHaveLength(recordedIds.length);

    await page.close();
  });

  it("turns a queued publication STALE when its source changed, without calling the provider", async () => {
    if (!stack.reachable || !stack.available) return;

    await stopPublishingWorker(stack);
    const statusesBefore = stub.publishedStatusIds().length;

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${projectId}/publishing`, {
      waitUntil: "domcontentloaded",
    });

    const created = await apiPublication(page, staleDocumentId);
    const validated = await page.request.post(
      `${BASE_URL}/api/projects/${projectId}/publishing/publications/${created.id}/validate`,
      { data: {} },
    );
    expect(validated.status()).toBe(200);
    const queued = await page.request.post(
      `${BASE_URL}/api/projects/${projectId}/publishing/publications/${created.id}/publish`,
      { data: {} },
    );
    expect(queued.status()).toBe(200);
    await waitForStatus(page, created.id, ["QUEUED"]);

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const stillQueued = await apiDetail(page, created.id);
    expect(stillQueued.publication.status).toBe("QUEUED");

    await orm.WritingDocument.where({ id: staleDocumentId }).update({
      content: "The source was edited after the publication was queued.",
      version: 2,
    });

    stack.publishingWorker = spawnPublishingWorker();
    const stale = await waitForStatus(page, created.id, ["STALE"]);
    expect(stale.lastErrorCode).toBe("SOURCE_UNRESOLVED");

    expect(stub.publishedStatusIds().length).toBe(statusesBefore);
    const detail = await apiDetail(page, created.id);
    expect(detail.attempts).toHaveLength(0);

    await page.close();
  });

  it("denies cross-project access to publications and connections", async () => {
    if (!stack.reachable || !stack.available) return;

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${projectId}/publishing`, {
      waitUntil: "domcontentloaded",
    });

    const created = await apiPublication(page, firstDocumentId);

    const foreignDetail = await page.request.get(
      `${BASE_URL}/api/projects/${otherProjectId}/publishing/publications/${created.id}`,
    );
    expect(foreignDetail.status()).toBe(404);

    const foreignValidate = await page.request.post(
      `${BASE_URL}/api/projects/${otherProjectId}/publishing/publications/${created.id}/validate`,
      { data: {} },
    );
    expect(foreignValidate.status()).toBe(404);

    const foreignConnections = await page.request.get(
      `${BASE_URL}/api/projects/${otherProjectId}/publishing/connections`,
    );
    expect(foreignConnections.status()).toBe(200);
    const body = (await foreignConnections.json()) as { connections: unknown[] };
    expect(body.connections).toHaveLength(0);

    const foreignCreate = await page.request.post(
      `${BASE_URL}/api/projects/${otherProjectId}/publishing/publications`,
      {
        data: {
          connectionId: await connectionId(),
          sourceType: "WRITING_DOCUMENT",
          sourceId: firstDocumentId,
        },
      },
    );
    expect(foreignCreate.status()).toBe(404);

    await page.close();
  });
});
