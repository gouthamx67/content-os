import { createHash } from "node:crypto";
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

/**
 * Real browser proof of a multi-target CP19 batch: many formats from one source,
 * a batch that reports its own progress, and a cancellation that actually stops
 * the work rather than only hiding it.
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

const SOURCE_TEXT = [
  "Northwind Analytics is the content operating system for regulated teams.",
  "Every claim stays traceable to the source that supports it.",
  "Scheduled exports mean a status report is never a manual chore.",
  "Editors approve what ships without waiting on an engineer.",
  "Audit trails are complete by default rather than assembled on request.",
  "Brand rules are enforced at generation time, not reviewed afterwards.",
].join(" ");

async function seedVariant(): Promise<void> {
  const project = await services.projectService.createForWorkspace(
    user.workspaceId,
    { name: "CP19 E2E batch" },
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
    title: "Batch source",
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
}

type BatchBody = {
  batch: { id: string; status: string; progressPct: number; targetCount: number };
  jobs: Array<{
    id: string;
    formatId: string;
    status: string;
    progressPct: number;
    outputText: string | null;
  }>;
};

async function createBatch(
  page: Page,
  formatIds: string[],
): Promise<BatchBody> {
  const response = await page.request.post(
    `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches`,
    {
      data: {
        sourceType: "WRITING_VARIANT",
        sourceId: variantId,
        targets: formatIds.map((formatId) => ({ formatId })),
      },
    },
  );

  expect(response.status()).toBe(201);

  return (await response.json()) as BatchBody;
}

async function readBatch(page: Page, batchId: string): Promise<BatchBody> {
  const response = await page.request.get(
    `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches/${batchId}`,
  );

  expect(response.status()).toBe(200);

  return (await response.json()) as BatchBody;
}

beforeAll(async () => {
  stack = await startStack({ withMultiformatWorker: true });
  if (!stack.reachable || !stack.available) return;

  services = await import("../../src/infrastructure/services");

  email = `cp19-batch-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);

  browser = await chromium.launch({
    executablePath: stack.executablePath,
    args: ["--no-sandbox"],
  });
  context = await browser.newContext();
  await context.addCookies([
    { name: SESSION_COOKIE, value: user.cookieValue, url: BASE_URL },
  ]);

  await seedVariant();
});

afterAll(async () => {
  if (browser) await browser.close();
  stopStack(stack);
  if (user) await cleanupE2EUser(email, user.workspaceId, projectIds);
});

describe("batch adaptation end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("queues every requested target against the frozen source", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    const created = await createBatch(page, [
      "COPY_SHORT",
      "COPY_MEDIUM",
      "COPY_CAPTION",
    ]);

    expect(created.batch.targetCount).toBe(3);
    expect(created.jobs).toHaveLength(3);
    expect(new Set(created.jobs.map((job) => job.formatId)).size).toBe(3);

    await expect
      .poll(async () => (await readBatch(page, created.batch.id)).batch.status, {
        timeout: 60_000,
      })
      .toBe("SUCCEEDED");

    const finished = await readBatch(page, created.batch.id);

    expect(finished.batch.progressPct).toBe(100);
    expect(finished.jobs.every((job) => job.status === "SUCCEEDED")).toBe(true);

    await page.close();
  });

  it("gives each format its own length from the one source", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    const created = await createBatch(page, ["COPY_SHORT", "COPY_LONG"]);

    await expect
      .poll(async () => (await readBatch(page, created.batch.id)).batch.status, {
        timeout: 60_000,
      })
      .toBe("SUCCEEDED");

    const finished = await readBatch(page, created.batch.id);
    const short = finished.jobs.find((job) => job.formatId === "COPY_SHORT")!;
    const long = finished.jobs.find((job) => job.formatId === "COPY_LONG")!;

    expect(short.outputText!.length).toBeLessThanOrEqual(80);
    expect(long.outputText!.length).toBeGreaterThan(short.outputText!.length);

    await page.close();
  });

  it("refuses to queue a format this source can never become", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();

    const response = await page.request.post(
      `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches`,
      {
        data: {
          sourceType: "WRITING_VARIANT",
          sourceId: variantId,
          targets: [{ formatId: "IMAGE_SQUARE" }],
        },
      },
    );

    expect(response.status()).toBe(422);

    const body = (await response.json()) as { code: string };

    expect(body.code).toBe("ADAPTATION_FORMAT_KIND_MISMATCH");

    await page.close();
  });

  it("stops a batch when it is cancelled", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    const created = await createBatch(page, [
      "COPY_SHORT",
      "COPY_MEDIUM",
      "COPY_CAPTION",
      "COPY_LONG",
    ]);

    const cancel = await page.request.post(
      `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches/${created.batch.id}/cancel`,
    );

    expect(cancel.status()).toBe(200);

    const cancelled = (await cancel.json()) as BatchBody;

    expect(
      cancelled.jobs.every((job) =>
        ["CANCELLED", "CANCEL_REQUESTED", "SUCCEEDED", "FAILED"].includes(job.status),
      ),
    ).toBe(true);

    // The worker may finish a job or two before the cancellation lands, so the
    // batch honestly ends either fully cancelled or partial. What must hold is
    // that nothing is left queued or running.
    await expect
      .poll(async () => (await readBatch(page, created.batch.id)).batch.status, {
        timeout: 60_000,
      })
      .toMatch(/^(CANCELLED|PARTIAL)$/);

    const settled = await readBatch(page, created.batch.id);

    expect(
      settled.jobs.every((job) =>
        ["CANCELLED", "SUCCEEDED", "FAILED"].includes(job.status),
      ),
    ).toBe(true);
    expect(
      settled.jobs.some((job) => job.status === "CANCELLED"),
    ).toBe(true);

    await page.close();
  });

  it("refuses to cancel a batch that already finished", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    const created = await createBatch(page, ["COPY_SHORT"]);

    await expect
      .poll(async () => (await readBatch(page, created.batch.id)).batch.status, {
        timeout: 60_000,
      })
      .toBe("SUCCEEDED");

    const cancel = await page.request.post(
      `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches/${created.batch.id}/cancel`,
    );

    expect(cancel.status()).toBe(409);

    const body = (await cancel.json()) as { code: string };

    expect(body.code).toBe("ADAPTATION_BATCH_NOT_CANCELLABLE");

    await page.close();
  });
});
