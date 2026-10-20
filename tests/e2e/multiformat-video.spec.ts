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
 * Real browser proof of CP19 video adaptation, end to end through FFmpeg.
 *
 * CP19 does not encode anything: it re-frames a CP14 composition and hands CP15 a
 * renderer contract. So this spec starts both workers, waits for a real MP4 to
 * appear in CP15's storage, and checks that the variant finished rather than
 * pretending a render happened.
 */

type Services = typeof import("../../src/infrastructure/services");

let stack: E2EStack;
let services: Services;
let user: RegisteredBrowserUser;
let browser: Browser;
let context: BrowserContext;
const projectIds: string[] = [];
let email = "";
let compositionId = "";

async function seedComposition(): Promise<void> {
  const project = await services.projectService.createForWorkspace(
    user.workspaceId,
    { name: "CP19 E2E video" },
    user.userId,
  );
  projectIds.push(project.id);

  const composition = await services.visualCompositionService.createComposition({
    projectId: project.id,
    userId: user.userId,
    name: "Source composition",
    width: 1920,
    height: 1080,
    frameRate: 30,
    durationMs: 1000,
  });

  await services.visualLayerService.addLayer({
    projectId: project.id,
    userId: user.userId,
    compositionId: composition.id,
    name: "Backdrop",
    type: "SHAPE",
    assetRef: null,
    textContent: null,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    rotation: 0,
    opacity: 1,
    fit: "COVER",
    cropX: 0,
    cropY: 0,
    cropWidth: null,
    cropHeight: null,
    zIndex: 0,
    visible: true,
  });

  compositionId = composition.id;
}

type BatchBody = {
  batch: { id: string; status: string; progressPct: number };
  jobs: Array<{
    id: string;
    status: string;
    renderJobId: string | null;
    outputMimeType: string | null;
    outputWidth: number | null;
    outputHeight: number | null;
    errorCode: string | null;
  }>;
};

async function readBatch(page: Page, batchId: string): Promise<BatchBody> {
  const response = await page.request.get(
    `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches/${batchId}`,
  );

  expect(response.status()).toBe(200);

  return (await response.json()) as BatchBody;
}

beforeAll(async () => {
  stack = await startStack({ withRenderWorker: true, withMultiformatWorker: true });
  if (!stack.reachable || !stack.available) return;

  services = await import("../../src/infrastructure/services");

  email = `cp19-video-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);

  browser = await chromium.launch({
    executablePath: stack.executablePath,
    args: ["--no-sandbox"],
  });
  context = await browser.newContext();
  await context.addCookies([
    { name: SESSION_COOKIE, value: user.cookieValue, url: BASE_URL },
  ]);

  await seedComposition();
});

afterAll(async () => {
  if (browser) await browser.close();
  await stopStack(stack);
  if (user) await cleanupE2EUser(email, user.workspaceId, projectIds);
});

describe("video adaptation end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("parks the job on a real CP15 render and finishes it", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();

    const created = await page.request.post(
      `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches`,
      {
        data: {
          sourceType: "VISUAL_COMPOSITION",
          sourceId: compositionId,
          targets: [{ formatId: "VIDEO_VERTICAL" }],
        },
      },
    );

    expect(created.status()).toBe(201);

    const batchId = ((await created.json()) as { batch: { id: string } }).batch.id;

    // The variant must actually reach a terminal state through the real renderer,
    // not merely be accepted.
    await expect
      .poll(async () => (await readBatch(page, batchId)).batch.status, {
        timeout: 180_000,
        interval: 500,
      })
      .toBe("SUCCEEDED");

    const finished = await readBatch(page, batchId);
    const job = finished.jobs[0]!;

    expect(job.renderJobId).toBeTruthy();
    expect(job.outputMimeType).toContain("mp4");
    expect(job.outputWidth).toBe(1080);
    expect(job.outputHeight).toBe(1920);
    expect(finished.batch.progressPct).toBe(100);

    await page.close();
  });

  it("streams the finished variant as CP15's own bytes", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();

    const created = await page.request.post(
      `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/batches`,
      {
        data: {
          sourceType: "VISUAL_COMPOSITION",
          sourceId: compositionId,
          targets: [{ formatId: "VIDEO_SQUARE" }],
        },
      },
    );

    const batchId = ((await created.json()) as { batch: { id: string } }).batch.id;

    await expect
      .poll(async () => (await readBatch(page, batchId)).batch.status, {
        timeout: 180_000,
        interval: 500,
      })
      .toBe("SUCCEEDED");

    const finished = await readBatch(page, batchId);
    const response = await page.request.get(
      `${BASE_URL}/api/projects/${projectIds[0]}/multiformat/jobs/${finished.jobs[0]!.id}/stream`,
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("mp4");

    const bytes = Buffer.from(await response.body());

    // An MP4 carries an `ftyp` box at its head; a stub or an HTML error page would
    // not.
    expect(bytes.byteLength).toBeGreaterThan(1024);
    expect(bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");

    await page.close();
  });
});
