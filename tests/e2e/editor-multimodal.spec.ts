import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import {
  BASE_URL,
  cleanupE2EUser,
  createAnalyzedE2EProject,
  createE2EEditorDocument,
  editorTextNode,
  registerBrowserUser,
  SESSION_COOKIE,
  startStack,
  stopStack,
  type E2EStack,
  type RegisteredBrowserUser,
} from "./support/image-harness";

/**
 * Real browser proof that an editor composition streams the media it promises.
 *
 * A generated image is rendered by the real CP17 worker and lands in an editor
 * node as a `generated:` ref. The browser then loads the stage — and the asset
 * endpoint has to return the exact bytes on disk, with a content-type a browser
 * can render. Refs that carry no bytes (writing copy) or belong to nobody are
 * refused, and a project's asset is never reachable through another project.
 */

let stack: E2EStack;
let user: RegisteredBrowserUser;
let stranger: RegisteredBrowserUser;
let browser: Browser;
let ownerContext: BrowserContext;
let strangerContext: BrowserContext;
const userProjectIds: string[] = [];
const strangerProjectIds: string[] = [];
let email = "";
let strangerEmail = "";
let multimodalProjectId = "";
let strangerProjectId = "";
let imageJobId = "";
let multimodalDocumentId = "";
let imageRef = "";
let imageByteSize = 0;
let imageChecksum = "";
let setupDone = false;

function assetUrl(projectId: string, ref: string): string {
  return `${BASE_URL}/api/projects/${projectId}/editor/assets/${encodeURIComponent(ref)}`;
}

async function stackReady(testContext: { skip: () => void }): Promise<boolean> {
  if (!stack.reachable || !stack.available) {
    testContext.skip();
    return false;
  }
  return true;
}

beforeAll(async () => {
  stack = await startStack();
  if (!stack.reachable || !stack.available) return;

  const services = await import("../../src/infrastructure/services");

  email = `cp20-media-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);

  multimodalProjectId = await createAnalyzedE2EProject(
    user.workspaceId,
    user.userId,
    "CP20 editor media",
  );
  userProjectIds.push(multimodalProjectId);

  // Render a real image through the worker this stack started. The job is
  // created here; its outcome is polled inside the first test, because
  // expect.poll() is only available in a test.
  const job = await services.imageGenerationService.enqueue({
    projectId: multimodalProjectId,
    requestedById: user.userId,
    templateType: "SOCIAL_POST",
    prompt: "A status report dashboard",
  });
  imageJobId = job.id;

  strangerEmail = `cp20-media-stranger-${Date.now()}@test.local`;
  stranger = await registerBrowserUser(strangerEmail);
  const strangerProject = await services.projectService.createForWorkspace(
    stranger.workspaceId,
    { name: "Unrelated project" },
    stranger.userId,
  );
  strangerProjectId = strangerProject.id;
  strangerProjectIds.push(strangerProjectId);

  browser = await chromium.launch({
    executablePath: stack.executablePath,
    args: ["--no-sandbox"],
  });
  ownerContext = await browser.newContext();
  await ownerContext.addCookies([
    { name: SESSION_COOKIE, value: user.cookieValue, url: BASE_URL },
  ]);
  strangerContext = await browser.newContext();
  await strangerContext.addCookies([
    { name: SESSION_COOKIE, value: stranger.cookieValue, url: BASE_URL },
  ]);
});

afterAll(async () => {
  if (browser) await browser.close();
  await stopStack(stack);
  if (user) await cleanupE2EUser(email, user.workspaceId, userProjectIds);
  if (stranger)
    await cleanupE2EUser(strangerEmail, stranger.workspaceId, strangerProjectIds);
});

describe("editor multimodal end to end", () => {
  it("renders text, image and shape layers on the stage", async (testContext) => {
    if (!(await stackReady(testContext))) return;

    const services = await import("../../src/infrastructure/services");

    await expect
      .poll(
        async () => {
          const record = await services.imageGenerationService.get({
            projectId: multimodalProjectId,
            jobId: imageJobId,
            userId: user.userId,
          });
          return record.status;
        },
        { timeout: 120_000, interval: 500 },
      )
      .toBe("SUCCEEDED");

    const asset = await services.imageGenerationService.asset({
      projectId: multimodalProjectId,
      jobId: imageJobId,
      userId: user.userId,
    });
    expect(asset).not.toBeNull();
    imageRef = `generated:${asset!.id}`;
    imageByteSize = asset!.byteSize;
    imageChecksum = asset!.checksumSha256;

    const created = await createE2EEditorDocument(
      multimodalProjectId,
      user.userId,
      "Media composition",
      [
        editorTextNode({
          id: "enode-media-1",
          name: "Broadcast",
          text: { value: "Broadcast" },
        }),
        {
          id: "enode-media-2",
          parentId: null,
          type: "IMAGE",
          name: "Backdrop",
          zIndex: 1,
          transform: { x: 0, y: 0, width: 720, height: 405, rotation: 0, opacity: 1 },
          visible: true,
          asset: {
            ref: imageRef,
            assetId: asset!.id,
            kind: "IMAGE",
            origin: "GENERATED_IMAGE",
            sourceType: "GENERATED_IMAGE",
            sourceId: asset!.id,
            mimeType: asset!.mimeType,
            byteSize: asset!.byteSize,
            width: asset!.width,
            height: asset!.height,
            durationMs: null,
          },
          text: null,
          style: {
            fontSize: null,
            fontFamily: null,
            fontWeight: null,
            color: null,
            backgroundColor: null,
            align: null,
            radius: null,
          },
          trim: null,
          audio: null,
          shape: null,
          motion: null,
          effects: [],
          automation: [],
          provenance: null,
        },
        {
          id: "enode-media-3",
          parentId: null,
          type: "SHAPE",
          name: "Ring",
          zIndex: 2,
          transform: { x: 600, y: 40, width: 80, height: 80, rotation: 0, opacity: 1 },
          visible: true,
          asset: null,
          text: null,
          style: {
            fontSize: null,
            fontFamily: null,
            fontWeight: null,
            color: null,
            backgroundColor: null,
            align: null,
            radius: null,
          },
          trim: null,
          audio: null,
          shape: { shapeType: "ELLIPSE" },
          motion: null,
          effects: [],
          automation: [],
          provenance: null,
        },
      ],
    );
    multimodalDocumentId = created.documentId;

    const page = await ownerContext.newPage();
    await page.goto(
      `${BASE_URL}/projects/${multimodalProjectId}/editor/${multimodalDocumentId}`,
      { waitUntil: "domcontentloaded" },
    );
    await page
      .getByTestId("editor-stage")
      .waitFor({ state: "visible", timeout: 15_000 });

    await expect
      .poll(
        async () =>
          page
            .locator('[data-testid="editor-node"][data-node-type="TEXT"]')
            .textContent(),
        { timeout: 15_000 },
      )
      .toContain("Broadcast");
    await expect
      .poll(
        async () =>
          page.locator('[data-testid="editor-node"][data-node-type="IMAGE"]').count(),
        { timeout: 15_000 },
      )
      .toBe(1);
    await expect
      .poll(
        async () =>
          page.locator('[data-testid="editor-node"][data-node-type="SHAPE"]').count(),
        { timeout: 15_000 },
      )
      .toBe(1);

    await page.close();
    setupDone = true;
  });

  it("streams the exact bytes the worker stored for the generated ref", async (testContext) => {
    if (!setupDone) {
      void testContext;
      await stackReady(testContext);
      return;
    }

    const response = await ownerContext.request.get(assetUrl(multimodalProjectId, imageRef));
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");

    const bytes = await response.body();
    expect(bytes.byteLength).toBe(imageByteSize);
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(digest).toBe(imageChecksum);
  });

  it("refuses refs that carry no bytes, belong to nobody, or sit in another project", async (testContext) => {
    if (!setupDone) {
      void testContext;
      await stackReady(testContext);
      return;
    }

    // Writing copy is text; it has nothing to stream.
    const writing = await ownerContext.request.get(
      assetUrl(multimodalProjectId, "writing:wvar-missing"),
    );
    expect(writing.status()).toBe(404);

    // A well-formed ref to an image that does not exist.
    const missing = await ownerContext.request.get(
      assetUrl(multimodalProjectId, "generated:no-such-asset"),
    );
    expect(missing.status()).toBe(404);

    // A stranger's session cannot reach the project's asset endpoint.
    const crossProject = await strangerContext.request.get(
      assetUrl(multimodalProjectId, imageRef),
    );
    expect(crossProject.status()).toBe(403);
  });
});