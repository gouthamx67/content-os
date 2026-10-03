import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicOrm } from "../../../prisma/db";
import { LocalAudioStorage } from "../storage/audio-storage";
import { AudioSourceResolver } from "../assets/audio-source-resolver";
import { AudioRenderWorker } from "../render/audio-render-worker";
import { captureStorage } from "../../capture-engine/storage/capture-storage";

const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";

type Services = typeof import("../../../infrastructure/services");
type Container = typeof import("../../../infrastructure/container");

let services: Services;
let container: Container;
let orm: PublicOrm;

let ownerA: Awaited<ReturnType<Services["authService"]["register"]>>;
let ownerB: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectA: string;
let projectB: string;

let audioRoot: string;
let workRoot: string;

async function seedSourceAsset(): Promise<string> {
  const wavPath = path.join(workRoot, "secure.wav");
  execFileSync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=330:duration=1",
    "-ar",
    "48000",
    "-ac",
    "2",
    wavPath,
  ]);

  const key = "assets/secure.wav";
  await container.container.providers.storage.put(
    key,
    await readFile(wavPath),
    "audio/wav",
  );

  const asset = await services.assetService.create(
    projectA,
    {
      type: "AUDIO",
      name: "secure.wav",
      uri: `content-os-storage://local/${key}`,
    },
    ownerA.user.id,
  );

  return `asset:${asset.id}`;
}

async function makeComposition(projectId: string, userId: string) {
  const visual = await services.visualCompositionService.createComposition({
    projectId,
    userId,
    name: "Secure host",
    width: 320,
    height: 240,
    frameRate: 12,
    durationMs: 1000,
  });

  const audio = await services.audioService.ensure({
    projectId,
    compositionId: visual.id,
    userId,
  });

  return { visualId: visual.id, audioId: audio.id };
}

function worker(): AudioRenderWorker {
  return new AudioRenderWorker({
    repository: container.container.repositories.audio,
    storage: new LocalAudioStorage(audioRoot),
    sources: new AudioSourceResolver({
      captures: container.container.repositories.captures,
      assets: container.container.repositories.assets,
      captureStorage,
      storage: container.container.providers.storage,
    }),
    videoArtifactFor: async () => null,
    videoStoragePath: () => "",
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

  audioRoot = await mkdtemp(path.join(tmpdir(), "cp16-sec-audio-"));
  workRoot = await mkdtemp(path.join(tmpdir(), "cp16-sec-work-"));

  ownerA = await services.authService.register({
    email: `cp16-sec-a-${Date.now()}@test.local`,
    password: "test-password-1",
  });
  ownerB = await services.authService.register({
    email: `cp16-sec-b-${Date.now()}@test.local`,
    password: "test-password-1",
  });

  projectA = (
    await services.projectService.createForWorkspace(
      ownerA.workspace!.id,
      { name: "CP16 A" },
      ownerA.user.id,
    )
  ).id;
  projectB = (
    await services.projectService.createForWorkspace(
      ownerB.workspace!.id,
      { name: "CP16 B" },
      ownerB.user.id,
    )
  ).id;
});

afterAll(async () => {
  for (const root of [audioRoot, workRoot]) {
    if (root) await rm(root, { recursive: true, force: true });
  }

  for (const [projectId, owner] of [
    [projectA, ownerA],
    [projectB, ownerB],
  ] as const) {
    if (!projectId || !owner) continue;
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
});

describe("audio project isolation", () => {
  it("rejects a source owned by another project during render", async () => {
    const foreignRef = await seedSourceAsset();
    const { audioId } = await makeComposition(projectB, ownerB.user.id);

    await services.audioService.service.addTrack({
      projectId: projectB,
      audioCompositionId: audioId,
      userId: ownerB.user.id,
      kind: "MUSIC",
      name: "Stolen",
      sourceRef: foreignRef,
      startMs: 0,
      sourceOffsetMs: 0,
      durationMs: 1000,
      gainDb: 0,
      pan: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      mute: false,
      solo: false,
      duckVoiceoverDb: null,
    });

    const job = await services.audioService.render.enqueue({
      projectId: projectB,
      audioCompositionId: audioId,
      userId: ownerB.user.id,
    });

    expect(await worker().tick()).toBe(true);

    const finished = await services.audioService.render.get({
      projectId: projectB,
      audioRenderJobId: job.id,
      userId: ownerB.user.id,
    });

    expect(finished.status).toBe("FAILED");
    expect(finished.errorCode).toBe("AUDIO_SOURCE_PROJECT_MISMATCH");
  });

  it("hides an audio composition owned by another project", async () => {
    const { audioId } = await makeComposition(projectA, ownerA.user.id);

    await expect(
      services.audioService.service.get(projectB, audioId, ownerB.user.id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a video render from another project", async () => {
    const { visualId, audioId } = await makeComposition(
      projectA,
      ownerA.user.id,
    );

    const foreignVideoJob = await services.renderJobService.enqueue({
      projectId: projectA,
      compositionId: visualId,
      userId: ownerA.user.id,
    });

    const { audioId: otherAudioId } = await makeComposition(
      projectB,
      ownerB.user.id,
    );

    await expect(
      services.audioService.render.enqueue({
        projectId: projectB,
        audioCompositionId: otherAudioId,
        userId: ownerB.user.id,
        videoRenderJobId: foreignVideoJob.id,
      }),
    ).rejects.toMatchObject({ code: "VIDEO_RENDER_PROJECT_MISMATCH" });

    expect(audioId).toBeTruthy();
  });

  it("refuses to edit a track through the wrong composition", async () => {
    const { audioId } = await makeComposition(projectA, ownerA.user.id);

    const track = await services.audioService.service.addTrack({
      projectId: projectA,
      audioCompositionId: audioId,
      userId: ownerA.user.id,
      kind: "SFX",
      name: "Sfx",
      sourceRef: "asset:missing",
      startMs: 0,
      sourceOffsetMs: 0,
      durationMs: 500,
      gainDb: 0,
      pan: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      mute: false,
      solo: false,
      duckVoiceoverDb: null,
    });

    await expect(
      services.audioService.service.updateTrack({
        projectId: projectA,
        audioCompositionId: `not-${audioId}`,
        trackId: track.id,
        userId: ownerA.user.id,
        changes: { gainDb: -3 },
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
