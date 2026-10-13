import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAnalyzedProject,
  loadWritingTestContext,
  makeWorker,
  type Orm,
} from "../../writing-engine/__tests__/helpers";
import {
  cleanupEditorProject,
  loadEditorTestContext,
  textNode,
} from "./helpers";
import { EditorAIService } from "../ai/ai-service";
import { createId } from "../../../lib/id";

let orm: Orm;
let services: Awaited<ReturnType<typeof loadEditorTestContext>>["services"];
let ctx: Awaited<ReturnType<typeof createAnalyzedProject>>;
let worker: ReturnType<typeof makeWorker>;

async function drain(): Promise<void> {
  for (let guard = 0; guard < 50; guard += 1) {
    if (!(await worker.tick())) return;
  }
  throw new Error("writing queue did not drain");
}

beforeAll(async () => {
  const editorLoaded = await loadEditorTestContext();
  orm = editorLoaded.orm;
  services = editorLoaded.services;
  await loadWritingTestContext();

  ctx = await createAnalyzedProject(services);
  worker = makeWorker({ services });
  await drain();
});

afterAll(async () => {
  await cleanupEditorProject(orm, ctx.owner, ctx.projectId);
});

describe("editor AI propose", () => {
  it("derives a local operation without persisting a proposal", async () => {
    const node = textNode({ id: createId("enode"), name: "Headline" });
    const doc = await services.editorService.createDocument({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      name: "AI doc local",
      nodes: [node],
    });

    const proposal = await services.editorAIService.propose({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      documentId: doc.document.id,
      baseRevision: doc.revision.id,
      instructions: "move right by 50px",
      nodeId: node.id,
    });

    expect(proposal.operation).toEqual({
      type: "MOVE",
      nodeId: node.id,
      x: 90,
      y: 80,
    });
    expect(proposal.provider).toBe("LOCAL");
    expect(proposal.grounding.status).toBe("NO_CONTEXT");

    const after = await services.editorService.getDocument({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      documentId: doc.document.id,
    });
    expect(after.revision.id).toBe(doc.revision.id);
    expect(after.document.revisionCount).toBe(1);
  });

  it("refuses anything it cannot interpret", async () => {
    const node = textNode({ id: createId("enode") });
    const doc = await services.editorService.createDocument({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      name: "AI doc refusal",
      nodes: [node],
    });

    await expect(
      services.editorAIService.propose({
        projectId: ctx.projectId,
        userId: ctx.owner.user.id,
        documentId: doc.document.id,
        baseRevision: doc.revision.id,
        instructions: "make it delightful and excellent",
        nodeId: node.id,
      }),
    ).rejects.toMatchObject({ code: "EDITOR_INVALID_OPERATION" });
  });

  it("refuses to target a node from outside the document", async () => {
    const doc = await services.editorService.createDocument({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      name: "AI doc missing node",
    });

    await expect(
      services.editorAIService.propose({
        projectId: ctx.projectId,
        userId: ctx.owner.user.id,
        documentId: doc.document.id,
        baseRevision: doc.revision.id,
        instructions: "move right by 50px",
        nodeId: "enode-gone",
      }),
    ).rejects.toMatchObject({ code: "EDITOR_NODE_NOT_FOUND" });
  });

  it("reports an unwired remote provider as unavailable", async () => {
    const node = textNode({ id: createId("enode") });
    const doc = await services.editorService.createDocument({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      name: "AI doc remote",
      nodes: [node],
    });

    await expect(
      services.editorAIService.propose({
        projectId: ctx.projectId,
        userId: ctx.owner.user.id,
        documentId: doc.document.id,
        baseRevision: doc.revision.id,
        instructions: "move right by 50px",
        nodeId: node.id,
        provider: "REMOTE",
      }),
    ).rejects.toMatchObject({ code: "EDITOR_PROVIDER_UNAVAILABLE" });
  });
});

describe("editor AI grounding", () => {
  let writingDocumentId: string;
  let variantId: string;
  let sourceIds: string[];
  let groundedText: string;

  beforeAll(async () => {
    const job = await services.writingGenerationService.enqueue({
      projectId: ctx.projectId,
      requestedById: ctx.owner.user.id,
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
    await drain();

    const record = await services.writingGenerationService.getJob({
      projectId: ctx.projectId,
      jobId: job.id,
      userId: ctx.owner.user.id,
    });
    expect(record.status).toBe("SUCCEEDED");

    writingDocumentId = record.documentId!;
    const view = await services.writingGenerationService.getDocument({
      projectId: ctx.projectId,
      documentId: writingDocumentId,
      userId: ctx.owner.user.id,
    });
    const snapshot = JSON.parse(view.document.contextSnapshot) as {
      sourceIds: string[];
    };
    sourceIds = snapshot.sourceIds;
    variantId = view.variants[0]!.id;
    groundedText = view.variants[0]!.text;
  });

  function writingNode() {
    return textNode({
      id: createId("enode"),
      name: "Claim",
      text: { value: groundedText },
      provenance: {
        origin: "WRITING_VARIANT",
        sourceType: "WRITING_VARIANT",
        sourceId: variantId,
        sourceIds,
        label: null,
      },
    });
  }

  it("accepts a reword the project can back", async () => {
    const node = writingNode();
    const doc = await services.editorService.createDocument({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      name: "AI doc grounded",
      nodes: [node],
    });

    const proposal = await services.editorAIService.propose({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      documentId: doc.document.id,
      baseRevision: doc.revision.id,
      instructions: `set text to ${groundedText}`,
      nodeId: node.id,
    });

    expect(proposal.operation.type).toBe("SET_TEXT");
    expect(proposal.grounding.status).toBe("SUPPORTED");
    expect(Array.isArray(proposal.grounding.claims)).toBe(true);
  });

  it("rejects a text edit whose claim the project cannot support", async () => {
    const node = writingNode();
    const doc = await services.editorService.createDocument({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      name: "AI doc unsupported",
      nodes: [node],
    });

    await expect(
      services.editorAIService.propose({
        projectId: ctx.projectId,
        userId: ctx.owner.user.id,
        documentId: doc.document.id,
        baseRevision: doc.revision.id,
        instructions: "set text to Northwind Analytics is revolutionary",
        nodeId: node.id,
      }),
    ).rejects.toMatchObject({ code: "EDITOR_UNSUPPORTED_CLAIM" });
  });
});

describe("editor AI apply", () => {
  let nodeId: string;
  let doc: Awaited<ReturnType<typeof services.editorService.createDocument>>;

  beforeAll(async () => {
    nodeId = createId("enode");
    doc = await services.editorService.createDocument({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      name: "AI doc apply",
      nodes: [textNode({ id: nodeId, text: { value: "Before" } })],
    });
  });

  it("applies a proposal as an AI-sourced revision", async () => {
    const proposal = await services.editorAIService.propose({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      documentId: doc.document.id,
      baseRevision: doc.revision.id,
      instructions: "set text to Changed by AI",
      nodeId,
    });

    const detail = await services.editorAIService.apply({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      documentId: doc.document.id,
      baseRevision: proposal.baseRevision,
      proposalId: proposal.proposalId,
      operation: proposal.operation,
    });

    expect(detail.revision.sourceType).toBe("AI");
    expect(detail.revision.sourceId).toBe(proposal.proposalId);
    expect(detail.document.revisionCount).toBe(2);
    expect(
      detail.snapshot.nodes.find((n) => n.id === nodeId)?.text?.value,
    ).toBe("Changed by AI");
  });

  it("refuses to apply a proposal built on a superseded revision", async () => {
    const stale = await services.editorAIService.propose({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      documentId: doc.document.id,
      baseRevision: doc.revision.id,
      instructions: "mute",
      nodeId,
    });

    await expect(
      services.editorAIService.apply({
        projectId: ctx.projectId,
        userId: ctx.owner.user.id,
        documentId: doc.document.id,
        baseRevision: stale.baseRevision,
        proposalId: stale.proposalId,
        operation: stale.operation,
      }),
    ).rejects.toMatchObject({ code: "EDITOR_REVISION_CONFLICT" });
  });
});

describe("editor AI proposal shape", () => {
  it("proposals are never persisted anywhere", async () => {
    const service = new EditorAIService({
      editor: services.editorService,
      writing: services.writingRepository,
    });

    const node = textNode({ id: createId("enode") });
    const doc = await services.editorService.createDocument({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      name: "AI doc provenance",
      nodes: [node],
    });

    const proposal = await service.propose({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      documentId: doc.document.id,
      baseRevision: doc.revision.id,
      instructions: "duplicate",
      nodeId: node.id,
    });

    expect(proposal.proposalId.length).toBeGreaterThan(0);
    const head = await services.editorService.getDocument({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      documentId: doc.document.id,
    });
    expect(head.document.revisionCount).toBe(1);
    expect(head.revision.id).toBe(doc.revision.id);
  });
});