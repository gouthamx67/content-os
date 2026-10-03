import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { hashRecipe } from "../../src/modules/image-generation/serialization/hash-recipe";
import {
  BASE_URL,
  cleanupE2EUser,
  registerBrowserUser,
  repoRoot,
  SESSION_COOKIE,
  startStack,
  stopStack,
  type E2EStack,
  type RegisteredBrowserUser,
} from "./support/image-harness";

/**
 * Real end-to-end proof of the whole CP17 path through the browser.
 *
 * A project that has been analysed (so brand and intelligence are live) is driven
 * through the UI to a rendered image. The test then goes around the UI and reads
 * the database and the filesystem directly: the recipe snapshot must carry the
 * analysed brand, the stored checksum must equal the bytes on disk, and a reload
 * must still show the image. That is the difference between "a request was
 * accepted" and "an artifact exists".
 */

type Services = typeof import("../../src/infrastructure/services");

const BRAND_BRIEF = [
  "Northwind Analytics is the content operating system for regulated teams.",
  "Primary color: #1D4ED8",
  "Write in plain, direct sentences.",
].join("\n");

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

  email = `cp17-full-${Date.now()}@test.local`;
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

describe("image generation full path end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("persists a real artifact whose recipe carries the analysed context", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const project = await services.projectService.createForWorkspace(
      user.workspaceId,
      { name: "CP17 E2E full path" },
      user.userId,
    );
    projectIds.push(project.id);

    await services.inputService.createBatch(project.id, user.userId, [
      { type: "text", name: "Brand brief", value: BRAND_BRIEF },
    ]);
    await services.intelligenceService.analyze(project.id, user.userId, {});
    await services.brandService.analyze(project.id, user.userId);

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
      .fill("Announce the weekly status export");
    await page.getByTestId("generate-image-button").click();

    await expect
      .poll(
        async () => {
          const item = page.getByTestId("generated-image-item").first();
          return (await item.count()) > 0;
        },
        { timeout: 90_000, interval: 500 },
      )
      .toBe(true);
    await page.getByTestId("generated-image-item").first().click();
    await page
      .getByTestId("generated-asset-ref")
      .waitFor({ state: "visible", timeout: 15_000 });
    const generatedRef = await page
      .getByTestId("generated-asset-ref")
      .inputValue();
    const assetId = generatedRef.replace(/^generated:/, "");
    expect(assetId.length).toBeGreaterThan(0);

    // Reload to prove persistence, not in-memory state.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByTestId("image-generation-workspace")
      .waitFor({ state: "visible", timeout: 30_000 });
    await expect
      .poll(async () => page.getByTestId("generated-image-item").count(), {
        timeout: 20_000,
        interval: 500,
      })
      .toBeGreaterThan(0);
    await page.getByTestId("generated-image-item").first().click();
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

    // Direct database read: the recipe snapshot and its hash.
    const { db } = await import("../../src/prisma/db");
    const orm = db.orm.public;

    const assetRow = await orm.GeneratedImageAsset.where({
      id: assetId,
      projectId: project.id,
    }).first();
    expect(assetRow).not.toBeNull();

    const jobRow = await orm.ImageGenerationJob.where({
      id: assetRow!.generationJobId as string,
    }).first();
    expect(jobRow).not.toBeNull();

    const recipe = JSON.parse(jobRow!.generationRecipe as string) as {
      context: { projectId: string; brand: { version: number | null } };
    };
    expect(recipe.context.projectId).toBe(project.id);
    expect(recipe.context.brand.version).not.toBeNull();
    expect(jobRow!.recipeSha256).toBe(hashRecipe(recipe));

    // Direct filesystem read: the checksum must be the bytes on disk.
    const fileBytes = await readFile(
      path.join(repoRoot, ".content-os", "images", assetRow!.storageKey as string),
    );
    const digest = createHash("sha256").update(fileBytes).digest("hex");
    expect(digest).toBe(assetRow!.checksumSha256);
    expect(fileBytes.subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );

    // The generated ref resolves for downstream consumers.
    const { resolveAssetRef } = await import(
      "../../src/modules/visual-motion-engine/integrations/capture-take"
    );
    const resolved = await resolveAssetRef(project.id, generatedRef);
    expect(resolved.kind).toBe("generated");

    expect(consoleErrors).toEqual([]);
    await page.close();
  }, 150_000);
});
