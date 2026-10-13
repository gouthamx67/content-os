import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import {
  BASE_URL,
  cleanupE2EUser,
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
 * Real browser proof of the CP20 editing loop.
 *
 * The document is created through the list page, a layer is edited through the
 * inspector, the autosave is real HTTP (wait for "Saved", not a mocked store),
 * and a reload must reproduce exactly what the server persisted. Finalising is
 * a server decision, so it survives a reload too.
 */

let stack: E2EStack;
let user: RegisteredBrowserUser;
let browser: Browser;
let context: BrowserContext;
const projectIds: string[] = [];
let email = "";
let editsProjectId = "";

beforeAll(async () => {
  stack = await startStack();
  if (!stack.reachable || !stack.available) return;

  const services = await import("../../src/infrastructure/services");

  email = `cp20-editor-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);

  const project = await services.projectService.createForWorkspace(
    user.workspaceId,
    { name: "CP20 editor edit" },
    user.userId,
  );
  projectIds.push(project.id);
  editsProjectId = project.id;

  await createE2EEditorDocument(
    project.id,
    user.userId,
    "Launch edit",
    [editorTextNode({ name: "Headline" })],
  );

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

describe("editor end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("creates an edit and opens an empty workspace", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${editsProjectId}/editor`, {
      waitUntil: "domcontentloaded",
    });

    await page
      .getByTestId("editor-name")
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("editor-name").fill("Second edit");
    await page.getByTestId("create-editor-document").click();

    await page
      .getByTestId("editor-stage")
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("editor-layer").waitFor({ state: "hidden" });

    // The empty document has no layers, and the header repeats its name.
    await page.getByText("Second edit").first().waitFor({
      state: "visible",
      timeout: 15_000,
    });

    await page.close();
  });

  it("lists the seeded edit on the editor home", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${editsProjectId}/editor`, {
      waitUntil: "domcontentloaded",
    });

    await page
      .getByTestId("editor-document")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.getByText("Launch edit").first().waitFor({
      state: "visible",
      timeout: 15_000,
    });

    await page.close();
  });

  it("saves an edit through the inspector and reloads without losing it", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${editsProjectId}/editor`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByTestId("editor-document")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    const launch = page
      .getByTestId("editor-document")
      .filter({ hasText: "Launch edit" });
    await launch.waitFor({ state: "visible", timeout: 15_000 });
    await launch.click();

    await page
      .getByTestId("editor-stage")
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("editor-layer").first().click();

    const text = page.getByTestId("editor-inspector-text");
    await text.waitFor({ state: "visible", timeout: 15_000 });
    expect(await text.inputValue()).toBe("Draft headline");

    await text.fill("Ready for launch");
    await expect
      .poll(
        async () =>
          page.getByTestId("editor-save-state").textContent(),
        { timeout: 15_000 },
      )
      .toBe("Saved");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByTestId("editor-stage")
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("editor-layer").first().click();
    await page
      .getByTestId("editor-inspector-text")
      .waitFor({ state: "visible", timeout: 15_000 });

    // What the reload shows is what the server persisted.
    expect(await page.getByTestId("editor-inspector-text").inputValue()).toBe(
      "Ready for launch",
    );

    await page.close();
  });

  it("finalises the document and stays ready across a reload", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${editsProjectId}/editor`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByTestId("editor-document")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    const launch = page
      .getByTestId("editor-document")
      .filter({ hasText: "Launch edit" });
    await launch.waitFor({ state: "visible", timeout: 15_000 });
    await launch.click();
    await page
      .getByTestId("editor-stage")
      .waitFor({ state: "visible", timeout: 15_000 });

    const finalize = page.getByTestId("editor-finalize-button");
    await finalize.click();
    await expect
      .poll(
        async () =>
          finalize.evaluate((el) => (el as HTMLButtonElement).disabled),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect
      .poll(async () => finalize.textContent(), { timeout: 15_000 })
      .toMatch(/Finalised/);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByTestId("editor-stage")
      .waitFor({ state: "visible", timeout: 15_000 });
    await expect
      .poll(
        async () =>
          page
            .getByTestId("editor-finalize-button")
            .evaluate((el) => (el as HTMLButtonElement).disabled),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect
      .poll(
        async () =>
          page.getByTestId("editor-finalize-button").textContent(),
        { timeout: 15_000 },
      )
      .toMatch(/Finalised/);

    await page.close();
  });

  it("renders a group, hides a hidden layer, and still lists it in the tree", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    await createE2EEditorDocument(
      editsProjectId,
      user.userId,
      "Grouped edit",
      [
        editorTextNode({ id: "enode-group", type: "GROUP", name: "Hero", text: null }),
        editorTextNode({
          id: "enode-hidden",
          parentId: "enode-group",
          name: "Hidden caption",
          zIndex: 1,
          visible: false,
        }),
      ],
    );

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${editsProjectId}/editor`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByTestId("editor-document")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    const grouped = page
      .getByTestId("editor-document")
      .filter({ hasText: "Grouped edit" });
    await grouped.waitFor({ state: "visible", timeout: 15_000 });
    await grouped.click();

    await page
      .getByTestId("editor-stage")
      .waitFor({ state: "visible", timeout: 15_000 });

    // The group is drawn on the canvas.
    await expect
      .poll(
        async () =>
          page.locator('[data-testid="editor-node"][data-node-type="GROUP"]').count(),
        { timeout: 15_000 },
      )
      .toBe(1);

    // A hidden layer is absent from the canvas...
    expect(
      await page.locator('[data-testid="editor-node"][data-node-id="enode-hidden"]').count(),
    ).toBe(0);

    // ...but its row still exists in the tree, nested under the group.
    const hiddenRow = page.locator(
      '[data-testid="editor-layer"][data-node-id="enode-hidden"]',
    );
    await hiddenRow.waitFor({ state: "visible", timeout: 15_000 });
    expect(await hiddenRow.getAttribute("data-depth")).toBe("1");

    await page.close();
  });

  it("scrubs the timeline playhead", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    await createE2EEditorDocument(editsProjectId, user.userId, "Timed edit", [
      editorTextNode({ id: "enode-timed", name: "Timeline layer" }),
    ]);

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/projects/${editsProjectId}/editor`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByTestId("editor-document")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    const timed = page
      .getByTestId("editor-document")
      .filter({ hasText: "Timed edit" });
    await timed.waitFor({ state: "visible", timeout: 15_000 });
    await timed.click();

    await page
      .getByTestId("editor-stage")
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("editor-tab-timeline").click();

    const scrubber = page.getByTestId("editor-timeline-scrubber");
    await scrubber.waitFor({ state: "visible", timeout: 15_000 });
    const playhead = page.getByTestId("editor-playhead");

    await expect
      .poll(
        async () => page.getByTestId("editor-timeline-time").textContent(),
        { timeout: 15_000 },
      )
      .toBe("0 ms");
    expect(await playhead.evaluate((el) => (el as HTMLElement).style.left)).toBe(
      "0%",
    );

    // Scrubbing moves both the readout and the playhead to the same position.
    await scrubber.fill("12000");
    await expect
      .poll(
        async () => page.getByTestId("editor-timeline-time").textContent(),
        { timeout: 15_000 },
      )
      .toBe("12000 ms");
    await expect
      .poll(
        async () => playhead.evaluate((el) => (el as HTMLElement).style.left),
        { timeout: 15_000 },
      )
      .toBe("80%");

    await page.close();
  });

  it("previews a past revision and restores it by appending", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const services = await import("../../src/infrastructure/services");
    const created = await createE2EEditorDocument(
      editsProjectId,
      user.userId,
      "History edit",
      [editorTextNode({ id: "enode-hist", name: "Headline" })],
    );

    // A real second revision, written through the engine, on top of the seed.
    const edited = await services.editorService.applyOperation({
      projectId: editsProjectId,
      userId: user.userId,
      documentId: created.documentId,
      baseRevision: created.revisionId,
      operation: { type: "SET_TEXT", nodeId: "enode-hist", value: "Edited once" },
    });

    const page = await context.newPage();
    await page.goto(
      `${BASE_URL}/projects/${editsProjectId}/editor/${created.documentId}`,
      { waitUntil: "domcontentloaded" },
    );
    await page
      .getByTestId("editor-stage")
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("editor-tab-history").click();

    const firstRow = page
      .getByTestId("editor-history-item")
      .filter({ hasText: "#1 ·" });
    await firstRow.waitFor({ state: "visible", timeout: 15_000 });

    // Previewing the first revision must show its bytes without changing head.
    await firstRow.getByTestId("editor-history-preview").click();
    await page
      .getByTestId("editor-preview-banner")
      .waitFor({ state: "visible", timeout: 15_000 });
    await expect
      .poll(
        async () => page.getByTestId("editor-preview-banner").textContent(),
        { timeout: 15_000 },
      )
      .toContain("revision 1");

    const staged = page
      .locator('[data-testid="editor-node"][data-node-type="TEXT"]')
      .first();
    await expect
      .poll(async () => staged.textContent(), { timeout: 15_000 })
      .toContain("Draft headline");

    // The head is still revision 2 while a preview is open.
    const duringPreview = await page.request.get(
      `${BASE_URL}/api/projects/${editsProjectId}/editor/${created.documentId}/history`,
    );
    expect(duringPreview.status()).toBe(200);
    const duringBody = (await duringPreview.json()) as {
      document: { currentRevisionId: string };
      revisions: Array<{ id: string }>;
    };
    expect(duringBody.document.currentRevisionId).toBe(edited.revision.id);
    expect(duringBody.revisions.length).toBe(2);

    await page.getByTestId("editor-preview-exit").click();
    await page.getByTestId("editor-preview-banner").waitFor({ state: "hidden" });
    await expect
      .poll(
        async () =>
          page
            .locator('[data-testid="editor-node"][data-node-type="TEXT"]')
            .first()
            .textContent(),
        { timeout: 15_000 },
      )
      .toContain("Edited once");

    // Restoring the first revision appends a third revision; the revision it
    // restores from is untouched.
    await firstRow.getByTestId("editor-history-restore").click();
    await expect
      .poll(
        async () => page.getByTestId("editor-save-state").textContent(),
        { timeout: 15_000 },
      )
      .toBe("Saved");
    await expect
      .poll(
        async () =>
          page
            .locator('[data-testid="editor-node"][data-node-type="TEXT"]')
            .first()
            .textContent(),
        { timeout: 15_000 },
      )
      .toContain("Draft headline");

    const afterRestore = await page.request.get(
      `${BASE_URL}/api/projects/${editsProjectId}/editor/${created.documentId}/history`,
    );
    const afterBody = (await afterRestore.json()) as {
      revisions: Array<{ id: string; restoredFromRevisionId: string | null }>;
    };
    expect(afterBody.revisions.length).toBe(3);
    expect(afterBody.revisions[0]?.restoredFromRevisionId).toBe(created.revisionId);

    const original = await page.request.get(
      `${BASE_URL}/api/projects/${editsProjectId}/editor/${created.documentId}/revisions/${created.revisionId}`,
    );
    const originalBody = (await original.json()) as {
      snapshot: { nodes: Array<{ id: string; text: { value: string } | null }> };
    };
    expect(
      originalBody.snapshot.nodes.find((node) => node.id === "enode-hist")?.text
        ?.value,
    ).toBe("Draft headline");

    await page.close();
  });
});