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
 * Real browser proof of CP19 lineage.
 *
 * A shortened caption may only be credited to the sources behind the claims it
 * still contains. Crediting the whole source set would tell a reviewer that a
 * claim survived when the trimming removed it.
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
let openingSourceId = "";
let closingSourceId = "";

const SOURCE_TEXT = [
  "Northwind Analytics is the content operating system for regulated teams.",
  "Every claim stays traceable to the source that supports it.",
  "Scheduled exports mean a status report is never a manual chore.",
  "Editors approve what ships without waiting on an engineer.",
].join(" ");

async function seedVariant(): Promise<void> {
  const project = await services.projectService.createForWorkspace(
    user.workspaceId,
    { name: "CP19 E2E lineage" },
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
    title: "Lineage source",
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
  openingSourceId = `src-open-${Date.now()}`;
  closingSourceId = `src-close-${Date.now()}`;

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

  // The opening claim is backed, the closing one is not. A short caption keeps the
  // opening and drops the closing, so only the opening source may be claimed.
  await orm.WritingClaim.create({
    id: `wcl-a-${Date.now()}`,
    projectId: project.id,
    documentId,
    variantId,
    text: "Northwind Analytics is the content operating system for regulated teams.",
    status: "GROUNDED",
    sourceIds: [openingSourceId],
    reasoning: "Stated in the product brief.",
    createdAt: now,
  });

  await orm.WritingClaim.create({
    id: `wcl-b-${Date.now()}`,
    projectId: project.id,
    documentId,
    variantId,
    text: "Editors approve what ships without waiting on an engineer.",
    status: "UNSUPPORTED",
    sourceIds: [closingSourceId],
    reasoning: "No source in the brief states this.",
    createdAt: now,
  });
}

type JobView = {
  provenanceSourceIds: string[];
  outputText: string | null;
  recipeSha256: string;
};

async function adaptTo(page: Page, formatId: string): Promise<JobView> {
  const response = await page.request.post(
    `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches`,
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
          `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches/${batchId}`,
        );
        const body = (await detail.json()) as { batch: { status: string } };
        return body.batch.status;
      },
      { timeout: 60_000 },
    )
    .toBe("SUCCEEDED");

  const detail = await page.request.get(
    `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches/${batchId}`,
  );
  const body = (await detail.json()) as { jobs: JobView[] };

  return body.jobs[0]!;
}

beforeAll(async () => {
  stack = await startStack({ withMultiformatWorker: true });
  if (!stack.reachable || !stack.available) return;

  services = await import("../../src/infrastructure/services");

  email = `cp19-lineage-${Date.now()}@test.local`;
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
  await stopStack(stack);
  if (user) await cleanupE2EUser(email, user.workspaceId, projectIds);
});

describe("copy lineage end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("claims only the sources behind the claims the caption kept", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    const job = await adaptTo(page, "COPY_SHORT");

    expect(job.provenanceSourceIds).toContain(openingSourceId);
    expect(job.provenanceSourceIds).not.toContain(closingSourceId);

    await page.close();
  });

  it("never exposes the frozen recipe on the job read", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    const created = await page.request.post(
      `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches`,
      {
        data: {
          sourceType: "WRITING_VARIANT",
          sourceId: variantId,
          targets: [{ formatId: "COPY_SHORT" }],
        },
      },
    );

    const batchId = ((await created.json()) as { batch: { id: string } }).batch.id;

    await expect
      .poll(
        async () => {
          const detail = await page.request.get(
            `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches/${batchId}`,
          );
          const body = (await detail.json()) as { batch: { status: string } };
          return body.batch.status;
        },
        { timeout: 60_000 },
      )
      .toBe("SUCCEEDED");

    const detail = await page.request.get(
      `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches/${batchId}`,
    );
    const text = await detail.text();
    const body = JSON.parse(text) as { jobs: JobView[] };

    // The produced caption is the only source-derived text a caller gets, and for
    // a short format it is genuinely shorter than the source.
    expect(body.jobs[0]!.outputText!.length).toBeLessThan(SOURCE_TEXT.length);

    // The recipe carries the frozen snapshot and the on-disk location. Neither may
    // cross the wire.
    expect(text).not.toContain('"recipe"');
    expect(text).not.toContain("outputStorageKey");
    expect(text).not.toContain("contextSnapshot");

    await page.close();
  });
});
