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
 * Real browser proof of the CP18 writing flow.
 *
 * A block type is chosen, a prompt is typed and the button is pressed. The
 * document is only asserted once the job list reports SUCCEEDED and a document
 * renders, so a job that never grounds copy fails instead of showing a
 * placeholder headline.
 */

let stack: E2EStack;
let user: RegisteredBrowserUser;
let browser: Browser;
let context: BrowserContext;
const projectIds: string[] = [];
let email = "";

async function seedProject(name: string): Promise<string> {
  const projectId = await createAnalyzedE2EProject(
    user.workspaceId,
    user.userId,
    name,
  );
  projectIds.push(projectId);
  return projectId;
}

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

async function generateThroughUi(
  page: Page,
  options: {
    blockType?: string;
    tone?: string;
    length?: string;
    objective?: string;
    prompt: string;
    variantCount?: number;
  },
): Promise<void> {
  if (options.blockType) {
    await page.getByTestId("writing-block-type").selectOption(options.blockType);
  }
  if (options.tone) {
    await page.getByTestId("writing-tone").selectOption(options.tone);
  }
  if (options.length) {
    await page.getByTestId("writing-length").selectOption(options.length);
  }
  if (options.objective) {
    await page.getByTestId("writing-objective").selectOption(options.objective);
  }

  await page.getByTestId("writing-prompt").fill(options.prompt);
  await page
    .getByTestId("writing-variant-count")
    .fill(String(options.variantCount ?? 3));
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

  email = `cp18-e2e-engine-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);

  browser = await chromium.launch({
    executablePath: stack.executablePath,
    args: ["--no-sandbox"],
  });
  context = await browser.newContext();
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: user.cookieValue,
      url: BASE_URL,
    },
  ]);
});

afterAll(async () => {
  if (browser) await browser.close();
  stopStack(stack);
  if (user) await cleanupE2EUser(email, user.workspaceId, projectIds);
});

describe("writing engine end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("generates grounded copy from a typed prompt", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const projectId = await seedProject("CP18 E2E headline");
    const page = await openWorkspace(projectId);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await generateThroughUi(page, {
      blockType: "HEADLINE",
      tone: "BRAND",
      length: "SHORT",
      objective: "AWARENESS",
      prompt: "Launch headline for scheduled exports",
      variantCount: 3,
    });

    const content = await page.getByTestId("writing-document-content").innerText();
    expect(content.trim().length).toBeGreaterThan(0);

    const variants = await page.getByTestId("writing-variant").count();
    expect(variants).toBeGreaterThan(0);

    const sha = await page
      .getByTestId("writing-document-context-sha")
      .textContent();
    expect(sha?.trim()).toHaveLength(12);

    expect(consoleErrors).toEqual([]);
    await page.close();
  });

  it("generates ad copy and lists the generated document", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const projectId = await seedProject("CP18 E2E variants");
    const page = await openWorkspace(projectId);

    await generateThroughUi(page, {
      blockType: "AD_COPY",
      tone: "PROFESSIONAL",
      length: "MEDIUM",
      objective: "CONSIDERATION",
      prompt: "Ad copy for the scheduling dashboard",
      variantCount: 5,
    });

    const variants = await page.getByTestId("writing-variant").count();
    expect(variants).toBeGreaterThanOrEqual(1);
    expect(variants).toBeLessThanOrEqual(5);

    const content = await page.getByTestId("writing-document-content").innerText();
    expect(content.trim().length).toBeGreaterThan(0);

    const documents = await page
      .getByTestId("writing-documents")
      .locator("button")
      .count();
    expect(documents).toBeGreaterThan(0);

    await page.close();
  });
});
