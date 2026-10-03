import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicOrm } from "../../../prisma/db";
import type { RendererContract } from "../../visual-motion-engine/export/renderer-contract";
import { LocalRenderStorage } from "../storage/render-storage";
import { RenderWorker } from "../render-worker";
import { RenderAssetResolver } from "../assets/render-asset-resolver";
import { captureStorage } from "../../capture-engine/storage/capture-storage";
import { imageStorage } from "../../image-generation/storage/image-storage";

const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";

type Services = typeof import("../../../infrastructure/services");
type Container = typeof import("../../../infrastructure/container");

let services: Services;
let container: Container;
let orm: PublicOrm;

let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;
let storageRoot: string;
let workRoot: string;

function baseContract(
  compositionId: string,
  layers: RendererContract["composition"]["layers"],
): RendererContract {
  return {
    contractVersion: 1,
    composition: {
      id: compositionId,
      projectId,
      canvas: { width: 320, height: 240, frameRate: 12, durationMs: 600 },
      layers,
    },
  };
}

async function createCanvasComposition(name: string): Promise<string> {
  const composition = await services.visualCompositionService.createComposition({
    projectId,
    userId: owner.user.id,
    name,
    width: 320,
    height: 240,
    frameRate: 12,
    durationMs: 600,
  });
  return composition.id;
}

function makeWorker(): RenderWorker {
  return new RenderWorker({
    repository: container.container.repositories.renderJobs,
    storage: new LocalRenderStorage(storageRoot),
    assets: new RenderAssetResolver({
      captures: container.container.repositories.captures,
      assets: container.container.repositories.assets,
      images: container.container.repositories.images,
      captureStorage,
      imageStorage,
      storage: container.container.providers.storage,
    }),
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

  storageRoot = await mkdtemp(path.join(tmpdir(), "cp15-render-storage-"));
  workRoot = await mkdtemp(path.join(tmpdir(), "cp15-render-work-"));

  owner = await services.authService.register({
    email: `cp15-ffmpeg-${Date.now()}@test.local`,
    password: "test-password-1",
  });

  const project = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "CP15 ffmpeg" },
    owner.user.id,
  );
  projectId = project.id;
});

afterAll(async () => {
  if (owner) {
    await orm.VisualComposition.where((row) => row.projectId.eq(projectId))
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

  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  if (workRoot) await rm(workRoot, { recursive: true, force: true });
});

describe("ffmpeg rendering", () => {
  it("renders a text composition to a verified MP4 artifact", async () => {
    const composition = await services.visualCompositionService.createComposition({
      projectId,
      userId: owner.user.id,
      name: "Render text",
      width: 320,
      height: 240,
      frameRate: 12,
      durationMs: 600,
    });

    await services.visualLayerService.addLayer({
      projectId,
      compositionId: composition.id,
      userId: owner.user.id,
      type: "TEXT",
      textContent: "Hello",
    });

    const job = await services.renderJobService.enqueue({
      projectId,
      compositionId: composition.id,
      userId: owner.user.id,
    });

    const ran = await makeWorker().tick();
    expect(ran).toBe(true);

    const finished = await services.renderJobService.get({
      projectId,
      renderJobId: job.id,
      userId: owner.user.id,
    });

    expect(finished.status).toBe("SUCCEEDED");
    expect(finished.progressPct).toBe(100);
    expect(finished.ffmpegVersion).toContain("ffmpeg");

    const artifact = await services.renderJobService.artifact({
      projectId,
      renderJobId: job.id,
      userId: owner.user.id,
    });

    expect(artifact).not.toBeNull();
    expect(artifact!.mimeType).toBe("video/mp4");
    expect(artifact!.byteSize).toBeGreaterThan(0);
    expect(artifact!.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    const stored = new LocalRenderStorage(storageRoot);
    expect(await stored.exists(artifact!.storageKey)).toBe(true);
  });

  it("fails a group layer with a feature error rather than guessing", async () => {
    const compositionId = await createCanvasComposition("Group");
    const contract = baseContract(compositionId, [
      {
        id: "layer_group",
        name: "Group",
        type: "GROUP",
        assetRef: null,
        textContent: null,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        fit: "CONTAIN",
        cropX: 0,
        cropY: 0,
        cropWidth: null,
        cropHeight: null,
        zIndex: 0,
        visible: true,
        keyframes: [],
        effects: [],
      },
    ]);

    const job = await services.renderJobService.enqueueContract(
      projectId,
      owner.user.id,
      contract,
    );

    await makeWorker().tick();

    const failed = await services.renderJobService.get({
      projectId,
      renderJobId: job.id,
      userId: owner.user.id,
    });

    expect(failed.status).toBe("FAILED");
    expect(failed.errorCode).toBe("GROUP_LAYER_UNSUPPORTED");
    expect(
      await services.renderJobService.artifact({
        projectId,
        renderJobId: job.id,
        userId: owner.user.id,
      }),
    ).toBeNull();
  });

  it("fails an unresolvable media asset", async () => {
    const compositionId = await createCanvasComposition("Media");
    const contract = baseContract(compositionId, [
      {
        id: "layer_media",
        name: "Missing",
        type: "MEDIA",
        assetRef: "capture:does-not-exist",
        textContent: null,
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        rotation: 0,
        opacity: 1,
        fit: "CONTAIN",
        cropX: 0,
        cropY: 0,
        cropWidth: null,
        cropHeight: null,
        zIndex: 0,
        visible: true,
        keyframes: [],
        effects: [],
      },
    ]);

    const job = await services.renderJobService.enqueueContract(
      projectId,
      owner.user.id,
      contract,
    );

    await makeWorker().tick();

    const failed = await services.renderJobService.get({
      projectId,
      renderJobId: job.id,
      userId: owner.user.id,
    });

    expect(failed.status).toBe("FAILED");
    expect(failed.errorCode).toBe("CAPTURE_NOT_FOUND");
  });
});
