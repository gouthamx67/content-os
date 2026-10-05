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

function worker(): WritingGenerationWorker {
  return makeWorker({ services });
}

async function drain(target: WritingGenerationWorker): Promise<void> {
  for (let guard = 0; guard < 200; guard += 1) {
    if (!(await target.tick())) return;
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
  await drain(worker());
});

afterAll(async () => {
  await cleanupUser(orm, owner, projectId);
});

describe("writing worker concurrency", () => {
  it("processes a job exactly once with competing workers", async () => {
    const job = await services.writingGenerationService.enqueue({
      projectId,
      requestedById: owner.user.id,
      blockType: "HOOK",
      tone: "BOLD",
      length: "SHORT",
      objective: "AWARENESS",
      prompt: "One hook",
      variantCount: 3,
    });

    const a = worker();
    const b = worker();
    await Promise.all([a.tick(), b.tick()]);

    const fresh = await services.writingGenerationService.getJob({
      projectId,
      jobId: job.id,
      userId: owner.user.id,
    });
    expect(fresh.status).toBe("SUCCEEDED");
    expect(fresh.errorCode).toBeNull();
    expect(fresh.documentId).toBeTruthy();
  });

  it("runs many jobs across many workers without double-writing", async () => {
    await drain(worker());

    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const job = await services.writingGenerationService.enqueue({
        projectId,
        requestedById: owner.user.id,
        blockType: "SUBHEAD",
        tone: "PROFESSIONAL",
        length: "SHORT",
        objective: "EDUCATION",
        prompt: `Subhead ${index}`,
        variantCount: 2,
      });
      ids.push(job.id);
    }

    await Promise.all([drain(worker()), drain(worker()), drain(worker())]);

    const documents = new Set<string>();
    for (const id of ids) {
      const job = await services.writingGenerationService.getJob({
        projectId,
        jobId: id,
        userId: owner.user.id,
      });
      expect(job.status).toBe("SUCCEEDED");
      expect(job.documentId).toBeTruthy();
      documents.add(job.documentId!);
    }
    expect(documents.size).toBe(4);
  });
});
