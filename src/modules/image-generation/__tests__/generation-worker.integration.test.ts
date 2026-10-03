import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenderWorkerHealth } from "../../video-rendering/worker-health";
import type { LocalImageStorage } from "../storage/image-storage";
import {
  cleanupUser,
  createAnalyzedProject,
  loadImageTestContext,
  makeTempImageStorage,
  makeWorker,
  registerUser,
  type Orm,
  type Services,
} from "./helpers";

let services: Services;
let orm: Orm;
let storage: LocalImageStorage;
let cleanupStorage: () => Promise<void>;
let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;

beforeAll(async () => {
  const context = await loadImageTestContext();
  services = context.services;
  orm = context.orm;

  const temp = await makeTempImageStorage();
  storage = temp.storage;
  cleanupStorage = temp.cleanup;

  const analyzed = await createAnalyzedProject(services);
  owner = analyzed.owner;
  projectId = analyzed.projectId;
});

afterAll(async () => {
  if (owner) await cleanupUser(orm, owner, projectId);
  await cleanupStorage();
});

async function enqueueValid(prompt: string) {
  return services.imageGenerationService.enqueue({
    projectId,
    requestedById: owner.user.id,
    templateType: "SOCIAL_POST",
    prompt,
    width: 320,
    height: 320,
  });
}

describe("image generation worker", () => {
  it("lets only one of two racing workers claim a job", async () => {
    const job = await enqueueValid("Race me");
    const healthA = new RenderWorkerHealth();
    const healthB = new RenderWorkerHealth();
    const workerA = makeWorker({ services, storage, health: healthA });
    const workerB = makeWorker({ services, storage, health: healthB });

    const [a, b] = await Promise.all([workerA.tick(), workerB.tick()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);

    const finished = await services.imageGenerationService.get({
      projectId,
      jobId: job.id,
      userId: owner.user.id,
    });
    expect(finished.status).toBe("SUCCEEDED");

    const assets = await services.imageRepository.listAssets(projectId, {
      generationJobId: job.id,
    });
    expect(assets).toHaveLength(1);
    expect(assets[0]!.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("marks an unparseable recipe as FAILED and never leaves it RUNNING", async () => {
    const now = new Date().toISOString();
    const job = await services.imageRepository.createJob({
      id: `ijob_bad_${Date.now()}`,
      projectId,
      requestedById: owner.user.id,
      graphicDocumentId: null,
      provider: "LOCAL_GRAPHIC",
      outputFormat: "PNG",
      width: 100,
      height: 100,
      transparent: false,
      prompt: "Broken",
      generationRecipe: "{not json",
      recipeSha256: "d".repeat(64),
      createdAt: now,
      updatedAt: now,
    });

    const worker = makeWorker({ services, storage });
    await worker.tick();

    const read = await services.imageRepository.getJob(projectId, job.id);
    expect(read?.status).toBe("FAILED");
    expect(read?.errorCode).toBe("IMAGE_INVALID_REQUEST");
    expect(read?.errorMessage).toBeTruthy();
  });

  it("finalizes an orphaned cancel request left by a dead worker", async () => {
    const job = await enqueueValid("Cancel me while running");

    // Simulate a worker that died mid-run: claim, then request cancellation.
    const claimed = await services.imageRepository.claimNext();
    expect(claimed?.id).toBe(job.id);
    expect(await services.imageRepository.requestCancel(projectId, job.id)).toBe(
      true,
    );
    expect(
      (await services.imageRepository.getJob(projectId, job.id))?.status,
    ).toBe("CANCEL_REQUESTED");

    // A fresh worker owns no current job, so it finalizes the orphan.
    const worker = makeWorker({ services, storage });
    await worker.tick();

    const read = await services.imageRepository.getJob(projectId, job.id);
    expect(read?.status).toBe("CANCELLED");
  });

  it("does not claim a job that was cancelled while queued", async () => {
    const job = await enqueueValid("Cancel before start");
    expect(await services.imageRepository.requestCancel(projectId, job.id)).toBe(
      true,
    );

    const worker = makeWorker({ services, storage });
    const worked = await worker.tick();
    expect(worked).toBe(false);

    const read = await services.imageRepository.getJob(projectId, job.id);
    expect(read?.status).toBe("CANCELLED");
  });

  it("keeps jobs and assets scoped to their own project", async () => {
    const other = await registerUser(services, "cp17-other");
    const otherProject = await services.projectService.createForWorkspace(
      other.workspace!.id,
      { name: "CP17 other project" },
      other.user.id,
    );

    try {
      const job = await enqueueValid("Mine only");
      const otherAssets = await services.imageRepository.listAssets(
        otherProject.id,
      );
      expect(otherAssets).toHaveLength(0);

      expect(
        await services.imageRepository.getJob(otherProject.id, job.id),
      ).toBeNull();

      // Leave the queue as clean as it was found.
      await services.imageRepository.requestCancel(projectId, job.id);
    } finally {
      await cleanupUser(orm, other, otherProject.id);
    }
  });
});
