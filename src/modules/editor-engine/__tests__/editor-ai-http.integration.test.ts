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
  request,
  textNode,
} from "./helpers";
import { createId } from "../../../lib/id";

/**
 * HTTP proof of the CP20 AI edit contract.
 *
 * The service suite proves the AI rules and the browser suite proves the UI,
 * but neither exercises the route. Here every AI request crosses the real HTTP
 * boundary: a proposal is a preview (the route returns it, the document head
 * does not move), grounding is enforced before an apply is accepted, an
 * unavailable provider is refused, and a proposal built on a superseded
 * revision cannot be applied. Grounding runs against a real CP18 variant that
 * the writing worker generated, so "supported" and "unsupported" are decided
 * by the engine, not by the test.
 */

const BASE = "http://localhost";
const SESSION_COOKIE = "content_os_session";

type Loaded = Awaited<ReturnType<typeof loadEditorTestContext>>;
type Services = Loaded["services"];

type NodeContext = { params: Promise<{ id: string; documentId: string }> };
type AiRoute = {
  POST(request: Request, context: NodeContext): Promise<Response>;
};

let orm: Orm;
let services: Services;
let ctx: Awaited<ReturnType<typeof createAnalyzedProject>>;
let worker: ReturnType<typeof makeWorker>;
let proposeRoute: AiRoute;
let applyRoute: AiRoute;

let variantId = "";
let variantText = "";
let sourceIds: string[] = [];

async function drain(): Promise<void> {
  for (let guard = 0; guard < 50; guard += 1) {
    if (!(await worker.tick())) return;
  }
  throw new Error("writing queue did not drain");
}

function cookie(): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(ctx.owner.token)}`;
}

function nodeContext(id: string, documentId: string): NodeContext {
  return { params: Promise.resolve({ id, documentId }) };
}

async function propose(
  documentId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return proposeRoute.POST(
    request(
      `${BASE}/api/projects/${ctx.projectId}/editor/${documentId}/ai/propose`,
      {
        method: "POST",
        cookie: cookie(),
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
    nodeContext(ctx.projectId, documentId),
  );
}

async function apply(
  documentId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return applyRoute.POST(
    request(
      `${BASE}/api/projects/${ctx.projectId}/editor/${documentId}/ai/apply`,
      {
        method: "POST",
        cookie: cookie(),
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
    nodeContext(ctx.projectId, documentId),
  );
}

async function createPlainDocument(name: string) {
  const id = createId("enode");
  const detail = await services.editorService.createDocument({
    projectId: ctx.projectId,
    userId: ctx.owner.user.id,
    name,
    nodes: [textNode({ id, text: { value: "Before" } })],
  });
  return { documentId: detail.document.id, revisionId: detail.revision.id, nodeId: id };
}

async function createGroundedDocument(name: string) {
  const id = createId("enode");
  const node = textNode({
    id,
    name: "Claim",
    text: { value: variantText },
    provenance: {
      origin: "WRITING_VARIANT",
      sourceType: "WRITING_VARIANT",
      sourceId: variantId,
      sourceIds,
      label: null,
    },
  });
  const detail = await services.editorService.createDocument({
    projectId: ctx.projectId,
    userId: ctx.owner.user.id,
    name,
    nodes: [node],
  });
  return { documentId: detail.document.id, revisionId: detail.revision.id, nodeId: id };
}

beforeAll(async () => {
  const loaded = await loadEditorTestContext();
  orm = loaded.orm;
  services = loaded.services;
  await loadWritingTestContext();

  proposeRoute = (await import(
    "../../../app/api/projects/[id]/editor/[documentId]/ai/propose/route"
  )) as unknown as AiRoute;
  applyRoute = (await import(
    "../../../app/api/projects/[id]/editor/[documentId]/ai/apply/route"
  )) as unknown as AiRoute;

  ctx = await createAnalyzedProject(services);
  worker = makeWorker({ services });
  await drain();

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

  const view = await services.writingGenerationService.getDocument({
    projectId: ctx.projectId,
    documentId: record.documentId!,
    userId: ctx.owner.user.id,
  });
  const snapshot = JSON.parse(view.document.contextSnapshot) as {
    sourceIds: string[];
  };
  sourceIds = snapshot.sourceIds;
  variantId = view.variants[0]!.id;
  variantText = view.variants[0]!.text;
});

afterAll(async () => {
  await cleanupEditorProject(orm, ctx.owner, ctx.projectId);
});

describe("editor AI HTTP propose", () => {
  it("previews a LOCAL proposal without persisting anything", async () => {
    const doc = await createPlainDocument("AI HTTP local");

    const response = await propose(doc.documentId, {
      baseRevision: doc.revisionId,
      instructions: "move right by 50px",
      nodeId: doc.nodeId,
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      proposal: { proposalId: string; provider: string; operation: { type: string } };
    };
    expect(body.proposal.provider).toBe("LOCAL");
    expect(body.proposal.proposalId.length).toBeGreaterThan(0);
    expect(body.proposal.operation.type).toBe("MOVE");

    const head = await services.editorService.getDocument({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      documentId: doc.documentId,
    });
    expect(head.document.revisionCount).toBe(1);
    expect(head.revision.id).toBe(doc.revisionId);
  });

  it("refuses an instruction it cannot interpret", async () => {
    const doc = await createPlainDocument("AI HTTP nonsense");
    const response = await propose(doc.documentId, {
      baseRevision: doc.revisionId,
      instructions: "make it delightful and excellent",
      nodeId: doc.nodeId,
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("EDITOR_INVALID_OPERATION");
  });

  it("reports an unwired REMOTE provider as unavailable", async () => {
    const doc = await createPlainDocument("AI HTTP remote");
    const response = await propose(doc.documentId, {
      baseRevision: doc.revisionId,
      instructions: "move right by 50px",
      nodeId: doc.nodeId,
      provider: "REMOTE",
    });
    expect(response.status).toBe(501);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("EDITOR_PROVIDER_UNAVAILABLE");
  });

  it("grounds a reword the project can support", async () => {
    const doc = await createGroundedDocument("AI HTTP grounded");
    const response = await propose(doc.documentId, {
      baseRevision: doc.revisionId,
      instructions: `set text to ${variantText}`,
      nodeId: doc.nodeId,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      proposal: { operation: { type: string }; grounding: { status: string } };
    };
    expect(body.proposal.operation.type).toBe("SET_TEXT");
    expect(body.proposal.grounding.status).toBe("SUPPORTED");
  });

  it("refuses a claim the project cannot support", async () => {
    const doc = await createGroundedDocument("AI HTTP unsupported");
    const response = await propose(doc.documentId, {
      baseRevision: doc.revisionId,
      instructions: "set text to Northwind Analytics is revolutionary",
      nodeId: doc.nodeId,
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("EDITOR_UNSUPPORTED_CLAIM");
  });

  it("refuses a proposal with no base revision", async () => {
    const doc = await createPlainDocument("AI HTTP no base");
    const response = await propose(doc.documentId, {
      instructions: "move right by 50px",
      nodeId: doc.nodeId,
    });
    expect(response.status).toBe(400);
  });
});

describe("editor AI HTTP apply", () => {
  it("applies the proposal as an AI-sourced revision", async () => {
    const doc = await createPlainDocument("AI HTTP apply");

    const proposed = await propose(doc.documentId, {
      baseRevision: doc.revisionId,
      instructions: "set text to Changed by AI",
      nodeId: doc.nodeId,
    });
    expect(proposed.status).toBe(200);
    const proposal = (await proposed.json()) as {
      proposal: {
        proposalId: string;
        baseRevision: string;
        operation: Record<string, unknown>;
      };
    };

    const applied = await apply(doc.documentId, {
      baseRevision: proposal.proposal.baseRevision,
      proposalId: proposal.proposal.proposalId,
      operation: proposal.proposal.operation,
    });
    expect(applied.status).toBe(200);
    const detail = (await applied.json()) as {
      revision: { sourceType: string; sourceId: string | null };
      document: { revisionCount: number };
      snapshot: { nodes: Array<{ id: string; text: { value: string } | null }> };
    };
    expect(detail.revision.sourceType).toBe("AI");
    expect(detail.revision.sourceId).toBe(proposal.proposal.proposalId);
    expect(detail.document.revisionCount).toBe(2);
    expect(
      detail.snapshot.nodes.find((node) => node.id === doc.nodeId)?.text?.value,
    ).toBe("Changed by AI");
  });

  it("refuses to apply a proposal built on a superseded revision", async () => {
    const doc = await createPlainDocument("AI HTTP stale");

    const first = await propose(doc.documentId, {
      baseRevision: doc.revisionId,
      instructions: "set text to First apply",
      nodeId: doc.nodeId,
    });
    const firstBody = (await first.json()) as {
      proposal: {
        proposalId: string;
        baseRevision: string;
        operation: Record<string, unknown>;
      };
    };

    // A second, independent proposal on the same base: once the first lands,
    // this one's base revision is no longer the head.
    const stale = await propose(doc.documentId, {
      baseRevision: doc.revisionId,
      instructions: "set text to Stale apply",
      nodeId: doc.nodeId,
    });
    const staleBody = (await stale.json()) as {
      proposal: {
        proposalId: string;
        baseRevision: string;
        operation: Record<string, unknown>;
      };
    };

    const applied = await apply(doc.documentId, {
      baseRevision: firstBody.proposal.baseRevision,
      proposalId: firstBody.proposal.proposalId,
      operation: firstBody.proposal.operation,
    });
    expect(applied.status).toBe(200);

    const conflict = await apply(doc.documentId, {
      baseRevision: staleBody.proposal.baseRevision,
      proposalId: staleBody.proposal.proposalId,
      operation: staleBody.proposal.operation,
    });
    expect(conflict.status).toBe(409);
    const body = (await conflict.json()) as { code?: string };
    expect(body.code).toBe("EDITOR_REVISION_CONFLICT");
  });
});
