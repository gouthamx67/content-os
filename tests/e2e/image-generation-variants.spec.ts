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
 * Real browser proof of the CP17 platform variants.
 *
 * One brief must become four separate jobs (square, portrait, landscape,
 * transparent), each rasterised by the worker to its own artifact. Four library
 * rows whose thumbnails load is the only acceptable result.
 */

type Services = typeof import("../../src/infrastructure/services");

let stack: E2EStack;
let services: Services;
let user: RegisteredBrowserUser;
let browser: Browser;
let context: BrowserContext;
const projectIds: string[] = [];
let email = "";

beforeAll(async () => {
  stack = await startStack();
  if (!stack.reachable || !stack.available) return;

  services = await import("../../src/infrastructure/services");

  email = `cp17-variants-${Date.now()}@test.local`;
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

describe("image generation variants end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("turns one brief into four rendered platform variants", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const project = await services.projectService.createForWorkspace(
      user.workspaceId,
      { name: "CP17 E2E variants" },
      user.userId,
    );
    projectIds.push(project.id);

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto(`${BASE_URL}/projects/${project.id}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByTestId("image-generation-workspace")
      .waitFor({ state: "visible", timeout: 30_000 });

    await page
      .getByTestId("image-prompt-input")
      .fill("Square, portrait and landscape launch variants");
    await page.getByTestId("generate-variants-button").click();

    await expect
      .poll(async () => page.getByTestId("image-job").count(), {
        timeout: 90_000,
        interval: 500,
      })
      .toBe(4);

    await expect
      .poll(
        async () => {
          const statuses = await page
            .getByTestId("image-job")
            .evaluateAll((nodes) =>
              nodes.map((node) => node.getAttribute("data-status")),
            );
          return statuses.length > 0 && statuses.every((s) => s === "SUCCEEDED");
        },
        { timeout: 90_000, interval: 500 },
      )
      .toBe(true);

    await expect
      .poll(async () => page.getByTestId("generated-image-item").count(), {
        timeout: 30_000,
        interval: 500,
      })
      .toBe(4);

    // Every thumbnail must be a real, loadable image, not an empty box.
    await expect
      .poll(
        async () =>
          page
            .getByTestId("generated-image-library")
            .locator("img")
            .evaluateAll((imgs) =>
              imgs.every((img) => (img as HTMLImageElement).naturalWidth > 0),
            ),
        { timeout: 30_000, interval: 500 },
      )
      .toBe(true);

    expect(consoleErrors).toEqual([]);
    await page.close();
  });
});
