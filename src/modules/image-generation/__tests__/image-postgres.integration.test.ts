import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ImageGenerationRepository } from "../../../core/ports/image-generation-repository";
import type { ImageGenerationJobRecord } from "../domain/types";
import {
  cleanupUser,
  loadImageTestContext,
  registerUser,
  type Orm,
  type Services,
} from "./helpers";

let services: Services;
let orm: Orm;
let repository: ImageGenerationRepository;

let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;

const created: string[] = [];

function jobInput(
  id: string,
  overrides: Partial<Parameters<ImageGenerationRepository["createJob"]>[0]> = {},
) {
  const now = new Date().toISOString();
  return {
    id,
    projectId,
    requestedById: owner.user.id,
    graphicDocumentId: null,
    provider: "LOCAL_GRAPHIC" as const,
    outputFormat: "PNG" as const,
    width: 512,
    height: 512,
    transparent: false,
    prompt: "A queued image",
    generationRecipe: JSON.stringify({ contractVersion: 1 }),
    recipeSha256: "a".repeat(64),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeAll(async () => {
  const context = await loadImageTestContext();
  services = context.services;
  orm = context.orm;
  repository = services.imageRepository;

  owner = await registerUser(services, "cp17-repo");
  const project = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "CP17 repository project" },
    owner.user.id,
  );
  projectId = project.id;
});

afterAll(async () => {
  if (owner) await cleanupUser(orm, owner, projectId);
});

describe("graphic documents in postgres", () => {
  it("creates, reads, lists, updates and soft-deletes", async () => {
    const now = new Date().toISOString();
    const id = `gdoc_test_${Date.now()}`;
    created.push(id);

    await repository.createDocument({
      id,
      projectId,
      createdById: owner.user.id,
      name: "First draft",
      templateType: "PRODUCT_HERO",
      width: 1080,
      height: 1080,
      outputFormat: "PNG",
      transparent: false,
      designGraph: JSON.stringify({ contractVersion: 1, elements: [] }),
      designGraphHash: "b".repeat(64),
      contractVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    const read = await repository.getDocument(projectId, id);
    expect(read?.name).toBe("First draft");
    expect(read?.templateType).toBe("PRODUCT_HERO");

    const listed = await repository.listDocuments(projectId);
    expect(listed.map((document) => document.id)).toContain(id);

    const updated = await repository.updateDocument(projectId, id, {
      name: "Renamed",
      updatedAt: new Date().toISOString(),
    });
    expect(updated.name).toBe("Renamed");

    await repository.softDeleteDocument(projectId, id, new Date().toISOString());
    expect(await repository.getDocument(projectId, id)).toBeNull();
  });

  it("does not read another project's document by id", async () => {
    const now = new Date().toISOString();
    const id = `gdoc_iso_${Date.now()}`;
    created.push(id);

    await repository.createDocument({
      id,
      projectId,
      createdById: owner.user.id,
      name: "Private",
      templateType: "QUOTE_CARD",
      width: 1080,
      height: 1080,
      outputFormat: "PNG",
      transparent: false,
      designGraph: "{}",
      designGraphHash: "c".repeat(64),
      contractVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    expect(await repository.getDocument("project_other", id)).toBeNull();
  });
});

describe("generation jobs in postgres", () => {
  it("stores the exact recipe snapshot and lists by status", async () => {
    const id = `ijob_snap_${Date.now()}`;
    created.push(id);
    const recipe = JSON.stringify({
      contractVersion: 1,
      prompt: "frozen",
      nested: { deep: true },
    });

    await repository.createJob(jobInput(id, { generationRecipe: recipe }));

    const read = await repository.getJob(projectId, id);
    expect(read?.generationRecipe).toBe(recipe);
    expect(read?.status).toBe("QUEUED");
    expect(read?.progressPct).toBe(0);

    const queued = await repository.listJobs(projectId, { status: "QUEUED" });
    expect(queued.map((job) => job.id)).toContain(id);

    const running = await repository.listJobs(projectId, { status: "RUNNING" });
    expect(running.map((job) => job.id)).not.toContain(id);
  });

  it("atomically claims a queued job and never claims it twice", async () => {
    // Drain anything an earlier test left queued so the only candidate is ours.
    let drain = await repository.claimNext();
    while (drain) drain = await repository.claimNext();

    const id = `ijob_claim_${Date.now()}`;
    created.push(id);
    await repository.createJob(jobInput(id));

    const [first, second] = await Promise.all([
      repository.claimNext(),
      repository.claimNext(),
    ]);

    const winners = [first, second].filter(
      (job): job is ImageGenerationJobRecord => job !== null,
    );
    expect(winners).toHaveLength(1);
    expect(winners[0]!.id).toBe(id);
    expect(winners[0]!.status).toBe("RUNNING");
  });

  it("returns null when nothing is queued", async () => {
    // Drain: any job left queued by another test is claimed first, then empty.
    let claim = await repository.claimNext();
    while (claim) claim = await repository.claimNext();
    expect(await repository.claimNext()).toBeNull();
  });

  it("walks RUNNING -> CANCEL_REQUESTED -> CANCELLED", async () => {
    const id = `ijob_cancel_${Date.now()}`;
    created.push(id);
    await repository.createJob(jobInput(id));
    await repository.claimNext();

    const requested = await repository.requestCancel(projectId, id);
    expect(requested).toBe(true);
    expect((await repository.getJob(projectId, id))?.status).toBe(
      "CANCEL_REQUESTED",
    );

    const finish = new Date().toISOString();
    await repository.markCancelled({ jobId: id, finishedAt: finish, updatedAt: finish });
    expect((await repository.getJob(projectId, id))?.status).toBe("CANCELLED");

    // A cancelled job can never be resumed.
    expect(await repository.requestCancel(projectId, id)).toBe(false);
  });

  it("cancels a QUEUED job directly and refuses to cancel a finished one", async () => {
    const queuedId = `ijob_qcancel_${Date.now()}`;
    created.push(queuedId);
    await repository.createJob(jobInput(queuedId));

    expect(await repository.requestCancel(projectId, queuedId)).toBe(true);
    expect((await repository.getJob(projectId, queuedId))?.status).toBe(
      "CANCELLED",
    );

    const doneId = `ijob_done_${Date.now()}`;
    created.push(doneId);
    await repository.createJob(jobInput(doneId));
    await repository.claimNext();
    await repository.markSucceeded({
      jobId: doneId,
      providerJobId: null,
      providerModel: null,
      providerVersion: "local-graphic/1",
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(await repository.requestCancel(projectId, doneId)).toBe(false);
  });

  it("persists failure details", async () => {
    const id = `ijob_fail_${Date.now()}`;
    created.push(id);
    await repository.createJob(jobInput(id));
    await repository.claimNext();
    await repository.markFailed({
      jobId: id,
      errorCode: "IMAGE_GENERATION_FAILED",
      errorMessage: "sharp exploded",
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const read = await repository.getJob(projectId, id);
    expect(read?.status).toBe("FAILED");
    expect(read?.errorCode).toBe("IMAGE_GENERATION_FAILED");
    expect(read?.errorMessage).toBe("sharp exploded");
  });
});
