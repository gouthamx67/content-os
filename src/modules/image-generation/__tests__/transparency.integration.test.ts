import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ImageGenerationWorker } from "../generation-worker";
import type { LocalImageStorage } from "../storage/image-storage";
import {
  cleanupUser,
  createAnalyzedProject,
  loadImageTestContext,
  makeTempImageStorage,
  makeWorker,
  type Orm,
  type Services,
} from "./helpers";

let services: Services;
let orm: Orm;
let worker: ImageGenerationWorker;
let storage: LocalImageStorage;
let cleanupStorage: () => Promise<void>;
let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;

async function drain(): Promise<void> {
  let worked = await worker.tick();
  while (worked) worked = await worker.tick();
}

beforeAll(async () => {
  const context = await loadImageTestContext();
  services = context.services;
  orm = context.orm;

  const temp = await makeTempImageStorage();
  storage = temp.storage;
  cleanupStorage = temp.cleanup;
  worker = makeWorker({ services, storage });

  const analyzed = await createAnalyzedProject(services);
  owner = analyzed.owner;
  projectId = analyzed.projectId;
});

afterAll(async () => {
  if (owner) await cleanupUser(orm, owner, projectId);
  await cleanupStorage();
});

describe("transparency", () => {
  it("stores a transparent PNG whose alpha channel carries real transparency", async () => {
    const job = await services.imageGenerationService.enqueue({
      projectId,
      requestedById: owner.user.id,
      templateType: "PROMO_CARD",
      prompt: "A floating badge",
      width: 420,
      height: 420,
      outputFormat: "PNG",
      transparent: true,
    });
    await drain();

    const asset = await services.imageGenerationService.asset({
      projectId,
      jobId: job.id,
      userId: owner.user.id,
    });
    expect(asset?.transparent).toBe(true);

    const bytes = await readFile(storage.absolutePath(asset!.storageKey));
    const stats = await sharp(bytes).stats();
    const alpha = stats.channels[3];
    expect(alpha).toBeDefined();
    expect(alpha!.min).toBe(0);
    expect(alpha!.max).toBe(255);
  });

  it("refuses a transparent JPEG with a 422 rather than flattening it", async () => {
    await expect(
      services.imageGenerationService.enqueue({
        projectId,
        requestedById: owner.user.id,
        templateType: "PROMO_CARD",
        prompt: "No alpha in JPEG",
        width: 420,
        height: 420,
        outputFormat: "JPEG",
        transparent: true,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("marks a normal PNG as opaque", async () => {
    const job = await services.imageGenerationService.enqueue({
      projectId,
      requestedById: owner.user.id,
      templateType: "PROMO_CARD",
      prompt: "A solid card",
      width: 420,
      height: 420,
      outputFormat: "PNG",
      transparent: false,
    });
    await drain();

    const asset = await services.imageGenerationService.asset({
      projectId,
      jobId: job.id,
      userId: owner.user.id,
    });
    expect(asset?.transparent).toBe(false);

    const bytes = await readFile(storage.absolutePath(asset!.storageKey));
    const stats = await sharp(bytes).stats();
    const alpha = stats.channels[3];
    if (alpha) {
      expect(alpha.min).toBe(255);
    } else {
      expect(asset?.mimeType).toBe("image/png");
    }
  });
});
