import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupUser,
  createFullProject,
  loadWritingTestContext,
  makeWorker,
  type FullProjectContext,
  type Orm,
  type Services,
} from "./helpers";
import type { WritingGenerationWorker } from "../writing-generation-worker";

let orm: Orm;
let services: Services;
let project: FullProjectContext;
let worker: WritingGenerationWorker;

async function drain(): Promise<void> {
  for (let guard = 0; guard < 50; guard += 1) {
    if (!(await worker.tick())) return;
  }
  throw new Error("writing queue did not drain");
}

beforeAll(async () => {
  const loaded = await loadWritingTestContext();
  orm = loaded.orm;
  services = loaded.services;
  project = await createFullProject(services);
  worker = makeWorker({ services });
  await drain();
});

afterAll(async () => {
  await cleanupUser(orm, project.owner, project.projectId);
});

describe("source id semantics", () => {
  it("never stores an entity id as a claim source id", async () => {
    const job = await services.writingGenerationService.enqueue({
      projectId: project.projectId,
      requestedById: project.owner.user.id,
      blockType: "PRODUCT_DESCRIPTION",
      tone: "PROFESSIONAL",
      length: "LONG",
      objective: "PRODUCT_EXPLANATION",
      prompt: "Describe the product",
      variantCount: 3,
      intentId: project.intentId,
      directionId: project.directionId,
      sceneId: project.sceneId,
    });
    await drain();

    const record = await services.writingGenerationService.getJob({
      projectId: project.projectId,
      jobId: job.id,
      userId: project.owner.user.id,
    });
    const view = await services.writingGenerationService.getDocument({
      projectId: project.projectId,
      documentId: record.documentId!,
      userId: project.owner.user.id,
    });

    const snapshot = JSON.parse(view.document.contextSnapshot) as {
      sourceIds: string[];
      facts: Array<{ entityId: string }>;
    };
    const realSources = new Set(snapshot.sourceIds);
    const entityIds = new Set(snapshot.facts.map((fact) => fact.entityId));

    expect(realSources.size).toBeGreaterThan(0);
    for (const claim of view.claims) {
      for (const id of claim.sourceIds) {
        expect(realSources.has(id)).toBe(true);
        expect(entityIds.has(id)).toBe(false);
      }
    }
  });
});
