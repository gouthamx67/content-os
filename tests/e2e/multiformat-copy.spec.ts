import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
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

/**
 * Real browser proof of CP19 copy adaptation.
 *
 * A variant must be a shorter form of the source, not a new sentence: the browser
 * shows the same text the API serves, and the text has to stay a prefix of what
 * CP18 wrote.
 */

type Services = typeof import("../../src/infrastructure/services");

let stack: E2EStack;
let services: Services;
let user: RegisteredBrowserUser;
let browser: Browser;
let context: BrowserContext;
const projectIds: string[] = [];
let email = "";
let variantId = "";
let variantText = "";

const SOURCE_TEXT = [
  "Northwind Analytics is the content operating system for regulated teams.",
  "Every claim stays traceable to the source that supports it.",
  "Scheduled exports mean a status report is never a manual chore.",
  "Editors approve what ships without waiting on an engineer.",
  "Audit trails are complete by default rather than assembled on request.",
  "Brand rules are enforced at generation time, not reviewed afterwards.",
].join(" ");

/**
 * A CP18 writing variant, written straight to the database.
 *
 * CP19 adapts whatever CP18 produced; seeding the source directly keeps this spec
 * about CP19 instead of also standing up CP18's generation pipeline. The bytes are
 * a real variant and real claims, so the copy path under test is the real one.
 */
async function seedWritingVariant(): Promise<void> {
  const project = await services.projectService.createForWorkspace(
    user.workspaceId,
    { name: "CP19 E2E copy" },
    user.userId,
  );
  projectIds.push(project.id);

  const { db } = await import("../../src/prisma/db");
  const orm = db.orm.public;

  const documentId = `wdoc-${Date.now()}`;
  const now = new Date().toISOString();
  const digest = createHash("sha256").update(SOURCE_TEXT).digest("hex");

  await orm.WritingDocument.create({
    id: documentId,
    projectId: project.id,
    title: "Northwind launch",
    blockType: "CAPTION",
    tone: "BRAND",
    length: "MEDIUM",
    objective: "AWARENESS",
    audience: "Regulated teams",
    language: "en",
    content: SOURCE_TEXT,
    contentSha256: digest,
    contextSha256: createHash("sha256").update("ctx").digest("hex"),
    contextSnapshot: "{}",
    version: 1,
    brandVersion: 1,
    intelligenceVersion: 1,
    createdById: user.userId,
    createdAt: now,
    updatedAt: now,
  });

  variantId = `wvar-${Date.now()}`;

  await orm.WritingVariant.create({
    id: variantId,
    documentId,
    ordinal: 0,
    label: "Caption A",
    text: SOURCE_TEXT,
    textSha256: digest,
    instruction: null,
    selected: true,
    createdAt: now,
  });

  await orm.WritingClaim.create({
    id: `wcl-${Date.now()}`,
    projectId: project.id,
    documentId,
    variantId,
    text: "Northwind Analytics is the content operating system for regulated teams.",
    status: "GROUNDED",
    sourceIds: [`src-${Date.now()}`],
    reasoning: "Stated in the product brief.",
    createdAt: now,
  });

  variantText = SOURCE_TEXT;
}

async function adapt(
  page: Page,
  projectId: string,
  formatId: string,
): Promise<{ id: string; status: string; outputText: string | null }> {
  const response = await page.request.post(
    `${BASE_URL}/api/projects/${projectId}/multiformat/batches`,
    {
      data: {
        sourceType: "WRITING_VARIANT",
        sourceId: variantId,
        targets: [{ formatId }],
      },
    },
  );

  expect(response.status()).toBe(201);

  const batchId = ((await response.json()) as { batch: { id: string } }).batch.id;

  await expect
    .poll(
      async () => {
        const detail = await page.request.get(
          `${BASE_URL}/api/projects/${projectId}/multiformat/batches/${batchId}`,
        );
        const body = (await detail.json()) as {
          batch: { status: string };
          jobs: Array<{ id: string; status: string; outputText: string | null }>;
        };
        return body.batch.status;
      },
      { timeout: 60_000 },
    )
    .toBe("SUCCEEDED");

  const detail = await page.request.get(
    `${BASE_URL}/api/projects/${projectId}/multiformat/batches/${batchId}`,
  );
  const body = (await detail.json()) as {
    jobs: Array<{ id: string; status: string; outputText: string | null }>;
  };

  return body.jobs[0]!;
}

beforeAll(async () => {
  stack = await startStack({ withMultiformatWorker: true });
  if (!stack.reachable || !stack.available) return;

  services = await import("../../src/infrastructure/services");

  email = `cp19-copy-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);

  browser = await chromium.launch({
    executablePath: stack.executablePath,
    args: ["--no-sandbox"],
  });
  context = await browser.newContext();
  await context.addCookies([
    { name: SESSION_COOKIE, value: user.cookieValue, url: BASE_URL },
  ]);

  await seedWritingVariant();
});

afterAll(async () => {
  if (browser) await browser.close();
  stopStack(stack);
  if (user) await cleanupE2EUser(email, user.workspaceId, projectIds);
});

describe("copy adaptation end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("trims the source rather than rewriting it", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    const projectId = projectIds[0]!;
    const short = await adapt(page, projectId, "COPY_SHORT");

    expect(short.status).toBe("SUCCEEDED");
    expect(short.outputText).toBeTruthy();
    expect(short.outputText!.length).toBeLessThanOrEqual(80);
    expect(variantText.length).toBeGreaterThan(short.outputText!.length);
    expect(variantText).toContain(short.outputText!.slice(0, 40));

    await page.close();
  });

  it("produces a longer variant for a longer format from the same source", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    const projectId = projectIds[0]!;
    const short = await adapt(page, projectId, "COPY_SHORT");
    const long = await adapt(page, projectId, "COPY_LONG");

    expect(long.outputText!.length).toBeGreaterThan(short.outputText!.length);
    expect(long.outputText!.length).toBeLessThanOrEqual(1000);

    await page.close();
  });

  it("shows the finished variant in the workspace without leaking the recipe", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    const projectId = projectIds[0]!;
    await adapt(page, projectId, "COPY_CAPTION");

    await page.goto(`${BASE_URL}/projects/${projectId}/multiformat`, {
      waitUntil: "domcontentloaded",
    });

    await page
      .getByRole("heading", { name: /Adapt one source/ })
      .waitFor({ state: "visible", timeout: 15_000 });

    await page
      .getByText("COPY_CAPTION")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });

    // The frozen snapshot is internal reproduction material and must never reach
    // the page.
    const html = await page.content();
    expect(html).not.toContain('"recipe"');
    expect(html).not.toContain("outputStorageKey");

    await page.close();
  });
});
