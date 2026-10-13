import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupUser,
  createCompositionSource,
  createImageSource,
  createProject,
  createWritingSource,
  drain,
  loadAdaptationTestContext,
  makeWorker,
  type Container,
  type Orm,
  type Services,
} from "./helpers";
import type { AdaptationWorker } from "../adaptation-worker";
import { adaptationStorage } from "../storage/adaptation-storage";
import { inspectImage } from "../../image-generation/artifact/image-metadata";

let orm: Orm;
let services: Services;
let container: Container;
let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;
let worker: AdaptationWorker;

async function batchJobs(batchId: string) {
  return services.adaptationRepository.listJobs(batchId);
}

async function jobNamed(batchId: string, formatId: string) {
  const jobs = await batchJobs(batchId);
  return jobs.find((job) => job.formatId === formatId);
}

beforeAll(async () => {
  const loaded = await loadAdaptationTestContext();
  orm = loaded.orm;
  services = loaded.services;
  container = loaded.container;
  const created = await createProject(services);
  owner = created.owner;
  projectId = created.projectId;
  worker = makeWorker(container);
});

afterAll(async () => {
  await cleanupUser(orm, owner, projectId);
});

describe("copy adaptation", () => {
  it("fits a caption to a limit without inventing a word", async () => {
    const writing = await createWritingSource(orm, services, {
      projectId,
      userId: owner.user.id,
    });

    const created = await services.adaptationService.createBatch({
      projectId,
      userId: owner.user.id,
      sourceType: "WRITING_VARIANT",
      sourceId: writing.variantId,
      targets: [{ formatId: "COPY_SHORT" }],
    });

    await drain(worker);

    const job = await jobNamed(created.batch.id, "COPY_SHORT");

    expect(job?.status).toBe("SUCCEEDED");
    expect(job?.kind).toBe("COPY");
    expect(job?.outputText).toBeTruthy();
    expect(job!.outputText!.length).toBeLessThanOrEqual(80);

    // Fitting only ever removes, so the output must still be a prefix of the
    // source text rather than a rewrite.
    const source = await services.adaptationSourceResolver.resolve({
      projectId,
      sourceType: "WRITING_VARIANT",
      sourceId: writing.variantId,
    });

    if (source.sourceType === "WRITING_VARIANT") {
      expect(
        source.text.replace(/\s+/g, " ").startsWith(
          job!.outputText!.replace(/\s+/g, " ").slice(0, 20),
        ),
      ).toBe(true);
    }

    expect(created.batch.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("claims only the sources behind the claims the shortened caption kept", async () => {
    const writing = await createWritingSource(orm, services, {
      projectId,
      userId: owner.user.id,
    });

    const created = await services.adaptationService.createBatch({
      projectId,
      userId: owner.user.id,
      sourceType: "WRITING_VARIANT",
      sourceId: writing.variantId,
      targets: [{ formatId: "COPY_SHORT" }],
    });

    const job = await jobNamed(created.batch.id, "COPY_SHORT");
    const { parseRecipe } = await import("../recipe/hash-recipe");
    const recipe = parseRecipe(job!.recipe);

    // COPY_SHORT keeps the opening sentences, so the source behind the first
    // claim is claimed and the one behind the closing claim is not.
    expect(recipe.provenanceSourceIds).toContain(writing.sourceIds[0]!);
    expect(recipe.provenanceSourceIds).not.toContain(writing.sourceIds[1]!);
  });

  it("serves the adapted text through the job text read", async () => {
    const writing = await createWritingSource(orm, services, {
      projectId,
      userId: owner.user.id,
    });

    const created = await services.adaptationService.createBatch({
      projectId,
      userId: owner.user.id,
      sourceType: "WRITING_VARIANT",
      sourceId: writing.variantId,
      targets: [{ formatId: "COPY_MEDIUM" }],
    });

    await drain(worker);

    const job = await jobNamed(created.batch.id, "COPY_MEDIUM");
    const text = await services.adaptationService.getJobText({
      projectId,
      jobId: job!.id,
      userId: owner.user.id,
    });

    expect(text.text).toBe(job!.outputText);
    expect(text.text.length).toBeLessThanOrEqual(300);
  });

  it("refuses to copy a composition", async () => {
    const composition = await createCompositionSource(services, {
      projectId,
      userId: owner.user.id,
    });

    await expect(
      services.adaptationService.createBatch({
        projectId,
        userId: owner.user.id,
        sourceType: "VISUAL_COMPOSITION",
        sourceId: composition.compositionId,
        targets: [{ formatId: "COPY_SHORT" }],
      }),
    ).rejects.toMatchObject({ code: "ADAPTATION_FORMAT_KIND_MISMATCH" });
  });
});

describe("image adaptation", () => {
  it("produces a real PNG at the format's exact dimensions", async () => {
    const image = await createImageSource(
      services,
      { projectId, userId: owner.user.id },
      { width: 1200, height: 900 },
    );

    const created = await services.adaptationService.createBatch({
      projectId,
      userId: owner.user.id,
      sourceType: "GENERATED_IMAGE",
      sourceId: image.assetId,
      targets: [{ formatId: "IMAGE_SQUARE" }],
    });

    await drain(worker);

    const job = await jobNamed(created.batch.id, "IMAGE_SQUARE");

    expect(job?.status).toBe("SUCCEEDED");
    expect(job?.outputMimeType).toBe("image/png");
    expect(job?.outputWidth).toBe(1080);
    expect(job?.outputHeight).toBe(1080);
    expect(job?.outputByteSize).toBeGreaterThan(0);
    expect(job?.outputChecksumSha256).toMatch(/^[0-9a-f]{64}$/);

    // The recorded facts have to match the bytes actually on disk.
    const bytes = await readStored(job!.outputStorageKey!);
    const metadata = await inspectImage(bytes);

    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1080);
    expect(metadata.format).toBe("png");
  });

  it("crops a wide source into a vertical cut", async () => {
    const image = await createImageSource(
      services,
      { projectId, userId: owner.user.id },
      { width: 2000, height: 1000 },
    );

    const created = await services.adaptationService.createBatch({
      projectId,
      userId: owner.user.id,
      sourceType: "GENERATED_IMAGE",
      sourceId: image.assetId,
      targets: [{ formatId: "IMAGE_VERTICAL" }],
    });

    await drain(worker);

    const job = await jobNamed(created.batch.id, "IMAGE_VERTICAL");

    expect(job?.status).toBe("SUCCEEDED");
    expect(job?.outputWidth).toBe(1080);
    expect(job?.outputHeight).toBe(1920);
  });

  it("refuses a transparent cut of an opaque source instead of inventing alpha", async () => {
    const image = await createImageSource(
      services,
      { projectId, userId: owner.user.id },
      { width: 800, height: 800 },
    );

    const created = await services.adaptationService.createBatch({
      projectId,
      userId: owner.user.id,
      sourceType: "GENERATED_IMAGE",
      sourceId: image.assetId,
      targets: [{ formatId: "IMAGE_TRANSPARENT" }],
    });

    await drain(worker);

    const job = await jobNamed(created.batch.id, "IMAGE_TRANSPARENT");

    expect(job?.status).toBe("FAILED");
    expect(job?.errorCode).toBe("ADAPTATION_IMAGE_SOURCE_OPAQUE");
  });

  it("keeps real transparency when the source has it", async () => {
    const image = await createImageSource(
      services,
      { projectId, userId: owner.user.id },
      { width: 900, height: 900, transparent: true },
    );

    const created = await services.adaptationService.createBatch({
      projectId,
      userId: owner.user.id,
      sourceType: "GENERATED_IMAGE",
      sourceId: image.assetId,
      targets: [{ formatId: "IMAGE_TRANSPARENT" }],
    });

    await drain(worker);

    const job = await jobNamed(created.batch.id, "IMAGE_TRANSPARENT");

    expect(job?.status).toBe("SUCCEEDED");
    expect(job?.outputWidth).toBe(1600);
    expect(job?.outputHeight).toBe(1600);

    const { hasTransparentPixels } = await import(
      "../../image-generation/artifact/image-metadata"
    );
    const bytes = await readStored(job!.outputStorageKey!);

    expect(await hasTransparentPixels(bytes)).toBe(true);
  });

  it("fails a job when the source bytes changed after the batch was planned", async () => {
    const image = await createImageSource(
      services,
      { projectId, userId: owner.user.id },
      { width: 600, height: 600 },
    );

    const created = await services.adaptationService.createBatch({
      projectId,
      userId: owner.user.id,
      sourceType: "GENERATED_IMAGE",
      sourceId: image.assetId,
      targets: [{ formatId: "IMAGE_SQUARE" }],
    });

    // Replace the file under the frozen snapshot.
    const sharp = (await import("sharp")).default;
    const { imageStorage } = await import(
      "../../image-generation/storage/image-storage"
    );
    const replacement = await sharp({
      create: {
        width: 600,
        height: 600,
        channels: 4,
        background: { r: 200, g: 20, b: 20, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    await imageStorage.putBytes(image.storageKey, replacement);

    await drain(worker);

    const job = await jobNamed(created.batch.id, "IMAGE_SQUARE");

    expect(job?.status).toBe("FAILED");
    expect(job?.errorCode).toBe("ADAPTATION_SOURCE_CHANGED_SINCE_SNAPSHOT");
  });

  it("lands on the same output key for the same source, format and platform", async () => {
    const image = await createImageSource(
      services,
      { projectId, userId: owner.user.id },
      { width: 700, height: 700 },
    );

    const first = await services.adaptationService.createBatch({
      projectId,
      userId: owner.user.id,
      sourceType: "GENERATED_IMAGE",
      sourceId: image.assetId,
      targets: [{ formatId: "IMAGE_LANDSCAPE" }],
    });
    const second = await services.adaptationService.createBatch({
      projectId,
      userId: owner.user.id,
      sourceType: "GENERATED_IMAGE",
      sourceId: image.assetId,
      targets: [{ formatId: "IMAGE_LANDSCAPE" }],
    });

    await drain(worker);

    const one = await jobNamed(first.batch.id, "IMAGE_LANDSCAPE");
    const two = await jobNamed(second.batch.id, "IMAGE_LANDSCAPE");

    expect(one?.outputChecksumSha256).toBe(two?.outputChecksumSha256);
    expect(one?.outputStorageKey).toBe(two?.outputStorageKey);
  });
});

describe("video adaptation", () => {
  it("re-frames a composition and parks the job on a CP15 render", async () => {
    const composition = await createCompositionSource(
      services,
      { projectId, userId: owner.user.id },
      { width: 1920, height: 1080 },
    );

    const created = await services.adaptationService.createBatch({
      projectId,
      userId: owner.user.id,
      sourceType: "VISUAL_COMPOSITION",
      sourceId: composition.compositionId,
      targets: [{ formatId: "VIDEO_VERTICAL" }],
    });

    await drain(worker);

    const job = await jobNamed(created.batch.id, "VIDEO_VERTICAL");

    expect(job?.status).toBe("WAITING_RENDER");
    expect(job?.renderJobId).toBeTruthy();
    expect(job?.progressPct).toBe(40);

    const { parseRecipe } = await import("../recipe/hash-recipe");
    const recipe = parseRecipe(job!.recipe);

    expect(recipe.output.width).toBe(1080);
    expect(recipe.output.height).toBe(1920);
    expect(recipe.outputStorageKey).toBeNull();

    // The render CP19 asked for is a real CP15 job for this project.
    const render = await services.renderJobService.get({
      projectId,
      renderJobId: job!.renderJobId!,
      userId: owner.user.id,
    });

    expect(render.width).toBe(1080);
    expect(render.height).toBe(1920);
  });

  it("keeps every layer when the aspect ratio changes", async () => {
    const composition = await createCompositionSource(
      services,
      { projectId, userId: owner.user.id },
      { width: 1080, height: 1080 },
    );

    const { adaptSceneGraph } = await import(
      "../adapters/video/adapt-scene"
    );
    const snapshot = await services.adaptationSourceResolver.resolve({
      projectId,
      sourceType: "VISUAL_COMPOSITION",
      sourceId: composition.compositionId,
    });

    if (snapshot.sourceType !== "VISUAL_COMPOSITION") {
      throw new Error("expected a composition snapshot");
    }

    const contract = adaptSceneGraph({
      projectId,
      snapshot,
      targetWidth: 1600,
      targetHeight: 900,
    });

    expect(contract.composition.canvas.width).toBe(1600);
    expect(contract.composition.canvas.height).toBe(900);
    expect(contract.composition.layers).toHaveLength(snapshot.layers.length);

    const layer = contract.composition.layers[0]!;

    // A 1080 square re-framed to 1600x900 widens geometry and leaves rotation and
    // opacity alone.
    expect(layer.width).toBeCloseTo(1080 * (1600 / 1080));
    expect(layer.height).toBeCloseTo(1080 * (900 / 1080));
    expect(layer.rotation).toBe(0);
    expect(layer.opacity).toBe(1);
  });
});

describe("batch cancellation", () => {
  it("stops a queued batch before any of it runs", async () => {
    const writing = await createWritingSource(orm, services, {
      projectId,
      userId: owner.user.id,
    });

    const created = await services.adaptationService.createBatch({
      projectId,
      userId: owner.user.id,
      sourceType: "WRITING_VARIANT",
      sourceId: writing.variantId,
      targets: [
        { formatId: "COPY_SHORT" },
        { formatId: "COPY_MEDIUM" },
      ],
    });

    const cancelled = await services.adaptationService.cancelBatch({
      projectId,
      batchId: created.batch.id,
      userId: owner.user.id,
    });

    expect(cancelled.jobs.every((job) => job.status === "CANCELLED")).toBe(true);

    await drain(worker);

    const after = await services.adaptationService.getBatch({
      projectId,
      batchId: created.batch.id,
      userId: owner.user.id,
    });

    expect(after.batch.status).toBe("CANCELLED");
    expect(after.jobs.every((job) => job.status === "CANCELLED")).toBe(true);
  });

  it("cancels the CP15 render a parked video job is waiting on", async () => {
    const composition = await createCompositionSource(
      services,
      { projectId, userId: owner.user.id },
      { width: 1080, height: 1080 },
    );

    const created = await services.adaptationService.createBatch({
      projectId,
      userId: owner.user.id,
      sourceType: "VISUAL_COMPOSITION",
      sourceId: composition.compositionId,
      targets: [{ formatId: "VIDEO_SQUARE" }],
    });

    await drain(worker);

    const job = await jobNamed(created.batch.id, "VIDEO_SQUARE");
    expect(job?.renderJobId).toBeTruthy();

    await services.adaptationService.cancelBatch({
      projectId,
      batchId: created.batch.id,
      userId: owner.user.id,
    });

    const render = await services.renderJobService.get({
      projectId,
      renderJobId: job!.renderJobId!,
      userId: owner.user.id,
    });

    expect(["CANCELLED", "CANCEL_REQUESTED"]).toContain(render.status);
  });

  it("refuses to cancel a batch that already finished", async () => {
    const writing = await createWritingSource(orm, services, {
      projectId,
      userId: owner.user.id,
    });

    const created = await services.adaptationService.createBatch({
      projectId,
      userId: owner.user.id,
      sourceType: "WRITING_VARIANT",
      sourceId: writing.variantId,
      targets: [{ formatId: "COPY_SHORT" }],
    });

    await drain(worker);

    await expect(
      services.adaptationService.cancelBatch({
        projectId,
        batchId: created.batch.id,
        userId: owner.user.id,
      }),
    ).rejects.toMatchObject({ code: "ADAPTATION_BATCH_NOT_CANCELLABLE" });
  });
});

describe("batch targets and limits", () => {
  it("rejects more targets than a single batch may carry", async () => {
    const writing = await createWritingSource(orm, services, {
      projectId,
      userId: owner.user.id,
    });

    await expect(
      services.adaptationService.createBatch({
        projectId,
        userId: owner.user.id,
        sourceType: "WRITING_VARIANT",
        sourceId: writing.variantId,
        targets: Array.from({ length: 17 }, () => ({
          formatId: "COPY_SHORT",
          platformId: `p${Math.random()}`,
        })),
      }),
    ).rejects.toMatchObject({ code: "ADAPTATION_TARGET_COUNT_EXCEEDED" });
  });

  it("rejects the same format twice for one platform", async () => {
    const writing = await createWritingSource(orm, services, {
      projectId,
      userId: owner.user.id,
    });

    await expect(
      services.adaptationService.createBatch({
        projectId,
        userId: owner.user.id,
        sourceType: "WRITING_VARIANT",
        sourceId: writing.variantId,
        targets: [
          { formatId: "COPY_SHORT", platformId: "linkedin" },
          { formatId: "COPY_SHORT", platformId: "linkedin" },
        ],
      }),
    ).rejects.toMatchObject({ code: "ADAPTATION_INVALID_REQUEST" });
  });

  it("records the requested target count it actually queued", async () => {
    const writing = await createWritingSource(orm, services, {
      projectId,
      userId: owner.user.id,
    });

    const created = await services.adaptationService.createBatch({
      projectId,
      userId: owner.user.id,
      sourceType: "WRITING_VARIANT",
      sourceId: writing.variantId,
      targets: [
        { formatId: "COPY_SHORT" },
        { formatId: "COPY_LONG" },
        { formatId: "COPY_CAPTION" },
      ],
    });

    expect(created.batch.targetCount).toBe(3);
    expect(created.jobs).toHaveLength(3);
  });

  it("lists the formats a source kind can become", async () => {
    const { formats, platformName } = await services.adaptationService.listFormats(
      {
        projectId,
        userId: owner.user.id,
        kind: "IMAGE",
        platformId: "linkedin",
      },
    );

    expect(formats.length).toBeGreaterThan(0);
    expect(formats.every((format) => format.kind === "IMAGE")).toBe(true);
    expect(formats.some((format) => format.id === "IMAGE_SQUARE")).toBe(true);
    expect(formats.some((format) => format.id === "COPY_SHORT")).toBe(false);
    expect(platformName).toBeTruthy();
  });
});

async function readStored(storageKey: string): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of adaptationStorage.read(storageKey)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }

  return Buffer.concat(chunks);
}
