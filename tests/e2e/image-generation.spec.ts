import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
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
 * Real browser proof of the CP17 generate flow.
 *
 * A prompt is typed, a button is pressed, and a real Chromium waits for the
 * worker to rasterise bytes. The result figure is only asserted once its <img>
 * has a non-zero natural width, so a broken stream route fails instead of
 * showing an empty box.
 */

type Services = typeof import("../../src/infrastructure/services");

let stack: E2EStack;
let services: Services;
let user: RegisteredBrowserUser;
let browser: Browser;
let context: BrowserContext;
const projectIds: string[] = [];
let email = "";

async function createProject(name: string): Promise<string> {
  const project = await services.projectService.createForWorkspace(
    user.workspaceId,
    { name },
    user.userId,
  );
  projectIds.push(project.id);
  return project.id;
}

async function generateThroughUi(
  page: import("playwright-core").Page,
  prompt: string,
): Promise<void> {
  await page.getByTestId("image-prompt-input").fill(prompt);
  await page.getByTestId("generate-image-button").click();

  await expect
    .poll(
      async () => {
        const job = page.getByTestId("image-job").first();
        if ((await job.count()) === 0) return null;
        return job.getAttribute("data-status");
      },
      { timeout: 90_000, interval: 500 },
    )
    .toBe("SUCCEEDED");

  await expect
    .poll(async () => page.getByTestId("generated-image-item").count(), {
      timeout: 30_000,
      interval: 500,
    })
    .toBeGreaterThan(0);

  await page.getByTestId("generated-image-item").first().click();
  await page
    .getByTestId("generated-image-result")
    .waitFor({ state: "visible", timeout: 15_000 });

  await expect
    .poll(
      async () =>
        page
          .getByTestId("generated-image-result")
          .locator("img")
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      { timeout: 20_000, interval: 500 },
    )
    .toBeGreaterThan(0);
}

beforeAll(async () => {
  stack = await startStack();
  if (!stack.reachable || !stack.available) return;

  services = await import("../../src/infrastructure/services");

  email = `cp17-e2e-${Date.now()}@test.local`;
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

describe("image generation end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("renders a real PNG from a typed prompt", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const projectId = await createProject("CP17 E2E PNG");
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto(`${BASE_URL}/projects/${projectId}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByTestId("image-generation-workspace")
      .waitFor({ state: "visible", timeout: 30_000 });

    await generateThroughUi(page, "Launch hero for scheduled exports");

    const meta = await page.getByTestId("generated-image-meta").textContent();
    expect(meta).toMatch(/\d+×\d+/);
    expect(meta).toContain("PNG");

    const ref = await page.getByTestId("generated-asset-ref").inputValue();
    expect(ref).toMatch(/^generated:/);

    expect(consoleErrors).toEqual([]);
    await page.close();
  });

  it("renders a JPEG and disables the transparency toggle", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const projectId = await createProject("CP17 E2E JPEG");
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/projects/${projectId}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByTestId("image-generation-workspace")
      .waitFor({ state: "visible", timeout: 30_000 });

    await page.getByTestId("image-format-select").selectOption("JPEG");
    await expect.poll(async () =>
      page.getByTestId("image-transparent-toggle").isDisabled(),
    ).toBe(true);

    await generateThroughUi(page, "JPEG launch card");

    const meta = await page.getByTestId("generated-image-meta").textContent();
    expect(meta).toContain("JPEG");

    await page.close();
  });

  it("renders a transparent PNG", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const projectId = await createProject("CP17 E2E transparent");
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/projects/${projectId}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByTestId("image-generation-workspace")
      .waitFor({ state: "visible", timeout: 30_000 });

    await page.getByTestId("image-format-select").selectOption("PNG");
    await page.getByTestId("image-transparent-toggle").check();

    await generateThroughUi(page, "Transparent badge");

    const meta = await page.getByTestId("generated-image-meta").textContent();
    expect(meta).toContain("transparent");

    await page.close();
  });
});
