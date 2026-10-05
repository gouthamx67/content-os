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
 * Browser proof that a document keeps its frozen context.
 *
 * The workspace shows a short context hash. Reloading the project and reopening
 * the stored document must show the same hash and the same copy, because a
 * writing document is bound to the context snapshot taken when it was queued.
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

async function generate(page: Page, blockType: string, prompt: string): Promise<void> {
  await page.getByTestId("writing-block-type").selectOption(blockType);
  await page.getByTestId("writing-prompt").fill(prompt);
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

  email = `cp18-e2e-context-${Date.now()}@test.local`;
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

describe("writing context end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("keeps the frozen context hash across a reload", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const projectId = await createAnalyzedE2EProject(
      user.workspaceId,
      user.userId,
      "CP18 E2E context",
    );
    projectIds.push(projectId);

    const page = await openWorkspace(projectId);
    await generate(page, "HEADLINE", "Headline for the export scheduler");

    const firstSha = (
      await page.getByTestId("writing-document-context-sha").textContent()
    )?.trim();
    const firstContent = await page
      .getByTestId("writing-document-content")
      .innerText();
    expect(firstSha).toHaveLength(12);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByTestId("writing-workspace")
      .waitFor({ state: "visible", timeout: 30_000 });

    const documentButton = page
      .getByTestId("writing-documents")
      .locator("button")
      .first();
    await documentButton.click();

    await page
      .getByTestId("writing-document")
      .waitFor({ state: "visible", timeout: 15_000 });

    const secondSha = (
      await page.getByTestId("writing-document-context-sha").textContent()
    )?.trim();
    const secondContent = await page
      .getByTestId("writing-document-content")
      .innerText();

    expect(secondSha).toBe(firstSha);
    expect(secondContent).toBe(firstContent);

    await page.close();
  });

  it("stores each block's document separately", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const projectId = await createAnalyzedE2EProject(
      user.workspaceId,
      user.userId,
      "CP18 E2E context blocks",
    );
    projectIds.push(projectId);

    const page = await openWorkspace(projectId);
    await generate(page, "HEADLINE", "Headline for context isolation");
    await generate(page, "CAPTION", "Caption for context isolation");

    const documents = await page
      .getByTestId("writing-documents")
      .locator("button")
      .count();
    expect(documents).toBeGreaterThanOrEqual(2);

    await page.close();
  });
});
