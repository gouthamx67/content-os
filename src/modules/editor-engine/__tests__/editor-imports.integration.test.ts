import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAnalyzedProject,
  loadWritingTestContext,
  makeWorker,
} from "../../writing-engine/__tests__/helpers";
import {
  cleanupEditorProject,
  loadEditorTestContext,
} from "./helpers";
import { EditorImportService } from "../integrations/imports";
import type { EditorImportServiceDeps } from "../integrations/imports";
import type { AdaptationRepository } from "../../../core/ports/adaptation-repository";
import type { ImageGenerationRepository } from "../../../core/ports/image-generation-repository";
import type { AudioRepository } from "../../../core/ports/audio-repository";

/**
 * The import surface is the only part of CP20 that had no reachable proof: the
 * service was complete but no route or test consumed it. These tests run every
 * adapter through the real persistence path (`editorService.createDocument` on
 * Postgres). Only the checkpoint *sources* are stubbed — the composition graph,
 * the audio records, the asset record, the adaptation record — because creating
 * real ones requires the capture/render pipelines the e2e suite already runs.
 */

let orm: Awaited<ReturnType<typeof loadEditorTestContext>>["orm"];
let services: Awaited<ReturnType<typeof loadEditorTestContext>>["services"];
let ctx: Awaited<ReturnType<typeof createAnalyzedProject>>;
let worker: ReturnType<typeof makeWorker>;

async function drain(): Promise<void> {
  for (let guard = 0; guard < 50; guard += 1) {
    if (!(await worker.tick())) return;
  }
  throw new Error("writing queue did not drain");
}

const EMPTY_GRAPH = {
  id: "cp14-ignored",
  projectId: "ignored",
  name: "Ignored",
  width: 1,
  height: 1,
  frameRate: 30,
  durationMs: 1000,
  layers: [],
};

function sampleGraph() {
  return {
    id: "cp14-visual-sample",
    projectId: "ignored",
    name: "Launch",
    width: 1920,
    height: 1080,
    frameRate: 30,
    durationMs: 12_000,
    layers: [
      {
        id: "layer-text-1",
        name: "Headline",
        type: "TEXT",
        assetRef: null,
        textContent: "Launch",
        x: 0,
        y: 0,
        width: 900,
        height: 200,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        visible: true,
        keyframes: [],
        effects: [],
      },
      {
        id: "layer-media-1",
        name: "Poster",
        type: "MEDIA",
        assetRef: "generated:gen-sample",
        textContent: null,
        x: 10,
        y: 20,
        width: 1000,
        height: 800,
        rotation: 5,
        opacity: 0.9,
        zIndex: 1,
        visible: true,
        keyframes: [],
        effects: [{ id: "fx-1", type: "BLUR", amount: 0.2, enabled: true }],
      },
    ],
  };
}

function fakeGeneratedAsset() {
  return {
    id: "gen-sample",
    projectId: "ignored",
    generationJobId: null,
    graphicDocumentId: null,
    storageKey: "images/gen-sample",
    mimeType: "image/png",
    outputFormat: "PNG",
    width: 1920,
    height: 1080,
    byteSize: 4096,
    checksumSha256: "abc",
    transparent: false,
    metadata: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
  } as const;
}

function sampleAudioComposition() {
  return {
    id: "audio-c1",
    projectId: "ignored",
    compositionId: "audio-c1",
    name: "Voiceover",
    sampleRate: 48_000,
    channels: 2,
    durationMs: 20_000,
    status: "READY",
    createdById: "ignored",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tracks: [
      {
        id: "trk-1",
        audioCompositionId: "audio-c1",
        kind: "VOICEOVER",
        name: "Narrator",
        sourceRef: "capture:take-1",
        startMs: 0,
        sourceOffsetMs: 0,
        durationMs: 15_000,
        gainDb: -3,
        pan: 0,
        fadeInMs: 100,
        fadeOutMs: 200,
        mute: false,
        solo: false,
        duckVoiceoverDb: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        automation: [],
      },
    ],
  } as const;
}

function importService(options: {
  graph?: unknown;
  audio?: Partial<AudioRepository>;
  images?: Partial<ImageGenerationRepository>;
  adaptations?: Partial<AdaptationRepository>;
}): EditorImportService {
  const inert = (): never => {
    throw new Error("unreachable import dependency");
  };

  const audioStub = {
    getComposition: async () => null,
    getCompositionByVisual: async () => null,
    ...options.audio,
  } as unknown as AudioRepository;

  const imagesStub = {
    getAsset: async () => fakeGeneratedAsset(),
    ...options.images,
  } as unknown as ImageGenerationRepository;

  const adaptationsStub = {
    getJob: async () => null,
    ...options.adaptations,
  } as unknown as AdaptationRepository;

  const deps: EditorImportServiceDeps = {
    editor: services.editorService,
    captures: { getTake: inert } as never,
    assets: { getById: inert } as never,
    images: imagesStub,
    writing: { getDocument: inert } as never,
    adaptations: adaptationsStub,
    audio: audioStub,
    visualCompositionFor: async () =>
      (options.graph ?? EMPTY_GRAPH) as never,
  };

  return new EditorImportService(deps);
}

beforeAll(async () => {
  const loaded = await loadEditorTestContext();
  orm = loaded.orm;
  services = loaded.services;
  await loadWritingTestContext();

  ctx = await createAnalyzedProject(services);
  worker = makeWorker({ services });
  await drain();
});

afterAll(async () => {
  await cleanupEditorProject(orm, ctx.owner, ctx.projectId);
});

describe("visual composition import (CP14)", () => {
  it("builds a document whose nodes mirror the composition layers", async () => {
    const service = importService({ graph: sampleGraph() });

    const detail = await service.importFromCP14({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      compositionId: "cp14-visual-sample",
    });

    expect(detail.document.name).toBe("Composition import — Launch");
    expect(detail.revision.sourceType).toBe("IMPORT");
    expect(detail.revision.sourceId).toBe("cp14-visual-sample");
    expect(detail.snapshot.width).toBe(1920);
    expect(detail.snapshot.height).toBe(1080);
    expect(detail.snapshot.durationMs).toBe(12_000);
    expect(detail.snapshot.frameRate).toBe(30);
    expect(detail.snapshot.nodes).toHaveLength(2);

    const text = detail.snapshot.nodes.find((node) => node.type === "TEXT")!;
    expect(text.text?.value).toBe("Launch");
    expect(text.provenance?.origin).toBe("VISUAL_COMPOSITION");
    expect(text.provenance?.sourceType).toBe("VISUAL_COMPOSITION");
    expect(text.provenance?.sourceId).toBe("cp14-visual-sample");
    expect(text.zIndex).toBe(0);

    const media = detail.snapshot.nodes.find((node) => node.type === "IMAGE")!;
    expect(media.asset?.ref).toBe("generated:gen-sample");
    expect(media.asset?.origin).toBe("GENERATED_IMAGE");
    expect(media.asset?.mimeType).toBe("image/png");
    expect(media.transform.rotation).toBe(5);
    expect(media.transform.opacity).toBe(0.9);
    expect(media.effects).toEqual([
      { id: "fx-1", type: "BLUR", amount: 0.2, enabled: true },
    ]);
    expect(media.zIndex).toBe(1);
  });

  it("persists the imported document like any other edit", async () => {
    const service = importService({ graph: sampleGraph() });

    const detail = await service.importFromCP14({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      compositionId: "cp14-visual-sample",
    });

    const read = await services.editorService.getDocument({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      documentId: detail.document.id,
    });
    expect(read.document.revisionCount).toBe(1);
    expect(read.snapshot.nodes).toHaveLength(2);
    expect(read.snapshot.nodes[1]?.type).toBe("IMAGE");
  });

  it("offsets audio tracks below the visual nodes in a multimodal import", async () => {
    const service = importService({
      graph: sampleGraph(),
      audio: {
        getCompositionByVisual: async () =>
          sampleAudioComposition() as never,
      },
    });

    const detail = await service.importComposition({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      compositionId: "cp14-visual-sample",
    });

    expect(detail.snapshot.nodes).toHaveLength(3);
    expect(detail.snapshot.durationMs).toBe(20_000);

    const audio = detail.snapshot.nodes.find((node) => node.type === "AUDIO")!;
    expect(audio.name).toBe("Narrator");
    expect(audio.zIndex).toBe(2);
    expect(audio.asset?.ref).toBe("capture:take-1");
    expect(audio.trim).toEqual({ startMs: 0, endMs: 15_000 });
    expect(audio.audio?.gainDb).toBe(-3);
    expect(audio.provenance?.sourceType).toBe("AUDIO_TRACK");
    expect(audio.provenance?.sourceIds).toEqual(["audio-c1"]);
  });

  it("imports an audio composition as an audio track", async () => {
    const service = importService({
      audio: {
        getComposition: async () => sampleAudioComposition() as never,
      },
    });

    const detail = await service.importFromCP16({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      audioCompositionId: "audio-c1",
    });

    expect(detail.document.name).toBe("Audio import — Voiceover");
    expect(detail.revision.sourceType).toBe("IMPORT");
    expect(detail.snapshot.durationMs).toBe(20_000);

    const audio = detail.snapshot.nodes[0]!;
    expect(audio.type).toBe("AUDIO");
    expect(audio.asset?.ref).toBe("capture:take-1");
    expect(audio.audio?.gainDb).toBe(-3);
  });

  it("carries motion keyframes and effects through the visual import", async () => {
    const graph = {
      ...sampleGraph(),
      layers: [
        {
          id: "layer-text-1",
          name: "Headline",
          type: "TEXT",
          assetRef: null,
          textContent: "Launch",
          x: 0,
          y: 0,
          width: 900,
          height: 200,
          rotation: 0,
          opacity: 1,
          zIndex: 0,
          visible: true,
          keyframes: [
            {
              id: "kf-1",
              property: "OPACITY",
              timeMs: 0,
              fromValue: 0,
              toValue: 1,
              easing: "EASE_IN",
            },
            {
              id: "kf-2",
              property: "X",
              timeMs: 500,
              fromValue: -40,
              toValue: 0,
              easing: "EASE_OUT",
            },
          ],
          effects: [
            { id: "fx-blur", type: "BLUR", amount: 0.4, enabled: true },
            { id: "fx-sat", type: "SATURATION", amount: 0.8, enabled: false },
          ],
        },
      ],
    };

    const service = importService({ graph });
    const detail = await service.importFromCP14({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      compositionId: "cp14-visual-sample",
    });

    const text = detail.snapshot.nodes[0]!;
    expect(text.motion?.keyframes).toEqual([
      {
        id: "kf-1",
        property: "OPACITY",
        timeMs: 0,
        fromValue: 0,
        toValue: 1,
        easing: "EASE_IN",
      },
      {
        id: "kf-2",
        property: "X",
        timeMs: 500,
        fromValue: -40,
        toValue: 0,
        easing: "EASE_OUT",
      },
    ]);
    expect(text.effects).toEqual([
      { id: "fx-blur", type: "BLUR", amount: 0.4, enabled: true },
      { id: "fx-sat", type: "SATURATION", amount: 0.8, enabled: false },
    ]);
  });

  it("carries automation points and full audio settings through the audio import", async () => {
    const composition = {
      ...sampleAudioComposition(),
      tracks: [
        {
          ...sampleAudioComposition().tracks[0]!,
          gainDb: -6,
          pan: 0.25,
          fadeInMs: 250,
          fadeOutMs: 500,
          mute: true,
          solo: true,
          duckVoiceoverDb: -12,
          sourceOffsetMs: 1_000,
          automation: [
            {
              id: "auto-1",
              trackId: "trk-1",
              property: "VOLUME_DB",
              timeMs: 0,
              value: -12,
              easing: "LINEAR",
              createdAt: new Date().toISOString(),
            },
            {
              id: "apt-2",
              trackId: "trk-1",
              property: "VOLUME_DB",
              timeMs: 4_000,
              value: -3,
              easing: "EASE_IN_OUT",
              createdAt: new Date().toISOString(),
            },
          ],
        },
      ],
    };

    const service = importService({
      audio: {
        getComposition: async () => composition as never,
        getCompositionByVisual: async () => null,
      },
    });

    const detail = await service.importFromCP16({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      audioCompositionId: "audio-c1",
    });

    const audio = detail.snapshot.nodes[0]!;
    expect(audio.audio).toMatchObject({
      gainDb: -6,
      muted: true,
      pan: 0.25,
      fadeInMs: 250,
      fadeOutMs: 500,
      sourceOffsetMs: 1_000,
      solo: true,
      duckVoiceoverDb: -12,
    });
    expect(audio.automation).toEqual([
      {
        id: "auto-1",
        type: "VOLUME_DB",
        timeMs: 0,
        value: -12,
        easing: "LINEAR",
      },
      {
        id: "apt-2",
        type: "VOLUME_DB",
        timeMs: 4_000,
        value: -3,
        easing: "EASE_IN_OUT",
      },
    ]);
  });
});

describe("generated image import (CP17)", () => {
  it("imports a generated image as a media node", async () => {
    const service = importService({});

    const detail = await service.importFromCP17({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      assetId: "gen-sample",
    });

    expect(detail.document.name).toBe("Generated image import — gen-sample");
    expect(detail.revision.sourceType).toBe("IMPORT");
    expect(detail.snapshot.width).toBe(1920);
    expect(detail.snapshot.height).toBe(1080);

    const image = detail.snapshot.nodes[0]!;
    expect(image.type).toBe("IMAGE");
    expect(image.asset?.ref).toBe("generated:gen-sample");
    expect(image.asset?.mimeType).toBe("image/png");
    expect(image.asset?.byteSize).toBe(4096);
    expect(image.asset?.width).toBe(1920);
    expect(image.asset?.height).toBe(1080);
    expect(image.provenance?.origin).toBe("GENERATED_IMAGE");
  });

  it("refuses an asset this project does not hold", async () => {
    await expect(
      services.editorImportService.importFromCP17({
        projectId: ctx.projectId,
        userId: ctx.owner.user.id,
        assetId: "gen-foreign",
      }),
    ).rejects.toMatchObject({ code: "EDITOR_ASSET_UNAVAILABLE" });
  });
});

describe("writing variant import (CP18)", () => {
  let writingDocumentId = "";
  let variantId = "";
  let variantText = "";
  let title = "";

  beforeAll(async () => {
    const job = await services.writingGenerationService.enqueue({
      projectId: ctx.projectId,
      requestedById: ctx.owner.user.id,
      blockType: "BODY",
      tone: "PROFESSIONAL",
      length: "LONG",
      objective: "PRODUCT_EXPLANATION",
      prompt: "Explain the product with proof",
      variantCount: 1,
      intentId: null,
      directionId: null,
      storyboardId: null,
      sceneId: null,
    });
    await drain();

    const record = await services.writingGenerationService.getJob({
      projectId: ctx.projectId,
      jobId: job.id,
      userId: ctx.owner.user.id,
    });
    expect(record.status).toBe("SUCCEEDED");

    writingDocumentId = record.documentId!;
    const view = await services.writingGenerationService.getDocument({
      projectId: ctx.projectId,
      documentId: writingDocumentId,
      userId: ctx.owner.user.id,
    });
    title = view.document.title;
    variantId = view.variants[0]!.id;
    variantText = view.variants[0]!.text;
  });

  it("imports a grounded writing variant as a copy node", async () => {
    const detail = await services.editorImportService.importFromCP18({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      documentId: writingDocumentId,
      variantId,
    });

    expect(detail.document.name).toBe(`Copy import — ${title}`);
    expect(detail.revision.sourceType).toBe("IMPORT");
    expect(detail.revision.sourceId).toBe(variantId);

    const copy = detail.snapshot.nodes[0]!;
    expect(copy.type).toBe("TEXT");
    expect(copy.text?.value).toBe(variantText);
    expect(copy.name).toBe(`Copy — ${title}`);
    expect(copy.provenance?.origin).toBe("WRITING_VARIANT");
    expect(copy.provenance?.sourceType).toBe("WRITING_VARIANT");
    expect(copy.provenance?.sourceId).toBe(variantId);
    expect(copy.provenance?.sourceIds?.length).toBeGreaterThan(0);
  });

  it("refuses a writing variant that is not in this project", async () => {
    await expect(
      services.editorImportService.importFromCP18({
        projectId: ctx.projectId,
        userId: ctx.owner.user.id,
        documentId: "writing-document-missing",
        variantId: "writing-variant-missing",
      }),
    ).rejects.toMatchObject({ code: "EDITOR_ASSET_UNAVAILABLE" });
  });
});

describe("adaptation import (CP19)", () => {
  it("refuses a job that has not finished", async () => {
    const service = importService({
      adaptations: {
        getJob: async () =>
          ({
            id: "job-1",
            projectId: ctx.projectId,
            status: "QUEUED",
            kind: "COPY",
          }) as never,
      },
    });

    await expect(
      service.importFromCP19({
        projectId: ctx.projectId,
        userId: ctx.owner.user.id,
        jobId: "job-1",
      }),
    ).rejects.toMatchObject({
      code: "EDITOR_ASSET_UNAVAILABLE",
      message: expect.stringContaining("has not finished"),
    });
  });

  it("imports a finished copy adaptation as a text node", async () => {
    const service = importService({
      adaptations: {
        getJob: async () =>
          ({
            id: "job-1",
            projectId: ctx.projectId,
            status: "SUCCEEDED",
            kind: "COPY",
            formatId: "format-1",
            outputText: "Ready for launch",
            recipe: "{}",
          }) as never,
      },
    });

    const detail = await service.importFromCP19({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      jobId: "job-1",
    });

    expect(detail.document.name).toBe("Adaptation import — job-1");
    expect(detail.revision.sourceType).toBe("IMPORT");

    const copy = detail.snapshot.nodes[0]!;
    expect(copy.type).toBe("TEXT");
    expect(copy.text?.value).toBe("Ready for launch");
    expect(copy.provenance?.origin).toBe("ADAPTATION_JOB");
    expect(copy.provenance?.sourceType).toBe("ADAPTATION_JOB");
  });

  it("imports a finished image adaptation as an image node", async () => {
    const service = importService({
      adaptations: {
        getJob: async () =>
          ({
            id: "job-img",
            projectId: ctx.projectId,
            status: "SUCCEEDED",
            kind: "IMAGE",
            formatId: "format-img",
            outputMimeType: "image/webp",
            outputByteSize: 8_192,
            outputWidth: 800,
            outputHeight: 600,
            recipe: "{}",
          }) as never,
      },
    });

    const detail = await service.importFromCP19({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      jobId: "job-img",
    });

    const image = detail.snapshot.nodes[0]!;
    expect(image.type).toBe("IMAGE");
    expect(image.asset?.ref).toBe("adaptation:job-img");
    expect(image.asset?.mimeType).toBe("image/webp");
    expect(image.asset?.byteSize).toBe(8_192);
    expect(image.asset?.width).toBe(800);
    expect(image.asset?.height).toBe(600);
    expect(image.provenance?.origin).toBe("ADAPTATION_JOB");
  });

  it("imports a finished video adaptation as a video node", async () => {
    const service = importService({
      adaptations: {
        getJob: async () =>
          ({
            id: "job-vid",
            projectId: ctx.projectId,
            status: "SUCCEEDED",
            kind: "VIDEO",
            formatId: "format-vid",
            outputMimeType: "video/mp4",
            outputByteSize: 1_048_576,
            outputWidth: 1080,
            outputHeight: 1920,
            recipe: "{}",
          }) as never,
      },
    });

    const detail = await service.importFromCP19({
      projectId: ctx.projectId,
      userId: ctx.owner.user.id,
      jobId: "job-vid",
    });

    const video = detail.snapshot.nodes[0]!;
    expect(video.type).toBe("VIDEO");
    expect(video.asset?.ref).toBe("adaptation:job-vid");
    expect(video.asset?.mimeType).toBe("video/mp4");
    expect(video.provenance?.origin).toBe("ADAPTATION_JOB");
  });

  it("refuses an unknown adaptation job", async () => {
    await expect(
      services.editorImportService.importFromCP19({
        projectId: ctx.projectId,
        userId: ctx.owner.user.id,
        jobId: "job-missing",
      }),
    ).rejects.toMatchObject({ code: "EDITOR_ASSET_UNAVAILABLE" });
  });
});