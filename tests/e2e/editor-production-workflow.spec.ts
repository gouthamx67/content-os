import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  chromium,
  type APIResponse,
  type Browser,
  type BrowserContext,
} from "playwright-core";
import { snapshotSha256 } from "../../src/modules/editor-engine/serialization/editor-snapshot";
import type { EditorSnapshot } from "../../src/modules/editor-engine/domain/types";
import {
  BASE_URL,
  cleanupE2EUser,
  createAnalyzedE2EProject,
  registerBrowserUser,
  SESSION_COOKIE,
  startStack,
  stopStack,
  type E2EStack,
  type RegisteredBrowserUser,
} from "./support/image-harness";

/**
 * CP20 sign-off: one production-mode workflow, start to finish.
 *
 * Everything below runs against the real `next start` server (the harness only
 * serves a build it compiles first), a real Chromium, the real Postgres, the
 * real asset storage, and the real editor/AI/import services. Nothing is
 * mocked: fixtures (a generated image, a writing variant, a visual and an audio
 * composition) are created through the same services the app uses, then
 * exercised through the HTTP routes and the browser.
 */

let stack: E2EStack;
let user: RegisteredBrowserUser;
let browser: Browser;
let context: BrowserContext;
let email = "";
const projectIds: string[] = [];

let projectId = "";
let visualCompositionId = "";
let audioCompositionId = "";
let imageJobId = "";
let imageAssetId = "";
let writingJobId = "";

let cp17DocumentId = "";
let cp14DocumentId = "";
let cp14FirstRevisionId = "";
let cp14TextNodeId = "";
let writingDocumentId = "";
let writingVariantId = "";
let writingVariantText = "";

let prepared = false;

type DocWire = {
  document: {
    id: string;
    status: string;
    currentRevisionId: string;
    revisionNumber: number;
    revisionCount: number;
  };
  snapshot: EditorSnapshot;
  revision: {
    id: string;
    revisionNumber: number;
    sourceType: string;
    sourceId: string | null;
  };
};

function api(path: string): string {
  return `${BASE_URL}${path}`;
}

function textNodeId(snapshot: EditorSnapshot): string {
  const node = snapshot.nodes.find((candidate) => candidate.type === "TEXT");
  if (!node) throw new Error("expected a TEXT node in the snapshot");
  return node.id;
}

function textValue(snapshot: EditorSnapshot, nodeId: string): string | null {
  return snapshot.nodes.find((node) => node.id === nodeId)?.text?.value ?? null;
}

async function getDoc(documentId: string): Promise<DocWire> {
  const response = await context.request.get(
    api(`/api/projects/${projectId}/editor/${documentId}`),
  );
  expect(response.status(), "GET document should succeed").toBe(200);
  return (await response.json()) as DocWire;
}

function postJson(
  path: string,
  body: Record<string, unknown>,
): Promise<APIResponse> {
  return context.request.post(api(path), { data: body });
}

function setText(nodeId: string, value: string): Record<string, unknown> {
  return { type: "SET_TEXT", nodeId, value };
}

beforeAll(async () => {
  stack = await startStack();
  if (!stack.reachable || !stack.available) return;

  const services = await import("../../src/infrastructure/services");
  const { container } = await import("../../src/infrastructure/container");

  email = `cp20-workflow-${Date.now()}@test.local`;
  user = await registerBrowserUser(email);
  projectId = await createAnalyzedE2EProject(
    user.workspaceId,
    user.userId,
    "CP20 production workflow",
  );
  projectIds.push(projectId);

  // CP14: a real visual composition with a text and a shape layer.
  const composition = await services.visualCompositionService.createComposition({
    projectId,
    userId: user.userId,
    name: "Launch story",
    width: 1920,
    height: 1080,
    durationMs: 20_000,
  });
  visualCompositionId = composition.id;
  await services.visualLayerService.addLayer({
    projectId,
    compositionId: composition.id,
    userId: user.userId,
    type: "TEXT",
    name: "Headline",
    textContent: "Launch headline",
    zIndex: 0,
  });
  await services.visualLayerService.addLayer({
    projectId,
    compositionId: composition.id,
    userId: user.userId,
    type: "SHAPE",
    name: "Backdrop",
    width: 1920,
    height: 1080,
    zIndex: 1,
  });

  // CP16: a real audio composition attached to that visual composition.
  const now = new Date().toISOString();
  const audio = await container.repositories.audio.createComposition({
    id: `acomp-${Date.now()}`,
    projectId,
    compositionId: composition.id,
    name: "Voiceover",
    sampleRate: 48_000,
    channels: 2,
    durationMs: 20_000,
    status: "READY",
    createdById: user.userId,
    createdAt: now,
    updatedAt: now,
  });
  audioCompositionId = audio.id;
  await services.audioCompositionService.addTrack({
    projectId,
    audioCompositionId: audio.id,
    userId: user.userId,
    kind: "VOICEOVER",
    name: "Narrator",
    sourceRef: "capture:take-fixture",
    startMs: 0,
    sourceOffsetMs: 0,
    durationMs: 15_000,
    gainDb: -3,
    pan: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    mute: false,
    solo: false,
    duckVoiceoverDb: null,
  });

  // CP17 + CP18 fixtures, produced by the stack's workers.
  const imageJob = await services.imageGenerationService.enqueue({
    projectId,
    requestedById: user.userId,
    templateType: "SOCIAL_POST",
    prompt: "A status report dashboard",
  });
  imageJobId = imageJob.id;

  const writingJob = await services.writingGenerationService.enqueue({
    projectId,
    requestedById: user.userId,
    blockType: "BODY",
    tone: "PROFESSIONAL",
    length: "LONG",
    objective: "PRODUCT_EXPLANATION",
    prompt: "Explain the product with proof",
    variantCount: 1,
    intentId: null,
    directionId: null,
    storyboardId: null,
    sceneId: null,
  });
  writingJobId = writingJob.id;

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
  if (stack) await stopStack(stack);
  if (user) await cleanupE2EUser(email, user.workspaceId, projectIds);
});

describe("CP20 production-mode editor workflow", () => {
  it("is runnable in this environment", (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }
    expect(stack.executablePath).toBeTruthy();
  });

  it("waits for the real workers to produce the import fixtures", async (testContext) => {
    if (!stack.reachable || !stack.available) {
      testContext.skip();
      return;
    }

    const services = await import("../../src/infrastructure/services");

    await expect
      .poll(
        async () =>
          (
            await services.imageGenerationService.get({
              projectId,
              jobId: imageJobId,
              userId: user.userId,
            })
          ).status,
        { timeout: 120_000, interval: 1_000 },
      )
      .toBe("SUCCEEDED");

    const imageAsset = await services.imageGenerationService.asset({
      projectId,
      jobId: imageJobId,
      userId: user.userId,
    });
    if (!imageAsset) throw new Error("generated image has no asset");
    imageAssetId = imageAsset.id;

    await expect
      .poll(
        async () =>
          (
            await services.writingGenerationService.getJob({
              projectId,
              jobId: writingJobId,
              userId: user.userId,
            })
          ).status,
        { timeout: 120_000, interval: 1_000 },
      )
      .toBe("SUCCEEDED");

    const writingRecord = await services.writingGenerationService.getJob({
      projectId,
      jobId: writingJobId,
      userId: user.userId,
    });
    writingDocumentId = writingRecord.documentId!;
    const writingView = await services.writingGenerationService.getDocument({
      projectId,
      documentId: writingDocumentId,
      userId: user.userId,
    });
    writingVariantId = writingView.variants[0]!.id;
    writingVariantText = writingView.variants[0]!.text;

    prepared = true;
  }, 180_000);

  it("authenticates over HTTP and reaches the project", async (testContext) => {
    if (!prepared) {
      testContext.skip();
      return;
    }
    const response = await context.request.get(api("/api/projects"));
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { projects: Array<{ id: string }> };
    expect(body.projects.map((project) => project.id)).toContain(projectId);
  });

  it("imports a real generated image (CP17) through the production route", async (testContext) => {
    if (!prepared) {
      testContext.skip();
      return;
    }

    const response = await postJson(
      `/api/projects/${projectId}/editor/imports`,
      { kind: "GENERATED_IMAGE", sourceId: imageAssetId },
    );
    expect(response.status()).toBe(201);
    cp17DocumentId = ((await response.json()) as { document: { id: string } })
      .document.id;

    const doc = await getDoc(cp17DocumentId);
    expect(doc.snapshot.nodes).toHaveLength(1);
    expect(doc.snapshot.nodes[0]!.type).toBe("IMAGE");
    expect(doc.revision.sourceType).toBe("IMPORT");
    expect(doc.revision.sourceId).toBe(imageAssetId);

    const ref = doc.snapshot.nodes[0]!.asset!.ref;
    const assetResponse = await context.request.get(
      api(`/api/projects/${projectId}/editor/assets/${encodeURIComponent(ref)}`),
    );
    expect(assetResponse.status()).toBe(200);
    const bytes = await assetResponse.body();
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(createHash("sha256").update(bytes).digest("hex")).toHaveLength(64);
  });

  it("imports a real visual composition (CP14) and an audio composition (CP16)", async (testContext) => {
    if (!prepared) {
      testContext.skip();
      return;
    }

    const visualImport = await postJson(
      `/api/projects/${projectId}/editor/imports`,
      { kind: "COMPOSITION", sourceId: visualCompositionId },
    );
    expect(visualImport.status()).toBe(201);
    const visual = (await visualImport.json()) as {
      document: { id: string; revisionId: string };
    };
    cp14DocumentId = visual.document.id;
    cp14FirstRevisionId = visual.document.revisionId;

    const visualDoc = await getDoc(cp14DocumentId);
    expect(visualDoc.snapshot.width).toBe(1920);
    expect(visualDoc.snapshot.nodes.map((node) => node.type).sort()).toEqual([
      "SHAPE",
      "TEXT",
    ]);
    expect(visualDoc.revision.sourceId).toBe(visualCompositionId);
    cp14TextNodeId = textNodeId(visualDoc.snapshot);

    const audioImport = await postJson(
      `/api/projects/${projectId}/editor/imports`,
      { kind: "AUDIO_COMPOSITION", sourceId: audioCompositionId },
    );
    expect(audioImport.status()).toBe(201);
    const audioDocumentId = (
      (await audioImport.json()) as { document: { id: string } }
    ).document.id;
    const audioDoc = await getDoc(audioDocumentId);
    expect(audioDoc.snapshot.nodes).toHaveLength(1);
    expect(audioDoc.snapshot.nodes[0]!.type).toBe("AUDIO");
    expect(audioDoc.snapshot.nodes[0]!.audio?.gainDb).toBe(-3);
    expect(audioDoc.revision.sourceId).toBe(audioCompositionId);
  });

  it("imports a real grounded writing variant (CP18)", async (testContext) => {
    if (!prepared) {
      testContext.skip();
      return;
    }

    const response = await postJson(
      `/api/projects/${projectId}/editor/imports`,
      {
        kind: "WRITING_VARIANT",
        documentId: writingDocumentId,
        variantId: writingVariantId,
      },
    );
    expect(response.status()).toBe(201);
    const documentId = ((await response.json()) as { document: { id: string } })
      .document.id;

    const doc = await getDoc(documentId);
    expect(doc.snapshot.nodes).toHaveLength(1);
    expect(doc.snapshot.nodes[0]!.type).toBe("TEXT");
    expect(doc.snapshot.nodes[0]!.text?.value).toBe(writingVariantText);
  });

  it("applies operations over HTTP and keeps revision, hash and history consistent", async (testContext) => {
    if (!prepared) {
      testContext.skip();
      return;
    }
    const { container } = await import("../../src/infrastructure/container");

    const before = await getDoc(cp14DocumentId);
    expect(before.document.revisionNumber).toBe(1);
    expect(textValue(before.snapshot, cp14TextNodeId)).toBe("Launch headline");

    const opResponse = await postJson(
      `/api/projects/${projectId}/editor/${cp14DocumentId}/operations`,
      {
        baseRevision: before.document.currentRevisionId,
        operation: setText(cp14TextNodeId, "Server edit"),
      },
    );
    expect(opResponse.status()).toBe(200);
    const op = (await opResponse.json()) as {
      revision: { id: string; revisionNumber: number };
    };
    expect(op.revision.revisionNumber).toBe(2);

    const after = await getDoc(cp14DocumentId);
    expect(after.document.currentRevisionId).toBe(op.revision.id);
    expect(after.document.revisionCount).toBe(2);
    expect(textValue(after.snapshot, cp14TextNodeId)).toBe("Server edit");

    // The bytes served by the route hash to exactly what the head claims.
    const headRow = await container.repositories.editor.getRevision(
      cp14DocumentId,
      after.document.currentRevisionId,
    );
    expect(headRow).not.toBeNull();
    expect(snapshotSha256(after.snapshot)).toBe(headRow!.snapshotSha256);

    // The first revision is unchanged by the later edit.
    const first = await context.request.get(
      api(
        `/api/projects/${projectId}/editor/${cp14DocumentId}/revisions/${cp14FirstRevisionId}`,
      ),
    );
    expect(first.status()).toBe(200);
    const firstBody = (await first.json()) as { snapshot: EditorSnapshot };
    expect(textValue(firstBody.snapshot, cp14TextNodeId)).toBe("Launch headline");

    // Advance once, then retry from the now-superseded base: the CAS rejects
    // and appends nothing.
    const advance = await postJson(
      `/api/projects/${projectId}/editor/${cp14DocumentId}/operations`,
      {
        baseRevision: after.document.currentRevisionId,
        operation: setText(cp14TextNodeId, "Moved ahead"),
      },
    );
    expect(advance.status()).toBe(200);

    const conflict = await postJson(
      `/api/projects/${projectId}/editor/${cp14DocumentId}/operations`,
      {
        baseRevision: after.document.currentRevisionId,
        operation: setText(cp14TextNodeId, "Conflict edit"),
      },
    );
    expect(conflict.status()).toBe(409);
    expect(((await conflict.json()) as { code: string }).code).toBe(
      "EDITOR_REVISION_CONFLICT",
    );
  });

  it("edits through the browser, reloads, and reads the change back", async (testContext) => {
    if (!prepared) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    try {
      await page.goto(api(`/projects/${projectId}/editor/${cp14DocumentId}`), {
        waitUntil: "domcontentloaded",
      });
      await page
        .getByTestId("editor-stage")
        .waitFor({ state: "visible", timeout: 15_000 });

      await page.getByTestId("editor-layer").first().click();
      const inspector = page.getByTestId("editor-inspector-text");
      await inspector.waitFor({ state: "visible", timeout: 15_000 });
      await inspector.fill("Browser edit");
      await expect
        .poll(
          async () => page.getByTestId("editor-save-state").textContent(),
          { timeout: 15_000 },
        )
        .toBe("Saved");

      await page.reload({ waitUntil: "domcontentloaded" });
      await page
        .getByTestId("editor-stage")
        .waitFor({ state: "visible", timeout: 15_000 });
      await page.getByTestId("editor-layer").first().click();
      const reloaded = page.getByTestId("editor-inspector-text");
      await reloaded.waitFor({ state: "visible", timeout: 15_000 });
      expect(await reloaded.inputValue()).toBe("Browser edit");
    } finally {
      await page.close();
    }

    const doc = await getDoc(cp14DocumentId);
    expect(textValue(doc.snapshot, cp14TextNodeId)).toBe("Browser edit");
  });

  it("previews history without moving the head, then restores by appending", async (testContext) => {
    if (!prepared) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    try {
      await page.goto(api(`/projects/${projectId}/editor/${cp14DocumentId}`), {
        waitUntil: "domcontentloaded",
      });
      await page
        .getByTestId("editor-stage")
        .waitFor({ state: "visible", timeout: 15_000 });
      await page.getByTestId("editor-tab-history").click();

      const headBefore = (await getDoc(cp14DocumentId)).document
        .currentRevisionId;

      const firstRow = page
        .getByTestId("editor-history-item")
        .filter({ hasText: "#1 ·" });
      await firstRow.waitFor({ state: "visible", timeout: 15_000 });
      await firstRow.getByTestId("editor-history-preview").click();
      await expect
        .poll(
          async () => page.getByTestId("editor-preview-banner").textContent(),
          { timeout: 15_000 },
        )
        .toContain("revision 1");

      // Preview never moves the head.
      expect((await getDoc(cp14DocumentId)).document.currentRevisionId).toBe(
        headBefore,
      );

      await page.getByTestId("editor-preview-exit").click();
      await page
        .getByTestId("editor-preview-banner")
        .waitFor({ state: "hidden", timeout: 15_000 });

      await firstRow.getByTestId("editor-history-restore").click();
      await expect
        .poll(
          async () => page.getByTestId("editor-save-state").textContent(),
          { timeout: 15_000 },
        )
        .toBe("Saved");
    } finally {
      await page.close();
    }

    const restored = await getDoc(cp14DocumentId);
    expect(textValue(restored.snapshot, cp14TextNodeId)).toBe("Launch headline");

    const history = await context.request.get(
      api(`/api/projects/${projectId}/editor/${cp14DocumentId}/history`),
    );
    expect(history.status()).toBe(200);
    const historyBody = (await history.json()) as {
      revisions: Array<{ id: string; restoredFromRevisionId: string | null }>;
    };
    expect(historyBody.revisions[0]!.restoredFromRevisionId).toBe(
      cp14FirstRevisionId,
    );
    expect(historyBody.revisions[0]!.id).toBe(
      restored.document.currentRevisionId,
    );
  });

  it("undoes and redoes through the production routes", async (testContext) => {
    if (!prepared) {
      testContext.skip();
      return;
    }

    const head = (await getDoc(cp14DocumentId)).document.currentRevisionId;

    const undo = await postJson(
      `/api/projects/${projectId}/editor/${cp14DocumentId}/undo`,
      { baseRevision: head },
    );
    expect(undo.status()).toBe(200);
    const undoBody = (await undo.json()) as {
      revision: { id: string };
      snapshot: EditorSnapshot;
    };
    expect(textValue(undoBody.snapshot, cp14TextNodeId)).toBe("Browser edit");

    const redo = await postJson(
      `/api/projects/${projectId}/editor/${cp14DocumentId}/redo`,
      { baseRevision: undoBody.revision.id },
    );
    expect(redo.status()).toBe(200);
    const redoBody = (await redo.json()) as { snapshot: EditorSnapshot };
    expect(textValue(redoBody.snapshot, cp14TextNodeId)).toBe("Launch headline");
  });

  it("surfaces a concurrent conflict in the browser", async (testContext) => {
    if (!prepared) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();
    try {
      await page.goto(api(`/projects/${projectId}/editor/${cp14DocumentId}`), {
        waitUntil: "domcontentloaded",
      });
      await page
        .getByTestId("editor-stage")
        .waitFor({ state: "visible", timeout: 15_000 });

      // Advance the head behind the browser's back.
      const head = (await getDoc(cp14DocumentId)).document.currentRevisionId;
      const advance = await postJson(
        `/api/projects/${projectId}/editor/${cp14DocumentId}/operations`,
        {
          baseRevision: head,
          operation: setText(cp14TextNodeId, "Moved ahead"),
        },
      );
      expect(advance.status()).toBe(200);

      await page.getByTestId("editor-layer").first().click();
      const inspector = page.getByTestId("editor-inspector-text");
      await inspector.waitFor({ state: "visible", timeout: 15_000 });
      await inspector.fill("Conflict edit");
      await page
        .getByTestId("editor-conflict-banner")
        .waitFor({ state: "visible", timeout: 15_000 });
    } finally {
      await page.close();
    }
  });

  it("finalises a complete document and reports it as READY", async (testContext) => {
    if (!prepared) {
      testContext.skip();
      return;
    }

    const created = await postJson(
      `/api/projects/${projectId}/editor/imports`,
      {
        kind: "WRITING_VARIANT",
        documentId: writingDocumentId,
        variantId: writingVariantId,
      },
    );
    expect(created.status()).toBe(201);
    const documentId = ((await created.json()) as { document: { id: string } })
      .document.id;

    const doc = await getDoc(documentId);
    const finalize = await postJson(
      `/api/projects/${projectId}/editor/${documentId}/finalize`,
      { baseRevision: doc.document.currentRevisionId },
    );
    expect(finalize.status()).toBe(200);
    expect(
      ((await finalize.json()) as { document: { status: string } }).document
        .status,
    ).toBe("READY");

    expect((await getDoc(documentId)).document.status).toBe("READY");
  });
});
