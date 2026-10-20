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
 * Real browser proof that a stale edit is never silently written over,
 * and that the newer server state wins after an explicit reload.
 *
 * Two browser tabs share one session and one document. Both load revision #1;
 * A commits a change that becomes revision #2; B then tries to save an edit
 * based on the stale #1. The CAS rejects it, B shows a conflict banner, and B's
 * edit never produces a revision. Only an explicit reload takes B to the truth.
 */

let stack: E2EStack;
let user: RegisteredBrowserUser;
let browser: Browser;
let contextA: BrowserContext;
let contextB: BrowserContext;
const projectIds: string[] = [];
let email = "";
let conflictProjectId = "";
let conflictDocumentId = "";

async function openEditor(page: Page): Promise<void> {
  await page.goto(
    `${BASE_URL}/projects/${conflictProjectId}/editor/${conflictDocumentId}`,
    { waitUntil: "domcontentloaded" },
  );
  await page
    .getByTestId("editor-stage")
    .waitFor({ state: "visible", timeout: 15_000 });
}

async function setText(page: Page, value: string): Promise<void> {
  await page.getByTestId("editor-layer").first().click();
  const text = page.getByTestId("editor-inspector-text");
  await text.waitFor({ state: "visible", timeout: 15_000 });
  await text.fill(value);
}

beforeAll(async () => {
  stack = await startStack();
  if (!stack.reachable || !stack.available) return;

  const services = await import("../../src/infrastructure/services");

  email = `cp20-conflict-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);

  const project = await services.projectService.createForWorkspace(
    user.workspaceId,
    { name: "CP20 editor conflict" },
    user.userId,
  );
  projectIds.push(project.id);
  conflictProjectId = project.id;

  const created = await createE2EEditorDocument(
    project.id,
    user.userId,
    "Shared edit",
    [editorTextNode({ id: "enode-conflict-1", name: "Headline" })],
  );
  conflictDocumentId = created.documentId;

  browser = await chromium.launch({
    executablePath: stack.executablePath,
    args: ["--no-sandbox"],
  });

  const cookie = { name: SESSION_COOKIE, value: user.cookieValue, url: BASE_URL };
  contextA = await browser.newContext();
  await contextA.addCookies([cookie]);
  contextB = await browser.newContext();
  await contextB.addCookies([cookie]);
});

afterAll(async () => {
  if (browser) await browser.close();
  await stopStack(stack);
  if (user) await cleanupE2EUser(email, user.workspaceId, projectIds);
});

describe("editor conflict end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("surfaces the conflict instead of overwriting newer work", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await openEditor(pageA);
    await openEditor(pageB);

    // A takes the head.
    await setText(pageA, "changed by A");
    await expect
      .poll(
        async () => pageA.getByTestId("editor-save-state").textContent(),
        { timeout: 15_000 },
      )
      .toBe("Saved");

    // B is still on revision #1; its autosave hits a stale baseRevision.
    await setText(pageB, "changed by B");
    await pageB
      .getByTestId("editor-conflict-banner")
      .waitFor({ state: "visible", timeout: 15_000 });
    await expect
      .poll(
        async () => pageB.getByTestId("editor-conflict-banner").textContent(),
        { timeout: 15_000 },
      )
      .toContain("not applied");
    await expect
      .poll(
        async () => pageB.getByTestId("editor-error-banner").count(),
        { timeout: 5_000 },
      )
      .toBe(0);

    // B's edit must not exist anywhere as a revision.
    const services = await import("../../src/infrastructure/services");
    const head = await services.editorService.getDocument({
      projectId: conflictProjectId,
      userId: user.userId,
      documentId: conflictDocumentId,
    });
    const text = head.snapshot.nodes[0]?.text?.value;
    expect(text).toBe("changed by A");
    expect(head.document.revisionCount).toBe(2);
    expect(head.snapshot.nodes.find((node) => node.id === "enode-conflict-1")?.text?.value).toBe(
      "changed by A",
    );

    // Only an explicit reload resolves the browser to the newer head.
    await pageB.reload({ waitUntil: "domcontentloaded" });
    await pageB
      .getByTestId("editor-stage")
      .waitFor({ state: "visible", timeout: 15_000 });
    await pageB.getByTestId("editor-layer").first().click();
    await pageB
      .getByTestId("editor-inspector-text")
      .waitFor({ state: "visible", timeout: 15_000 });
    expect(await pageB.getByTestId("editor-inspector-text").inputValue()).toBe(
      "changed by A",
    );

    await pageA.close();
    await pageB.close();
  });
});