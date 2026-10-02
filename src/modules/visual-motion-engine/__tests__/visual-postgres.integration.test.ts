import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicOrm } from "../../../prisma/db";
import { HttpError } from "../../../lib/http";

const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";

const FIXTURE = Buffer.from("content-os-cp14-real-visual-fixture", "utf8");
const CAPTURE_ROOT = path.join(process.cwd(), ".content-os", "captures");

type Services = typeof import("../../../infrastructure/services");

let services: Services;
let orm: PublicOrm;

let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;
let otherProjectId: string;
let takeId: string;

beforeAll(async () => {
  process.env["DATABASE_URL"] = TEST_DATABASE_URL;

  const [{ db }, loadedServices] = await Promise.all([
    import("../../../prisma/db"),
    import("../../../infrastructure/services"),
  ]);

  services = loadedServices;
  orm = db.orm.public;

  owner = await services.authService.register({
    email: `cp14-${Date.now()}@test.local`,
    password: "test-password-1",
  });

  const project = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "CP14 visual" },
    owner.user.id,
  );
  projectId = project.id;

  const other = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "CP14 visual other" },
    owner.user.id,
  );
  otherProjectId = other.id;

  const session = await services.captureService.createSession({
    projectId,
    userId: owner.user.id,
  });

  await services.captureService.startSession({
    projectId,
    sessionId: session.id,
    userId: owner.user.id,
  });

  const take = await services.captureService.addTake({
    projectId,
    sessionId: session.id,
    userId: owner.user.id,
    mode: "CAMERA",
    mimeType: "video/webm",
    filename: "fixture.webm",
    bytes: FIXTURE,
  });

  takeId = take.id;
});

afterAll(async () => {
  if (owner) {
    // Visual composition cascades to layers -> keyframes/effects.
    await orm.VisualComposition.where((row) => row.projectId.eq(projectId))
      .delete()
      .catch(() => undefined);
    await orm.VisualComposition.where((row) =>
      row.projectId.eq(otherProjectId),
    )
      .delete()
      .catch(() => undefined);

    await orm.CaptureTake.where((row) => row.projectId.eq(projectId))
      .delete()
      .catch(() => undefined);
    await orm.CaptureSession.where((row) => row.projectId.eq(projectId))
      .delete()
      .catch(() => undefined);

    await rm(path.join(CAPTURE_ROOT, projectId), {
      recursive: true,
      force: true,
    }).catch(() => undefined);

    await orm.Project.where({ id: projectId })
      .delete()
      .catch(() => undefined);
    await orm.Project.where({ id: otherProjectId })
      .delete()
      .catch(() => undefined);
    await orm.WorkspaceMember.where((row) => row.userId.eq(owner.user.id))
      .delete()
      .catch(() => undefined);
    await orm.Session.where((row) => row.userId.eq(owner.user.id))
      .delete()
      .catch(() => undefined);
    await orm.Workspace.where({ id: owner.workspace!.id })
      .delete()
      .catch(() => undefined);
    await orm.User.where({ id: owner.user.id })
      .delete()
      .catch(() => undefined);
  }
});

describe("visual persistence", () => {
  it("creates a composition with defaults and reads it back", async () => {
    const composition = await services.visualCompositionService.createComposition({
      projectId,
      userId: owner.user.id,
      name: "Launch reel",
    });

    expect(composition.status).toBe("DRAFT");
    expect(composition.width).toBe(1080);
    expect(composition.height).toBe(1920);
    expect(composition.frameRate).toBe(30);
    expect(composition.durationMs).toBe(5000);

    const reloaded = await services.visualCompositionService.getComposition({
      projectId,
      compositionId: composition.id,
      userId: owner.user.id,
    });

    expect(reloaded.id).toBe(composition.id);
  });

  it("round-trips layers, keyframes and effects through PostgreSQL", async () => {
    const composition = await services.visualCompositionService.createComposition({
      projectId,
      userId: owner.user.id,
      name: "Motion",
      durationMs: 2000,
    });

    const media = await services.visualLayerService.addLayer({
      projectId,
      compositionId: composition.id,
      userId: owner.user.id,
      type: "MEDIA",
      assetRef: `capture:${takeId}`,
      name: "Hero",
    });

    expect(media.assetRef).toBe(`capture:${takeId}`);
    expect(media.width).toBe(composition.width);

    const text = await services.visualLayerService.addLayer({
      projectId,
      compositionId: composition.id,
      userId: owner.user.id,
      type: "TEXT",
      textContent: "Season one",
    });

    expect(text.zIndex).toBeGreaterThan(media.zIndex);

    await services.visualLayerService.updateLayer({
      projectId,
      compositionId: composition.id,
      layerId: text.id,
      userId: owner.user.id,
      changes: { x: 40, opacity: 0.5 },
    });

    await services.visualLayerService.addKeyframe({
      projectId,
      compositionId: composition.id,
      layerId: text.id,
      userId: owner.user.id,
      property: "OPACITY",
      timeMs: 0,
      fromValue: 0,
      toValue: 1,
      easing: "EASE_OUT",
    });

    await services.visualLayerService.setEffect({
      projectId,
      compositionId: composition.id,
      layerId: media.id,
      userId: owner.user.id,
      type: "BLUR",
      amount: 6,
    });

    const reloaded = await services.visualCompositionService.getComposition({
      projectId,
      compositionId: composition.id,
      userId: owner.user.id,
    });

    const reloadedText = reloaded.layers.find((layer) => layer.id === text.id)!;
    expect(reloadedText.x).toBe(40);
    expect(reloadedText.opacity).toBeCloseTo(0.5);
    expect(reloadedText.keyframes).toHaveLength(1);
    expect(reloadedText.keyframes[0]!.easing).toBe("EASE_OUT");

    const reloadedMedia = reloaded.layers.find((layer) => layer.id === media.id)!;
    expect(reloadedMedia.effects[0]!.type).toBe("BLUR");
    expect(reloadedMedia.effects[0]!.amount).toBeCloseTo(6);
  });

  it("upserts a keyframe on (layer, property, time) rather than duplicating", async () => {
    const composition = await services.visualCompositionService.createComposition({
      projectId,
      userId: owner.user.id,
      name: "Upsert",
      durationMs: 1000,
    });

    const layer = await services.visualLayerService.addLayer({
      projectId,
      compositionId: composition.id,
      userId: owner.user.id,
      type: "TEXT",
      textContent: "x",
    });

    await services.visualLayerService.addKeyframe({
      projectId,
      compositionId: composition.id,
      layerId: layer.id,
      userId: owner.user.id,
      property: "X",
      timeMs: 0,
      fromValue: 0,
      toValue: 10,
    });

    const afterSecond = await services.visualLayerService.addKeyframe({
      projectId,
      compositionId: composition.id,
      layerId: layer.id,
      userId: owner.user.id,
      property: "X",
      timeMs: 0,
      fromValue: 0,
      toValue: 99,
    });

    expect(afterSecond.keyframes).toHaveLength(1);
    expect(afterSecond.keyframes[0]!.toValue).toBe(99);
  });

  it("applies a preset as ordinary keyframes", async () => {
    const composition = await services.visualCompositionService.createComposition({
      projectId,
      userId: owner.user.id,
      name: "Preset",
      durationMs: 1000,
    });

    const layer = await services.visualLayerService.addLayer({
      projectId,
      compositionId: composition.id,
      userId: owner.user.id,
      type: "TEXT",
      textContent: "x",
    });

    const result = await services.visualLayerService.applyPreset({
      projectId,
      compositionId: composition.id,
      layerId: layer.id,
      userId: owner.user.id,
      presetId: "PULSE",
    });

    expect(result.keyframes).toHaveLength(2);
  });

  it("evaluates a deterministic frame and builds the renderer contract", async () => {
    const composition = await services.visualCompositionService.createComposition({
      projectId,
      userId: owner.user.id,
      name: "Evaluate",
      durationMs: 1000,
    });

    const layer = await services.visualLayerService.addLayer({
      projectId,
      compositionId: composition.id,
      userId: owner.user.id,
      type: "TEXT",
      textContent: "x",
    });

    await services.visualLayerService.addKeyframe({
      projectId,
      compositionId: composition.id,
      layerId: layer.id,
      userId: owner.user.id,
      property: "X",
      timeMs: 0,
      fromValue: 0,
      toValue: 100,
    });

    const frame = await services.visualCompositionService.evaluateFrame({
      projectId,
      compositionId: composition.id,
      userId: owner.user.id,
      timeMs: 1000,
    });

    expect(frame.layers[0]!.x).toBe(100);

    const scene = await services.visualCompositionService.rendererScene({
      projectId,
      compositionId: composition.id,
      userId: owner.user.id,
      timeMs: 1000,
    });

    expect(scene.contractVersion).toBe(1);
    expect(scene.layers[0]!.transform.x).toBe(100);
  });

  it("treats a composition from another project as missing", async () => {
    const composition = await services.visualCompositionService.createComposition({
      projectId,
      userId: owner.user.id,
      name: "Scoped",
    });

    await expect(
      services.visualCompositionService.getComposition({
        projectId: otherProjectId,
        compositionId: composition.id,
        userId: owner.user.id,
      }),
    ).rejects.toMatchObject({ name: "HttpError", status: 404 });
  });

  it("rejects a media layer whose reference is not a project take", async () => {
    const composition = await services.visualCompositionService.createComposition({
      projectId,
      userId: owner.user.id,
      name: "Bad ref",
    });

    await expect(
      services.visualLayerService.addLayer({
        projectId,
        compositionId: composition.id,
        userId: owner.user.id,
        type: "MEDIA",
        assetRef: "capture:does-not-exist",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("deletes a composition and its children", async () => {
    const composition = await services.visualCompositionService.createComposition({
      projectId,
      userId: owner.user.id,
      name: "Delete me",
    });

    await services.visualLayerService.addLayer({
      projectId,
      compositionId: composition.id,
      userId: owner.user.id,
      type: "TEXT",
      textContent: "x",
    });

    await services.visualCompositionService.deleteComposition({
      projectId,
      compositionId: composition.id,
      userId: owner.user.id,
    });

    const remaining = await orm.VisualComposition.where({
      id: composition.id,
    }).first();
    expect(remaining).toBeNull();

    await expect(
      services.visualCompositionService.getComposition({
        projectId,
        compositionId: composition.id,
        userId: owner.user.id,
      }),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
