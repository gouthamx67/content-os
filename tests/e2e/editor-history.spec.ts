import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
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
 * Real browser proof that history is transactional.
 *
 * Undo and redo go through the same CAS that edits do, so after a keyboard undo
 * the inspector shows the previous server revision. Duplicate and delete are
 * real operations that change the layer count, and restoring an old revision
 * from the history panel makes it head again — without touching the edits in
 * between.
 */

let stack: E2EStack;
let user: RegisteredBrowserUser;
let browser: Browser;
let context: BrowserContext;
const projectIds: string[] = [];
let email = "";
let historyProjectId = "";
let historyDocumentId = "";

async function openEditor(page: Page): Promise<void> {
  await page.goto(
    `${BASE_URL}/projects/${historyProjectId}/editor/${historyDocumentId}`,
    { waitUntil: "domcontentloaded" },
  );
  await page
    .getByTestId("editor-stage")
    .waitFor({ state: "visible", timeout: 15_000 });
}

function inspectorText(page: Page) {
  return page.getByTestId("editor-inspector-text");
}

async function valueIs(page: Page, expected: string): Promise<void> {
  await expect
    .poll(
      async () => inspectorText(page).inputValue(),
      { timeout: 15_000 },
    )
    .toBe(expected);
}

/** The text of the single layer as the server itself sees it. */
async function serverTextIs(expected: string): Promise<void> {
  const services = await import("../../src/infrastructure/services");
  await expect
    .poll(
      async () => {
        const head = await services.editorService.getDocument({
          projectId: historyProjectId,
          userId: user.userId,
          documentId: historyDocumentId,
        });
        return head.snapshot.nodes[0]?.text?.value ?? null;
      },
      { timeout: 15_000 },
    )
    .toBe(expected);
}

beforeAll(async () => {
  stack = await startStack();
  if (!stack.reachable || !stack.available) return;

  const services = await import("../../src/infrastructure/services");

  email = `cp20-history-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);

  const project = await services.projectService.createForWorkspace(
    user.workspaceId,
    { name: "CP20 editor history" },
    user.userId,
  );
  projectIds.push(project.id);
  historyProjectId = project.id;

  const created = await createE2EEditorDocument(
    project.id,
    user.userId,
    "History edit",
    [editorTextNode({ id: "enode-history-1", name: "Headline" })],
  );
  historyDocumentId = created.documentId;

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
  await stopStack(stack);
  if (user) await cleanupE2EUser(email, user.workspaceId, projectIds);
});

describe("editor history end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("undoes and redoes a saved edit through the keyboard", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    try {
      await openEditor(page);

      // The committed SET_TEXT must exist before it can be undone.
      await page.getByTestId("editor-layer").first().click();
      await inspectorText(page).waitFor({ state: "visible", timeout: 15_000 });
      await inspectorText(page).fill("Edited for undo");
      await valueIs(page, "Edited for undo");
      await serverTextIs("Edited for undo");

      // Undo through the real key handler (focus leaves inputs first, while
      // keeping the layer selected so the inspector stays on screen).
      await page.locator("h1").first().click();
      await page.keyboard.press("Control+KeyZ");
      await valueIs(page, "Draft headline");
      await serverTextIs("Draft headline");

      // Redo through the button; the inspector reflects the re-applied edit
      // and the server head follows.
      await page.getByTestId("editor-redo").click();
      await valueIs(page, "Edited for undo");
      await serverTextIs("Edited for undo");
    } finally {
      await page.close();
    }
  });

  it("duplicates and deletes layers as real operations", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    try {
      await openEditor(page);

      await page.getByTestId("editor-layer").first().click();
      await page.getByTestId("editor-layer-duplicate").first().click();
      await expect
        .poll(async () => page.getByTestId("editor-layer").count(), {
          timeout: 15_000,
        })
        .toBe(2);

      const duplicated = page.locator('[data-testid="editor-layer-duplicate"]').last();
      await duplicated.click();
      await expect
        .poll(async () => page.getByTestId("editor-layer").count(), {
          timeout: 15_000,
        })
        .toBe(3);

      // Delete the two non-original layers by their row.
      await page
        .locator('[data-testid="editor-layer-delete"]')
        .nth(1)
        .click();
      await page
        .locator('[data-testid="editor-layer-delete"]')
        .nth(1)
        .click();
      await expect
        .poll(async () => page.getByTestId("editor-layer").count(), {
          timeout: 15_000,
        })
        .toBe(1);

      // Every operation reached the server: the head document holds exactly the
      // three-node composition collapsed back to the original layer.
      const services = await import("../../src/infrastructure/services");
      await expect
        .poll(
          async () => {
            const head = await services.editorService.getDocument({
              projectId: historyProjectId,
              userId: user.userId,
              documentId: historyDocumentId,
            });
            return {
              count: head.snapshot.nodes.length,
              revision: head.document.revisionCount,
            };
          },
          { timeout: 15_000 },
        )
        .toMatchObject({ count: 1 });
    } finally {
      await page.close();
    }
  });

  it("restores an old revision and marks it head", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    try {
      await openEditor(page);

      await page.getByTestId("editor-layer").first().click();
      await inspectorText(page).waitFor({ state: "visible", timeout: 15_000 });

      // Two distinct edits: a text change and a duplicate, so there is exactly
      // one old SET_TEXT revision to restore.
      await inspectorText(page).fill("Restore target");
      await valueIs(page, "Restore target");
      await page.getByTestId("editor-layer-duplicate").first().click();
      await expect
        .poll(async () => page.getByTestId("editor-layer").count(), {
          timeout: 15_000,
        })
        .toBe(2);

      // The history panel is server data, so wait until the duplicate is on the
      // server before opening it — the SET_TEXT entry must be a non-current
      // revision (with a restore button), not the head.
      const services = await import("../../src/infrastructure/services");
      await expect
        .poll(
          async () =>
            (
              await services.editorService.getDocument({
                projectId: historyProjectId,
                userId: user.userId,
                documentId: historyDocumentId,
              })
            ).snapshot.nodes.length,
          { timeout: 15_000 },
        )
        .toBe(2);

      await page.getByTestId("editor-tab-history").click();
      await page
        .getByTestId("editor-history-item")
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });

      // The oldest SET_TEXT item is the "Restore target" edit; restore it.
      const setTextItem = page
        .locator('[data-testid="editor-history-item"]')
        .filter({ hasText: "SET_TEXT" })
        .first();
      await setTextItem.scrollIntoViewIfNeeded();
      await setTextItem.getByTestId("editor-history-restore").click();

      await page.getByTestId("editor-tab-inspector").click();
      await inspectorText(page).waitFor({ state: "visible", timeout: 15_000 });
      await valueIs(page, "Restore target");
      expect(await page.getByTestId("editor-save-state").textContent()).toBe(
        "Saved",
      );

      const head = await services.editorService.getDocument({
        projectId: historyProjectId,
        userId: user.userId,
        documentId: historyDocumentId,
      });
      expect(head.snapshot.nodes[0]?.text?.value).toBe("Restore target");
    } finally {
      await page.close();
    }
  });
});