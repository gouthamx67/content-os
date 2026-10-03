import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectImage } from "../artifact/image-metadata";
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

describe("real image generation through the worker", () => {
  it("turns a queued job into a real PNG plus an asset row", async () => {
    const job = await services.imageGenerationService.enqueue({
      projectId,
      requestedById: owner.user.id,
      templateType: "PRODUCT_HERO",
      prompt: "Announce our storyboards",
      width: 640,
      height: 640,
    });

    expect(job.status).toBe("QUEUED");
    expect(job.recipeSha256).toMatch(/^[0-9a-f]{64}$/);

    await drain();

    const finished = await services.imageGenerationService.get({
      projectId,
      jobId: job.id,
      userId: owner.user.id,
    });
    expect(finished.status).toBe("SUCCEEDED");
    expect(finished.progressPct).toBe(100);
    expect(finished.startedAt).toBeTruthy();
    expect(finished.finishedAt).toBeTruthy();
    expect(finished.providerVersion).toBe("local-graphic/1");

    const asset = await services.imageGenerationService.asset({
      projectId,
      jobId: job.id,
      userId: owner.user.id,
    });
    expect(asset).not.toBeNull();
    expect(asset!.mimeType).toBe("image/png");
    expect(asset!.width).toBe(640);
    expect(asset!.height).toBe(640);
    expect(asset!.transparent).toBe(false);

    // The stored bytes really live on disk and really are a PNG.
    const bytes = await readFile(storage.absolutePath(asset!.storageKey));
    expect(bytes.subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(bytes.byteLength).toBe(asset!.byteSize);

    const metadata = await inspectImage(bytes);
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(640);

    const parsedMeta = JSON.parse(asset!.metadata ?? "{}") as {
      width?: number;
      height?: number;
    };
    expect(parsedMeta.width).toBe(640);
    expect(parsedMeta.height).toBe(640);
  });

  it("produces a real JPEG when asked", async () => {
    const job = await services.imageGenerationService.enqueue({
      projectId,
      requestedById: owner.user.id,
      templateType: "FEATURE_CALLOUT",
      prompt: "One feature, one panel",
      width: 512,
      height: 288,
      outputFormat: "JPEG",
    });
    await drain();

    const asset = await services.imageGenerationService.asset({
      projectId,
      jobId: job.id,
      userId: owner.user.id,
    });
    expect(asset?.mimeType).toBe("image/jpeg");

    const bytes = await readFile(storage.absolutePath(asset!.storageKey));
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it("keeps a transparent PNG genuinely alpha", async () => {
    const job = await services.imageGenerationService.enqueue({
      projectId,
      requestedById: owner.user.id,
      templateType: "QUOTE_CARD",
      prompt: "A quote over nothing",
      width: 400,
      height: 400,
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
    expect(alpha!.min).toBeLessThan(255);
  });
});
