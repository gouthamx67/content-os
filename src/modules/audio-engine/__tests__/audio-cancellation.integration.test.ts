import { mkdtemp, rm } from "node:fs/promises";
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

let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let other: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;
let otherProjectId: string;
let audioCompositionId: string;
let audioRoot: string;
let workRoot: string;

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

  audioRoot = await mkdtemp(path.join(tmpdir(), "cp16-cancel-audio-"));
  workRoot = await mkdtemp(path.join(tmpdir(), "cp16-cancel-work-"));

  owner = await services.authService.register({
    email: `cp16-cancel-${Date.now()}@test.local`,
    password: "test-password-1",
  });
  other = await services.authService.register({
    email: `cp16-cancel-other-${Date.now()}@test.local`,
    password: "test-password-1",
  });

  projectId = (
    await services.projectService.createForWorkspace(
      owner.workspace!.id,
      { name: "CP16 cancel" },
      owner.user.id,
    )
  ).id;
  otherProjectId = (
    await services.projectService.createForWorkspace(
      other.workspace!.id,
      { name: "CP16 cancel other" },
      other.user.id,
    )
  ).id;

  const visual = await services.visualCompositionService.createComposition({
    projectId,
    userId: owner.user.id,
    name: "Cancel host",
    width: 320,
    height: 240,
    frameRate: 12,
    durationMs: 1000,
  });

  const audio = await services.audioService.ensure({
    projectId,
    compositionId: visual.id,
    userId: owner.user.id,
  });
  audioCompositionId = audio.id;

  await services.audioService.service.addTrack({
    projectId,
    audioCompositionId,
    userId: owner.user.id,
    kind: "VOICEOVER",
    name: "Narration",
    sourceRef: "asset:placeholder",
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
});

afterAll(async () => {
  for (const root of [audioRoot, workRoot]) {
    if (root) await rm(root, { recursive: true, force: true });
  }

  for (const [pid, user] of [
    [projectId, owner],
    [otherProjectId, other],
  ] as const) {
    if (!pid || !user) continue;
    await orm.AudioComposition.where((row) => row.projectId.eq(pid))
      .delete()
      .catch(() => undefined);
    await orm.VisualComposition.where((row) => row.projectId.eq(pid))
      .delete()
      .catch(() => undefined);
    await orm.Project.where({ id: pid }).delete().catch(() => undefined);
    await orm.WorkspaceMember.where((row) => row.userId.eq(user.user.id))
      .delete()
      .catch(() => undefined);
    await orm.Session.where((row) => row.userId.eq(user.user.id))
      .delete()
      .catch(() => undefined);
    await orm.Workspace.where({ id: user.workspace!.id })
      .delete()
      .catch(() => undefined);
    await orm.User.where({ id: user.user.id }).delete().catch(() => undefined);
  }
});

describe("audio cancellation", () => {
  it("moves a cancel-requested job to cancelled on the next tick", async () => {
    const job = await services.audioService.render.enqueue({
      projectId,
      audioCompositionId,
      userId: owner.user.id,
    });

    const now = new Date().toISOString();
    await container.container.repositories.audio.markRunning({
      audioRenderJobId: job.id,
      ffmpegVersion: "test",
      startedAt: now,
      updatedAt: now,
    });

    const requested = await services.audioService.render.cancel({
      projectId,
      audioRenderJobId: job.id,
      userId: owner.user.id,
    });
    expect(requested.status).toBe("CANCEL_REQUESTED");

    await worker().tick();

    const finished = await services.audioService.render.get({
      projectId,
      audioRenderJobId: job.id,
      userId: owner.user.id,
    });
    expect(finished.status).toBe("CANCELLED");
  });

  it("cancels a still-queued job immediately", async () => {
    const job = await services.audioService.render.enqueue({
      projectId,
      audioCompositionId,
      userId: owner.user.id,
    });

    const requested = await services.audioService.render.cancel({
      projectId,
      audioRenderJobId: job.id,
      userId: owner.user.id,
    });

    expect(requested.status).toBe("CANCELLED");
  });

  it("hides another project's job from cancel", async () => {
    const job = await services.audioService.render.enqueue({
      projectId,
      audioCompositionId,
      userId: owner.user.id,
    });

    await expect(
      services.audioService.render.cancel({
        projectId: otherProjectId,
        audioRenderJobId: job.id,
        userId: other.user.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
