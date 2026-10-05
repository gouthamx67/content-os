import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
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
 * Browser proof that copied claims carry provenance.
 *
 * A BODY block is generated, then every displayed claim must be GROUNDED or
 * REVIEW — an UNSUPPORTED sentence in the workspace means the engine invented a
 * fact, which is the failure this whole subsystem exists to prevent.
 */

let stack: E2EStack;
let user: RegisteredBrowserUser;
let browser: Browser;
let context: BrowserContext;
const projectIds: string[] = [];
let email = "";

async function openWorkspace(projectId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/projects/${projectId}`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByTestId("writing-workspace")
    .waitFor({ state: "visible", timeout: 30_000 });
  return page;
}

async function generateBody(page: Page): Promise<void> {
  await page.getByTestId("writing-block-type").selectOption("BODY");
  await page.getByTestId("writing-tone").selectOption("PROFESSIONAL");
  await page.getByTestId("writing-length").selectOption("LONG");
  await page.getByTestId("writing-objective").selectOption("PRODUCT_EXPLANATION");
  await page
    .getByTestId("writing-prompt")
    .fill("Explain the scheduling product and its proof");
  await page.getByTestId("writing-variant-count").fill("1");
  await page.getByTestId("writing-generate").click();

  await expect
    .poll(
      async () => {
        const job = page.getByTestId("writing-job").first();
        if ((await job.count()) === 0) return null;
        return job.getAttribute("data-status");
      },
      { timeout: 90_000, interval: 500 },
    )
    .toBe("SUCCEEDED");

  await page
    .getByTestId("writing-document")
    .waitFor({ state: "visible", timeout: 15_000 });
}

beforeAll(async () => {
  stack = await startStack();
  if (!stack.reachable || !stack.available) return;

  email = `cp18-e2e-grounding-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);

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
  stopStack(stack);
  if (user) await cleanupE2EUser(email, user.workspaceId, projectIds);
});

describe("writing grounding end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("shows only grounded or reviewable claims", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const projectId = await createAnalyzedE2EProject(
      user.workspaceId,
      user.userId,
      "CP18 E2E grounding",
    );
    projectIds.push(projectId);

    const page = await openWorkspace(projectId);
    await generateBody(page);

    const claims = page.getByTestId("writing-claim");
    const claimCount = await claims.count();
    expect(claimCount).toBeGreaterThan(0);

    const statuses = await claims.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-status")),
    );
    for (const status of statuses) {
      expect(["GROUNDED", "REVIEW"]).toContain(status);
    }

    const grounded = page.locator(
      '[data-testid="writing-claim"][data-status="GROUNDED"]',
    );
    expect(await grounded.count()).toBeGreaterThan(0);

    const sourceChips = grounded
      .first()
      .locator('[data-testid="claim-source-ids"] li');
    expect(await sourceChips.count()).toBeGreaterThan(0);

    const content = await page.getByTestId("writing-document-content").innerText();
    expect(content.trim().length).toBeGreaterThan(0);

    await page.close();
  });
});
