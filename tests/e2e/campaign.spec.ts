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
 * Real browser proof of CP21 campaign planning.
 *
 * The campaign is created, planned, scheduled, sent for review, approved and
 * assembled through the actual UI, against a real Next.js server and Postgres
 * database. The exported launch kit is the same JSON the API serves, so a kit
 * that never assembled in the browser cannot pass by reading the route directly.
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

  const servicesModule = await import("../../src/infrastructure/services");
  services = servicesModule;

  email = `cp21-campaign-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);

  const project = await services.projectService.createForWorkspace(
    user.workspaceId,
    { name: "CP21 campaign launch" },
    user.userId,
  );
  projectIds.push(project.id);

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

describe("campaign launch kit end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("plans, reviews, approves and assembles a campaign in the browser", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${user.workspaceId ? user.workspaceId : ""}`, {
      waitUntil: "domcontentloaded",
    });

    await page.goto(`${BASE_URL}/projects/${projectIds[0]}/campaigns`, {
      waitUntil: "domcontentloaded",
    });

    await page
      .getByTestId("campaign-name")
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("campaign-name").fill("Northwind launch");
    await page.getByTestId("campaign-objective").fill("Drive 500 sign-ups");
    await page.getByTestId("campaign-audience").fill("Regulated teams");
    await page
      .getByTestId("campaign-key-message")
      .fill("Ship content without a legal bottleneck");
    await page.getByTestId("create-campaign").click();

    await page
      .getByTestId("campaign-status")
      .waitFor({ state: "visible", timeout: 15_000 });

    await expect
      .poll(async () => page.getByTestId("campaign-status").textContent(), {
        timeout: 15_000,
      })
      .toContain("DRAFT");

    await page.getByTestId("plan-campaign").click();
    await expect
      .poll(async () => page.getByTestId("campaign-status").textContent(), {
        timeout: 15_000,
      })
      .toBe("PLANNED");

    // A plan materialised real deliverables, so the schedule control is live.
    await page.getByTestId("deliverable-row").first().waitFor({
      state: "visible",
      timeout: 15_000,
    });

    await page.getByTestId("schedule-campaign").click();

    await page.getByTestId("submit-review").click();
    await expect
      .poll(async () => page.getByTestId("campaign-status").textContent(), {
        timeout: 15_000,
      })
      .toBe("IN_REVIEW");

    await page.getByTestId("approve-campaign").click();
    await expect
      .poll(async () => page.getByTestId("campaign-status").textContent(), {
        timeout: 15_000,
      })
      .toBe("APPROVED");

    await page.getByTestId("assemble-campaign").click();
    await expect
      .poll(
        async () => page.getByTestId("export-campaign").getAttribute("class"),
        { timeout: 15_000 },
      )
      .not.toContain("pointer-events-none");

    await page
      .getByTestId("readiness-check")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });

    await page.close();
  });

  it("exports the assembled kit as canonical, non-leaking JSON", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${projectIds[0]}/campaigns`, {
      waitUntil: "domcontentloaded",
    });

    const href = await page
      .getByTestId("campaign-row")
      .first()
      .getAttribute("data-campaign-id");
    const campaignId = href!;

    // A campaign that has never been assembled refuses the export.
    const second = await page.request.post(
      `${BASE_URL}/api/projects/${projectIds[0]}/campaigns`,
      {
        data: {
          name: "Unassembled",
          objective: "Prove the guard",
          audienceSummary: "Nobody yet",
          keyMessage: "Nothing ships without a kit",
        },
      },
    );
    expect(second.status()).toBe(201);
    const secondId = ((await second.json()) as { campaign: { id: string } })
      .campaign.id;

    const refused = await page.request.get(
      `${BASE_URL}/api/projects/${projectIds[0]}/campaigns/${secondId}/export`,
    );
    expect(refused.status()).toBe(409);
    const refusedBody = (await refused.json()) as { code?: string };
    expect(refusedBody.code).toBe("CAMPAIGN_LAUNCH_KIT_NOT_ASSEMBLED");

    const response = await page.request.get(
      `${BASE_URL}/api/projects/${projectIds[0]}/campaigns/${campaignId}/export`,
    );
    expect(response.status()).toBe(200);

    const text = await response.text();
    expect(text).not.toContain("/home/");
    expect(text).not.toContain("secretPath");

    const document = JSON.parse(text) as {
      schema: string;
      version: number;
      launchKit: { campaign: { id: string } };
    };
    expect(document.schema).toBe("content-os.campaign-launch-kit");
    expect(document.version).toBe(1);
    expect(document.launchKit.campaign.id).toBe(campaignId);

    await page.close();
  });
});
