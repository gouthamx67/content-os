import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
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
 * Real browser proof of CP19 image adaptation.
 *
 * A variant has to be real pixels at the format's exact size, not a resized
 * thumbnail: the spec downloads the artifact and measures it.
 */

type Services = typeof import("../../src/infrastructure/services");

let stack: E2EStack;
let services: Services;
let user: RegisteredBrowserUser;
let browser: Browser;
let context: BrowserContext;
const projectIds: string[] = [];
let email = "";
let assetId = "";

async function seedImage(): Promise<void> {
  const sharp = (await import("sharp")).default;
  const { imageStorage } = await import(
    "../../src/modules/image-generation/storage/image-storage"
  );

  const project = await services.projectService.createForWorkspace(
    user.workspaceId,
    { name: "CP19 E2E image" },
    user.userId,
  );
  projectIds.push(project.id);

  const bytes = await sharp({
    create: {
      width: 1400,
      height: 900,
      channels: 4,
      background: { r: 32, g: 96, b: 160, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const storageKey = `${project.id}/${user.userId}/source.png`;
  await imageStorage.putBytes(storageKey, bytes);

  const asset = await services.imageRepository.createAsset({
    id: `img-${Date.now()}`,
    projectId: project.id,
    generationJobId: null,
    graphicDocumentId: null,
    storageKey,
    mimeType: "image/png",
    outputFormat: "PNG",
    width: 1400,
    height: 900,
    byteSize: bytes.byteLength,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    transparent: false,
    metadata: null,
    createdAt: new Date().toISOString(),
  });

  assetId = asset.id;
}

async function adapt(
  page: Page,
  formatId: string,
): Promise<{ id: string; status: string }> {
  const response = await page.request.post(
    `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches`,
    {
      data: {
        sourceType: "GENERATED_IMAGE",
        sourceId: assetId,
        targets: [{ formatId }],
      },
    },
  );

  expect(response.status()).toBe(201);

  const batchId = ((await response.json()) as { batch: { id: string } }).batch.id;

  await expect
    .poll(
      async () => {
        const detail = await page.request.get(
          `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches/${batchId}`,
        );
        const body = (await detail.json()) as { batch: { status: string } };
        return body.batch.status;
      },
      { timeout: 60_000 },
    )
    .toBe("SUCCEEDED");

  const detail = await page.request.get(
    `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches/${batchId}`,
  );
  const body = (await detail.json()) as {
    jobs: Array<{ id: string; status: string }>;
  };

  return body.jobs[0]!;
}

async function download(
  page: Page,
  jobId: string,
): Promise<Buffer> {
  const response = await page.request.get(
    `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/jobs/${jobId}/stream`,
  );

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/png");

  return Buffer.from(await response.body());
}

beforeAll(async () => {
  stack = await startStack({ withMultiformatWorker: true });
  if (!stack.reachable || !stack.available) return;

  services = await import("../../src/infrastructure/services");

  email = `cp19-image-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);

  browser = await chromium.launch({
    executablePath: stack.executablePath,
    args: ["--no-sandbox"],
  });
  context = await browser.newContext();
  await context.addCookies([
    { name: SESSION_COOKIE, value: user.cookieValue, url: BASE_URL },
  ]);

  await seedImage();
});

afterAll(async () => {
  if (browser) await browser.close();
  stopStack(stack);
  if (user) await cleanupE2EUser(email, user.workspaceId, projectIds);
});

describe("image adaptation end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("crops a wide source to an exact square", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    const job = await adapt(page, "IMAGE_SQUARE");
    const bytes = await download(page, job.id);

    const metadata = await (await import("sharp")).default(bytes).metadata();

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1080);

    await page.close();
  });

  it("crops a wide source to a vertical cut", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    const job = await adapt(page, "IMAGE_VERTICAL");
    const bytes = await download(page, job.id);

    const metadata = await (await import("sharp")).default(bytes).metadata();

    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1920);

    await page.close();
  });

  it("offers the variants in the workspace with a download", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    await adapt(page, "IMAGE_LANDSCAPE");

    await page.goto(`${BASE_URL}/projects/${projectIds[0]}/multiformat`, {
      waitUntil: "domcontentloaded",
    });

    await page
      .getByRole("link", { name: "Download" })
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });

    await page.close();
  });
});
