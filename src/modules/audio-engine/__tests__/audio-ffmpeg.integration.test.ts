import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicOrm } from "../../../prisma/db";
import { LocalAudioStorage } from "../storage/audio-storage";
import { LocalRenderStorage } from "../../video-rendering/storage/render-storage";
import { AudioSourceResolver } from "../assets/audio-source-resolver";
import { AudioRenderWorker } from "../render/audio-render-worker";
import { RenderWorker } from "../../video-rendering/render-worker";
import { RenderAssetResolver } from "../../video-rendering/assets/render-asset-resolver";
import { captureStorage } from "../../capture-engine/storage/capture-storage";
import { probeAudio } from "../ffmpeg/probe-audio";
import { probeMuxedVideo } from "../ffmpeg/probe-muxed-video";

const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";

type Services = typeof import("../../../infrastructure/services");
type Container = typeof import("../../../infrastructure/container");

let services: Services;
let container: Container;
let orm: PublicOrm;

let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;
let visualCompositionId: string;
let audioCompositionId: string;
let assetSourceRef: string;

let audioRoot: string;
let workRoot: string;
let renderRoot: string;

async function createWavAsset(
  name: string,
  frequency: number,
): Promise<string> {
  const wavPath = path.join(workRoot, `${name}.wav`);
  execFileSync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${frequency}:duration=1`,
    "-ar",
    "48000",
    "-ac",
    "2",
    wavPath,
  ]);

  const bytes = await readFile(wavPath);
  const key = `assets/${name}.wav`;
  await container.container.providers.storage.put(key, bytes, "audio/wav");

  const asset = await services.assetService.create(
    projectId,
    {
      type: "AUDIO",
      name: `${name}.wav`,
      uri: `content-os-storage://local/${key}`,
    },
    owner.user.id,
  );

  return `asset:${asset.id}`;
}

function makeAudioWorker(
  videoRoot: string | null,
): AudioRenderWorker {
  return new AudioRenderWorker({
    repository: container.container.repositories.audio,
    storage: new LocalAudioStorage(audioRoot),
    sources: new AudioSourceResolver({
      captures: container.container.repositories.captures,
      assets: container.container.repositories.assets,
      captureStorage,
      storage: container.container.providers.storage,
    }),
    videoArtifactFor: async (videoRenderJobId) => {
      const artifact = await services.renderJobService.artifact({
        projectId,
        renderJobId: videoRenderJobId,
        userId: owner.user.id,
      });
      const job = await services.renderJobService.get({
        projectId,
        renderJobId: videoRenderJobId,
        userId: owner.user.id,
      });
      if (!artifact || !job) return null;
      return {
        storageKey: artifact.storageKey,
        width: job.width,
        height: job.height,
      };
    },
    videoStoragePath: videoRoot
      ? (storageKey) => new LocalRenderStorage(videoRoot).absolutePath(storageKey)
      : () => "",
    workDirRoot: workRoot,
  });
}

beforeAll(async () => {
  process.env["DATABASE_URL"] = TEST_DATABASE_URL;

  const [{ db }, loadedServices, loadedContainer] = await Promise.all([
    import("../../../prisma/db"),
    import("../../../infrastructure/services"),
    import("../../../infrastructure/container"),
  ]);

  services = loadedServices;
  container = loadedContainer;
  orm = db.orm.public;

  audioRoot = await mkdtemp(path.join(tmpdir(), "cp16-audio-storage-"));
  workRoot = await mkdtemp(path.join(tmpdir(), "cp16-audio-work-"));
  renderRoot = await mkdtemp(path.join(tmpdir(), "cp16-render-storage-"));

  owner = await services.authService.register({
    email: `cp16-ffmpeg-${Date.now()}@test.local`,
    password: "test-password-1",
  });

  const project = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "CP16 ffmpeg" },
    owner.user.id,
  );
  projectId = project.id;

  const visual = await services.visualCompositionService.createComposition({
    projectId,
    userId: owner.user.id,
    name: "CP16 host",
    width: 320,
    height: 240,
    frameRate: 12,
    durationMs: 1000,
  });
  visualCompositionId = visual.id;

  assetSourceRef = await createWavAsset("bed", 220);

  const audio = await services.audioService.ensure({
    projectId,
    compositionId: visualCompositionId,
    userId: owner.user.id,
  });
  audioCompositionId = audio.id;

  await services.audioService.service.addTrack({
    projectId,
    audioCompositionId,
    userId: owner.user.id,
    kind: "MUSIC",
    name: "Bed",
    sourceRef: assetSourceRef,
    startMs: 0,
    sourceOffsetMs: 0,
    durationMs: 1000,
    gainDb: -6,
    pan: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    mute: false,
    solo: false,
    duckVoiceoverDb: null,
  });
});

afterAll(async () => {
  if (owner) {
    await orm.AudioComposition.where((row) => row.projectId.eq(projectId))
      .delete()
      .catch(() => undefined);
    await orm.VisualComposition.where((row) => row.projectId.eq(projectId))
      .delete()
      .catch(() => undefined);
    await orm.Asset.where((row) => row.projectId.eq(projectId))
      .delete()
      .catch(() => undefined);
    await orm.Project.where({ id: projectId }).delete().catch(() => undefined);
    await orm.WorkspaceMember.where((row) => row.userId.eq(owner.user.id))
      .delete()
      .catch(() => undefined);
    await orm.Session.where((row) => row.userId.eq(owner.user.id))
      .delete()
      .catch(() => undefined);
    await orm.Workspace.where({ id: owner.workspace!.id })
      .delete()
      .catch(() => undefined);
    await orm.User.where({ id: owner.user.id }).delete().catch(() => undefined);
  }

  for (const root of [audioRoot, workRoot, renderRoot]) {
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("real audio rendering", () => {
  it("mixes a WAV from a real source", async () => {
    const job = await services.audioService.render.enqueue({
      projectId,
      audioCompositionId,
      userId: owner.user.id,
    });

    const ran = await makeAudioWorker(null).tick();
    expect(ran).toBe(true);

    const finished = await services.audioService.render.get({
      projectId,
      audioRenderJobId: job.id,
      userId: owner.user.id,
    });

    expect(finished.status).toBe("SUCCEEDED");
    expect(finished.progressPct).toBe(100);
    expect(finished.outputFormat).toBe("WAV");

    const artifact = await services.audioService.render.audioArtifact({
      projectId,
      audioRenderJobId: job.id,
      userId: owner.user.id,
    });

    expect(artifact).not.toBeNull();
    expect(artifact!.mimeType).toBe("audio/wav");
    expect(artifact!.byteSize).toBeGreaterThan(0);
    expect(artifact!.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    const storage = new LocalAudioStorage(audioRoot);
    const probe = await probeAudio(
      storage.absolutePath(artifact!.storageKey),
    );
    expect(probe.audioCodec).toBe("pcm_s16le");
    expect(probe.sampleRate).toBe(48000);
    expect(probe.channels).toBe(2);
    expect(probe.durationMs).toBeGreaterThan(0);
  });

  it("muxes the mix with a real CP15 video master", async () => {
    await services.visualLayerService.addLayer({
      projectId,
      compositionId: visualCompositionId,
      userId: owner.user.id,
      type: "TEXT",
      textContent: "Mux",
    });

    const videoJob = await services.renderJobService.enqueue({
      projectId,
      compositionId: visualCompositionId,
      userId: owner.user.id,
    });

    const videoWorker = new RenderWorker({
      repository: container.container.repositories.renderJobs,
      storage: new LocalRenderStorage(renderRoot),
      assets: new RenderAssetResolver({
        captures: container.container.repositories.captures,
        assets: container.container.repositories.assets,
        captureStorage,
        storage: container.container.providers.storage,
      }),
      workDirRoot: workRoot,
    });

    expect(await videoWorker.tick()).toBe(true);

    const videoFinished = await services.renderJobService.get({
      projectId,
      renderJobId: videoJob.id,
      userId: owner.user.id,
    });
    expect(videoFinished.status).toBe("SUCCEEDED");

    const muxJob = await services.audioService.render.enqueue({
      projectId,
      audioCompositionId,
      userId: owner.user.id,
      videoRenderJobId: videoJob.id,
    });
    expect(muxJob.outputFormat).toBe("MP4");

    expect(await makeAudioWorker(renderRoot).tick()).toBe(true);

    const finished = await services.audioService.render.get({
      projectId,
      audioRenderJobId: muxJob.id,
      userId: owner.user.id,
    });
    expect(finished.status).toBe("SUCCEEDED");

    const muxed = await services.audioService.render.muxedArtifact({
      projectId,
      audioRenderJobId: muxJob.id,
      userId: owner.user.id,
    });
    expect(muxed).not.toBeNull();
    expect(muxed!.mimeType).toBe("video/mp4");
    expect(muxed!.videoRenderJobId).toBe(videoJob.id);

    const storage = new LocalAudioStorage(audioRoot);
    const probe = await probeMuxedVideo(
      storage.absolutePath(muxed!.storageKey),
    );
    expect(probe.videoCodec).toBe("h264");
    expect(probe.audioCodec).toBe("aac");
    expect(probe.sampleRate).toBe(48000);
    expect(probe.channels).toBe(2);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(240);
  });
});
