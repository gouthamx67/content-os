import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import {
  BASE_URL,
  cleanupE2EUser,
  createAnalyzedE2EProject,
  registerBrowserUser,
  SESSION_COOKIE,
  startStack,
  stopStack,
  type E2EStack,
  type RegisteredBrowserUser,
} from "./support/image-harness";

/**
 * Real browser proof that the import checkpoint is reachable.
 *
 * CP20's import service was complete but had no entry point: nothing surfaced
 * "reassemble any imported composition". This spec drives the list-page import
 * form, which POSTs to the import route. The generated image this project owns
 * becomes a document whose image node streams back the exact stored bytes.
 */

let stack: E2EStack;
let user: RegisteredBrowserUser;
let browser: Browser;
let context: BrowserContext;
const projectIds: string[] = [];
let email = "";
let importsProjectId = "";
let imageJobId = "";
let importedAssetId = "";
let importedRef = "";
let importedByteSize = 0;
let importedChecksum = "";
let setupDone = false;

function assetUrl(projectId: string, ref: string): string {
  return `${BASE_URL}/api/projects/${projectId}/editor/assets/${encodeURIComponent(ref)}`;
}

async function stackReady(testContext: { skip: () => void }): Promise<boolean> {
  if (!stack.reachable || !stack.available) {
    testContext.skip();
    return false;
  }
  return true;
}

beforeAll(async () => {
  stack = await startStack();
  if (!stack.reachable || !stack.available) return;

  const services = await import("../../src/infrastructure/services");

  email = `cp20-imports-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);

  importsProjectId = await createAnalyzedE2EProject(
    user.workspaceId,
    user.userId,
    "CP20 editor imports",
  );
  projectIds.push(importsProjectId);

  // Render a real image through the worker this stack started. Its outcome is
  // polled inside the first test, because expect.poll() only runs in a test.
  const job = await services.imageGenerationService.enqueue({
    projectId: importsProjectId,
    requestedById: user.userId,
    templateType: "SOCIAL_POST",
    prompt: "A status report dashboard",
  });
  imageJobId = job.id;

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
  await stopStack(stack);
  if (user) await cleanupE2EUser(email, user.workspaceId, projectIds);
});

describe("editor import end to end", () => {
  it("imports a generated image through the list page", async (testContext) => {
    if (!(await stackReady(testContext))) return;

    const services = await import("../../src/infrastructure/services");

    await expect
      .poll(
        async () => {
          const record = await services.imageGenerationService.get({
            projectId: importsProjectId,
            jobId: imageJobId,
            userId: user.userId,
          });
          return record.status;
        },
        { timeout: 120_000, interval: 500 },
      )
      .toBe("SUCCEEDED");

    const asset = await services.imageGenerationService.asset({
      projectId: importsProjectId,
      jobId: imageJobId,
      userId: user.userId,
    });
    expect(asset).not.toBeNull();
    importedAssetId = asset!.id;
    importedRef = `generated:${asset!.id}`;
    importedByteSize = asset!.byteSize;
    importedChecksum = asset!.checksumSha256;

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${importsProjectId}/editor`, {
      waitUntil: "domcontentloaded",
    });

    await page
      .getByTestId("editor-import-form")
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("editor-import-kind").selectOption("GENERATED_IMAGE");
    await page.getByTestId("editor-import-source").fill(asset!.id);
    await page.getByTestId("editor-import-submit").click();

    // The import created a document and the workspace opened it.
    await page
      .getByTestId("editor-stage")
      .waitFor({ state: "visible", timeout: 15_000 });
    await expect
      .poll(
        async () =>
          page.locator('[data-testid="editor-node"][data-node-type="IMAGE"]').count(),
        { timeout: 15_000 },
      )
      .toBe(1);

    // The import happened through the real route: the document is listed and
    // its name reflects the generated asset it was built from.
    await page.goto(`${BASE_URL}/projects/${importsProjectId}/editor`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByTestId("editor-document")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    await expect
      .poll(
        async () =>
          page.getByText(`Generated image import — ${importedAssetId}`).count(),
        { timeout: 15_000 },
      )
      .toBe(1);

    await page.close();
    setupDone = true;
  });

  it("streams the imported image's exact bytes through the editor", async (testContext) => {
    if (!setupDone) {
      void testContext;
      await stackReady(testContext);
      return;
    }

    const response = await context.request.get(
      assetUrl(importsProjectId, importedRef),
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");

    const bytes = await response.body();
    expect(bytes.byteLength).toBe(importedByteSize);
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(digest).toBe(importedChecksum);
  });
});