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

async function enqueue(): Promise<string> {
  const job = await services.writingGenerationService.enqueue({
    projectId,
    requestedById: owner.user.id,
    blockType: "HEADLINE",
    tone: "BRAND",
    length: "MEDIUM",
    objective: "AWARENESS",
    prompt: "Cancellation brief",
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
  await drain();
});

afterAll(async () => {
  await cleanupUser(orm, owner, projectId);
});

describe("writing cancellation", () => {
  it("cancels a queued job outright", async () => {
    const jobId = await enqueue();
    const cancelled = await services.writingGenerationService.cancel({
      projectId,
      jobId,
      userId: owner.user.id,
    });
    expect(cancelled.status).toBe("CANCELLED");

    // The worker must leave a terminal job alone.
    const before = await services.writingGenerationService.getJob({
      projectId,
      jobId,
      userId: owner.user.id,
    });
    await worker.tick();
    const after = await services.writingGenerationService.getJob({
      projectId,
      jobId,
      userId: owner.user.id,
    });
    expect(after.status).toBe(before.status);
  });

  it("finalizes a cancellation requested while running", async () => {
    const jobId = await enqueue();
    await orm.WritingGenerationJob.where({ id: jobId }).update({
      status: "CANCEL_REQUESTED",
      updatedAt: new Date().toISOString(),
    });

    await worker.tick();

    const job = await services.writingGenerationService.getJob({
      projectId,
      jobId,
      userId: owner.user.id,
    });
    expect(job.status).toBe("CANCELLED");
  });

  it("does not cancel a finished job", async () => {
    const jobId = await enqueue();
    await drain();

    const finished = await services.writingGenerationService.getJob({
      projectId,
      jobId,
      userId: owner.user.id,
    });
    expect(finished.status).toBe("SUCCEEDED");

    const result = await services.writingGenerationService.cancel({
      projectId,
      jobId,
      userId: owner.user.id,
    });
    expect(result.status).toBe("SUCCEEDED");
  });
});
