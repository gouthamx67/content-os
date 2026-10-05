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
 * Browser proof that a rewrite appends history instead of overwriting it.
 *
 * The original variant stays visible, a new variant carrying the SHORTEN
 * instruction appears, and the new variant becomes the selected one. If a
 * rewrite replaced the text in place, the original variant count would not grow
 * and this spec would fail.
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

beforeAll(async () => {
  stack = await startStack();
  if (!stack.reachable || !stack.available) return;

  email = `cp18-e2e-rewrite-${Date.now()}@test.local`;
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

describe("writing rewrite end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("appends a shortened variant and selects it", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const projectId = await createAnalyzedE2EProject(
      user.workspaceId,
      user.userId,
      "CP18 E2E rewrite",
    );
    projectIds.push(projectId);

    const page = await openWorkspace(projectId);
    await page.getByTestId("writing-block-type").selectOption("BODY");
    await page.getByTestId("writing-prompt").fill("Body copy for the export run");
    await page.getByTestId("writing-variant-count").fill("2");
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

    const before = await page.getByTestId("writing-variant").count();
    expect(before).toBeGreaterThan(0);

    await page.getByTestId("writing-rewrite-SHORTEN").click();

    await expect
      .poll(async () => page.getByTestId("writing-variant").count(), {
        timeout: 30_000,
        interval: 500,
      })
      .toBeGreaterThan(before);

    const shortened = page
      .getByTestId("writing-variant")
      .filter({ hasText: "SHORTEN" });
    await shortened.first().waitFor({ state: "visible", timeout: 15_000 });
    await expect
      .poll(async () => shortened.first().getAttribute("data-selected"), {
        timeout: 15_000,
        interval: 500,
      })
      .toBe("true");

    const content = await page.getByTestId("writing-document-content").innerText();
    expect(content.trim().length).toBeGreaterThan(0);

    await page.close();
  });
});
