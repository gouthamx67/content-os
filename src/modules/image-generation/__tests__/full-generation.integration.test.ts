import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveAssetRef } from "../../visual-motion-engine/integrations/capture-take";
import type { RenderAssetDependencies } from "../../video-rendering/assets/render-asset-resolver";
import { RenderAssetResolver } from "../../video-rendering/assets/render-asset-resolver";
import { generatedAssetRef } from "../assets/asset-reference";
import { ImageGenerationWorker } from "../generation-worker";
import { parseGenerationRecipe } from "../recipe/generation-recipe";
import { hashRecipe } from "../serialization/hash-recipe";
import type { LocalImageStorage } from "../storage/image-storage";
import {
  cleanupUser,
  createFullProject,
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

function resolver(): RenderAssetResolver {
  return new RenderAssetResolver({
    captures: {} as never,
    assets: {} as never,
    images: services.imageRepository,
    captureStorage: {} as never,
    imageStorage: storage,
    storage: {} as never,
    probe: async () => ({ width: 512, height: 512 }),
  } satisfies Partial<RenderAssetDependencies> as RenderAssetDependencies);
}

beforeAll(async () => {
  const context = await loadImageTestContext();
  services = context.services;
  orm = context.orm;

  const temp = await makeTempImageStorage();
  storage = temp.storage;
  cleanupStorage = temp.cleanup;
  worker = makeWorker({ services, storage });

  const full = await createFullProject(services);
  owner = full.owner;
  projectId = full.projectId;
});

afterAll(async () => {
  if (owner) await cleanupUser(orm, owner, projectId);
  await cleanupStorage();
});

describe("full image generation path", () => {
  it("freezes the whole creative context into the recipe snapshot", async () => {
    const full = await createFullProject(services);
    try {
      const job = await services.imageGenerationService.enqueue({
        projectId: full.projectId,
        requestedById: full.owner.user.id,
        templateType: "PRODUCT_HERO",
        prompt: "Launch hero for the weekly status export",
        width: 512,
        height: 512,
        intentId: full.intentId,
        directionId: full.directionId,
        storyboardId: full.storyboardId,
        sceneId: full.sceneId,
      });
      await drain();

      const stored = await services.imageRepository.getJob(
        full.projectId,
        job.id,
      );
      expect(stored).not.toBeNull();
      expect(stored!.status).toBe("SUCCEEDED");

      const recipe = parseGenerationRecipe(stored!.generationRecipe);
      expect(recipe.context.intentId).toBe(full.intentId);
      expect(recipe.context.directionId).toBe(full.directionId);
      expect(recipe.context.storyboardId).toBe(full.storyboardId);
      expect(recipe.context.sceneId).toBe(full.sceneId);
      expect(recipe.width).toBe(512);
      expect(recipe.height).toBe(512);

      // The persisted recipe hash must match the snapshot on the row.
      expect(stored!.recipeSha256).toBe(hashRecipe(recipe));
    } finally {
      await cleanupUser(orm, full.owner, full.projectId);
    }
  });

  it("writes a real PNG, persists its artifact, and reads it back fresh", async () => {
    const job = await services.imageGenerationService.enqueue({
      projectId,
      requestedById: owner.user.id,
      templateType: "FEATURE_CALLOUT",
      prompt: "Feature callout for scheduled exports",
      width: 512,
      height: 512,
    });
    await drain();

    // Fresh read straight from the database, not from any in-memory handle.
    const row = await orm.GeneratedImageAsset.where({
      generationJobId: job.id,
    }).first();
    expect(row).not.toBeNull();

    const bytes = await readFile(storage.absolutePath(row!.storageKey as string));
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(digest).toBe(row!.checksumSha256);
    expect(row!.byteSize).toBe(bytes.byteLength);
    expect(row!.mimeType).toBe("image/png");

    const assetRef = generatedAssetRef(row!.id as string);
    const resolved = await resolveAssetRef(projectId, assetRef);
    expect(resolved.kind).toBe("generated");
    expect(resolved.width).toBe(512);

    const workDir = await mkdtemp(path.join(tmpdir(), "cp17-full-"));
    try {
      const compiled = await resolver().resolve(projectId, assetRef, workDir, 0);
      const rendered = await readFile(compiled.path);
      expect(rendered.equals(bytes)).toBe(true);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("replays the same recipe to the same bytes", async () => {
    const first = await services.imageGenerationService.enqueue({
      projectId,
      requestedById: owner.user.id,
      templateType: "QUOTE_CARD",
      prompt: "Replay me",
      width: 384,
      height: 384,
    });
    const second = await services.imageGenerationService.enqueue({
      projectId,
      requestedById: owner.user.id,
      templateType: "QUOTE_CARD",
      prompt: "Replay me",
      width: 384,
      height: 384,
    });
    await drain();

    const firstAsset = await services.imageGenerationService.asset({
      projectId,
      jobId: first.id,
      userId: owner.user.id,
    });
    const secondAsset = await services.imageGenerationService.asset({
      projectId,
      jobId: second.id,
      userId: owner.user.id,
    });

    expect(firstAsset!.checksumSha256).toBe(secondAsset!.checksumSha256);

    const firstBytes = await readFile(
      storage.absolutePath(firstAsset!.storageKey),
    );
    const secondBytes = await readFile(
      storage.absolutePath(secondAsset!.storageKey),
    );
    expect(firstBytes.equals(secondBytes)).toBe(true);
  });
});
