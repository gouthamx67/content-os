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
  const created = await createAnalyzedProject(services);
  owner = created.owner;
  projectId = created.projectId;
  worker = makeWorker({ services });
  await drain();
});

afterAll(async () => {
  await cleanupUser(orm, owner, projectId);
});

describe("writing context snapshot", () => {
  it("writes exactly the context frozen at enqueue time", async () => {
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

    await drain();

    const fresh = await services.writingGenerationService.getJob({
      projectId,
      jobId: job.id,
      userId: owner.user.id,
    });
    expect(fresh.contextSnapshot).toBe(job.contextSnapshot);
    expect(fresh.contextSha256).toBe(job.contextSha256);
    expect(fresh.generationRecipe).toBe(job.generationRecipe);

    const view = await services.writingGenerationService.getDocument({
      projectId,
      documentId: fresh.documentId!,
      userId: owner.user.id,
    });
    expect(view.document.contextSnapshot).toBe(job.contextSnapshot);
    expect(view.document.contextSha256).toBe(job.contextSha256);
  });

  it("stores a well-formed recipe that survives re-reading", async () => {
    const job = await services.writingGenerationService.enqueue({
      projectId,
      requestedById: owner.user.id,
      blockType: "CAPTION",
      tone: "FRIENDLY",
      length: "SHORT",
      objective: "CONSIDERATION",
      prompt: "One caption",
      variantCount: 2,
    });

    expect(job.recipeSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(job.contextSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(job.generationRecipe)).toBeTruthy();

    const fresh = await services.writingGenerationService.getJob({
      projectId,
      jobId: job.id,
      userId: owner.user.id,
    });
    expect(fresh.recipeSha256).toBe(job.recipeSha256);
    expect(fresh.contextSha256).toBe(job.contextSha256);

    await drain();
  });
});
