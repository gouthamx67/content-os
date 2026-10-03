import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ImageGenerationWorker } from "../generation-worker";
import type { LocalImageStorage } from "../storage/image-storage";
import {
  cleanupUser,
  loadImageTestContext,
  makeTempImageStorage,
  makeWorker,
  registerUser,
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

async function run(args: {
  prompt: string;
  width?: number;
  height?: number;
  templateType?: "PRODUCT_HERO" | "SOCIAL_POST";
}) {
  const job = await services.imageGenerationService.enqueue({
    projectId,
    requestedById: owner.user.id,
    templateType: args.templateType ?? "SOCIAL_POST",
    prompt: args.prompt,
    width: args.width ?? 480,
    height: args.height ?? 480,
  });
  await drain();
  const asset = await services.imageGenerationService.asset({
    projectId,
    jobId: job.id,
    userId: owner.user.id,
  });
  expect(asset).not.toBeNull();
  const bytes = await readFile(storage.absolutePath(asset!.storageKey));
  return { job, asset: asset!, bytes };
}

beforeAll(async () => {
  const context = await loadImageTestContext();
  services = context.services;
  orm = context.orm;

  const temp = await makeTempImageStorage();
  storage = temp.storage;
  cleanupStorage = temp.cleanup;
  worker = makeWorker({ services, storage });

  // A bare project: with no product or brand copy, the prompt is what the
  // templates draw, which is the case a variation check actually exercises.
  owner = await registerUser(services, "cp17-replay");
  const project = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "CP17 replay project" },
    owner.user.id,
  );
  projectId = project.id;
});

afterAll(async () => {
  if (owner) await cleanupUser(orm, owner, projectId);
  await cleanupStorage();
});

describe("generation replay and variation", () => {
  it("replays the same recipe + provider to identical bytes", async () => {
    const first = await run({ prompt: "Replay me exactly" });
    const second = await run({ prompt: "Replay me exactly" });

    expect(second.job.recipeSha256).toBe(first.job.recipeSha256);
    expect(first.job.generationRecipe).toBe(second.job.generationRecipe);
    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(second.asset.checksumSha256).toBe(first.asset.checksumSha256);
  });

  it("produces different bytes for a different prompt", async () => {
    const quiet = await run({ prompt: "A calm, quiet frame" });
    const loud = await run({ prompt: "A loud, urgent frame" });

    expect(loud.job.recipeSha256).not.toBe(quiet.job.recipeSha256);
    expect(loud.bytes.equals(quiet.bytes)).toBe(false);
  });

  it("changes the digest when only the canvas size changes", async () => {
    const square = await run({ prompt: "Same brief", width: 480, height: 480 });
    const wide = await run({ prompt: "Same brief", width: 640, height: 360 });

    expect(wide.job.recipeSha256).not.toBe(square.job.recipeSha256);
    expect(wide.bytes.equals(square.bytes)).toBe(false);
  });
});
