import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupUser,
  createAnalyzedProject,
  loadWritingTestContext,
  makeWorker,
  type Orm,
  type Services,
} from "./helpers";
import type { WritingGenerationWorker } from "../writing-generation-worker";

let orm: Orm;
let services: Services;
let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;
let worker: WritingGenerationWorker;

async function drain(target: WritingGenerationWorker): Promise<void> {
  for (let guard = 0; guard < 50; guard += 1) {
    if (!(await target.tick())) return;
  }
  throw new Error("writing queue did not drain");
}

async function enqueueHeadline(): Promise<string> {
  const job = await services.writingGenerationService.enqueue({
    projectId,
    requestedById: owner.user.id,
    blockType: "HEADLINE",
    tone: "BRAND",
    length: "MEDIUM",
    objective: "AWARENESS",
    prompt: "Announce our scheduling tool",
    variantCount: 3,
  });
  return job.id;
}

beforeAll(async () => {
  const loaded = await loadWritingTestContext();
  orm = loaded.orm;
  services = loaded.services;
  const created = await createAnalyzedProject(services);
  owner = created.owner;
  projectId = created.projectId;
  worker = makeWorker({ services });
  await drain(worker);
});

afterAll(async () => {
  await cleanupUser(orm, owner, projectId);
});

describe("writing postgres repository", () => {
  it("persists a queued job with an immutable recipe and context snapshot", async () => {
    const jobId = await enqueueHeadline();
    const job = await services.writingGenerationService.getJob({
      projectId,
      jobId,
      userId: owner.user.id,
    });

    expect(job.status).toBe("QUEUED");
    expect(job.generationRecipe.length).toBeGreaterThan(0);
    expect(job.recipeSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(job.contextSha256).toMatch(/^[0-9a-f]{64}$/);

    const snapshot = JSON.parse(job.contextSnapshot) as { facts: unknown[] };
    expect(snapshot.facts.length).toBeGreaterThan(0);
  });

  it("claims each queued job exactly once", async () => {
    await drain(worker);
    const jobId = await enqueueHeadline();

    const first = await services.writingRepository.claimNext();
    expect(first?.id).toBe(jobId);

    const second = await services.writingRepository.claimNext();
    expect(second).toBeNull();

    await worker.tick();
  });

  it("runs a job to a grounded document with persisted claims", async () => {
    await drain(worker);
    const jobId = await enqueueHeadline();
    await drain(worker);

    const job = await services.writingGenerationService.getJob({
      projectId,
      jobId,
      userId: owner.user.id,
    });
    expect(job.status).toBe("SUCCEEDED");
    expect(job.documentId).toBeTruthy();
    expect(job.providerModel).toBe("local-rules");

    const view = await services.writingGenerationService.getDocument({
      projectId,
      documentId: job.documentId!,
      userId: owner.user.id,
    });
    expect(view.document.content.length).toBeGreaterThan(0);
    expect(view.variants.length).toBeGreaterThan(0);
    expect(view.variants.some((variant) => variant.selected)).toBe(true);
    expect(view.claims.length).toBeGreaterThan(0);
    for (const claim of view.claims) {
      expect(claim.status).not.toBe("UNSUPPORTED");
    }

    // A generated document must point at its selected variant, otherwise the
    // UI (which filters claims by selectedVariantId) shows a document with no
    // provenance even though claims exist.
    const selected = view.variants.find((variant) => variant.selected);
    expect(selected).toBeTruthy();
    expect(view.document.selectedVariantId).toBe(selected!.id);
    expect(view.document.content).toBe(selected!.text);
    const selectedClaims = view.claims.filter(
      (claim) => claim.variantId === selected!.id,
    );
    expect(selectedClaims.length).toBeGreaterThan(0);
  });

  it("only ever records real source ids as claim provenance", async () => {
    await drain(worker);
    const jobId = await enqueueHeadline();
    await drain(worker);

    const job = await services.writingGenerationService.getJob({
      projectId,
      jobId,
      userId: owner.user.id,
    });
    const view = await services.writingGenerationService.getDocument({
      projectId,
      documentId: job.documentId!,
      userId: owner.user.id,
    });

    const snapshot = JSON.parse(view.document.contextSnapshot) as {
      sourceIds: string[];
      facts: Array<{ entityId: string }>;
    };
    const allowed = new Set(snapshot.sourceIds);
    const entityIds = new Set(snapshot.facts.map((fact) => fact.entityId));

    // The invariant CP12 failed: an entity id is never a source id.
    expect(snapshot.sourceIds).not.toContain(view.document.id);
    for (const claim of view.claims) {
      for (const sourceId of claim.sourceIds) {
        expect(allowed.has(sourceId)).toBe(true);
        expect(entityIds.has(sourceId)).toBe(false);
      }
    }
  });

  it("scopes documents to their project", async () => {
    await drain(worker);
    const jobId = await enqueueHeadline();
    await drain(worker);
    const job = await services.writingGenerationService.getJob({
      projectId,
      jobId,
      userId: owner.user.id,
    });

    await expect(
      services.writingGenerationService.getDocument({
        projectId: "project_does_not_exist",
        documentId: job.documentId!,
        userId: owner.user.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
