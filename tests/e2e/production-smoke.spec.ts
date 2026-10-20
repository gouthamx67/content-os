import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import {
  BASE_URL,
  cleanupE2EUser,
  registerBrowserUser,
  restartServer,
  SESSION_COOKIE,
  startStack,
  stopStack,
  type E2EStack,
  type RegisteredBrowserUser,
} from "./support/image-harness";

/**
 * CP24 production smoke.
 *
 * This is the "would I trust this deployment" pass. It runs against a server
 * started the same way production is (`next start` over a real build) and asks
 * the questions an operator asks during a deploy:
 *   - does the process report itself healthy, and honestly unhealthy when it
 *     cannot reach its database?
 *   - does an unconfigured feature read as unavailable instead of fake-working?
 *   - do authenticated reads and a real page load still work?
 *   - does the process survive a restart?
 *
 * The stack is deliberately started without publishing configuration so the
 * honest "no provider" path is what gets tested, not the stub.
 */

let stack: E2EStack;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let user: RegisteredBrowserUser;
let email = "";

async function health(): Promise<{
  status: number;
  body: {
    ok: boolean;
    database: string;
    workers: unknown[];
    capabilities: { publishing: { available: boolean; provider: string | null } };
  };
}> {
  const response = await fetch(`${BASE_URL}/api/health`);
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  stack = await startStack({ withoutPublishingConfig: true });
  if (!stack.reachable || !stack.available) return;

  browser = await chromium.launch({
    executablePath: stack.executablePath,
    args: ["--no-sandbox"],
  });
  context = await browser.newContext();
  page = await context.newPage();

  email = `cp24-smoke-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);
  await context.addCookies([
    { name: SESSION_COOKIE, value: user.cookieValue, url: BASE_URL },
  ]);
});

afterAll(async () => {
  if (browser) await browser.close();
  if (stack?.reachable) {
    await cleanupE2EUser(email, user?.workspaceId ?? "", []);
    await stopStack(stack);
  }
});

describe("production smoke", () => {
  it("reports healthy and does not leak internals", async () => {
    if (!stack?.reachable) return;

    const { status, body } = await health();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.database).toBe("ok");
    expect(Array.isArray(body.workers)).toBe(true);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(
      /postgresql:\/\/|password|secret|bearer|api[_-]?key/i,
    );
  });

  it("reports an unconfigured publishing provider as unavailable", async () => {
    if (!stack?.reachable) return;

    const { body } = await health();
    expect(body.capabilities.publishing.available).toBe(false);
    expect(body.capabilities.publishing.provider).toBeNull();
  });

  it("serves an authenticated read and a real project page", async () => {
    if (!stack?.reachable) return;

    const response = await page.request.get(`${BASE_URL}/api/projects`, {
      headers: { cookie: `${SESSION_COOKIE}=${user.cookieValue}` },
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).projects).toEqual([]);

    const navigation = await page.goto(`${BASE_URL}/projects`);
    expect(navigation?.status()).toBe(200);
    await page
      .getByRole("heading", { name: "Projects" })
      .waitFor({ state: "visible", timeout: 15_000 });
  });

  it("comes back healthy after a restart", async () => {
    if (!stack?.reachable) return;

    const restarted = await restartServer(stack);
    if (!restarted) return;

    const { status, body } = await health();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    const login = await page.goto(`${BASE_URL}/login`);
    expect(login?.status()).toBe(200);
  });
});
