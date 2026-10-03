import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicOrm } from "../../../prisma/db";

const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";

type Services = typeof import("../../../infrastructure/services");

let services: Services;
let orm: PublicOrm;
let renderJobs: (typeof import("../../../infrastructure/container"))["container"]["repositories"]["renderJobs"];

let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;
let otherProjectId: string;

async function createTextComposition(name: string): Promise<string> {
  const composition = await services.visualCompositionService.createComposition({
    projectId,
    userId: owner.user.id,
    name,
    durationMs: 1000,
  });

  await services.visualLayerService.addLayer({
    projectId,
    compositionId: composition.id,
    userId: owner.user.id,
    type: "TEXT",
    textContent: "render me",
  });

  return composition.id;
}

beforeAll(async () => {
  process.env["DATABASE_URL"] = TEST_DATABASE_URL;

  const [{ db }, loadedServices, loadedContainer] = await Promise.all([
    import("../../../prisma/db"),
    import("../../../infrastructure/services"),
    import("../../../infrastructure/container"),
  ]);

  services = loadedServices;
  orm = db.orm.public;
  renderJobs = loadedContainer.container.repositories.renderJobs;

  owner = await services.authService.register({
    email: `cp15-render-${Date.now()}@test.local`,
    password: "test-password-1",
  });

  const project = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "CP15 render" },
    owner.user.id,
  );
  projectId = project.id;

  const other = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "CP15 render other" },
    owner.user.id,
  );
  otherProjectId = other.id;
});

afterAll(async () => {
  if (!owner) return;

  await orm.VisualComposition.where((row) => row.projectId.eq(projectId))
    .delete()
    .catch(() => undefined);
  await orm.VisualComposition.where((row) => row.projectId.eq(otherProjectId))
    .delete()
    .catch(() => undefined);
  await orm.Project.where({ id: projectId }).delete().catch(() => undefined);
  await orm.Project.where({ id: otherProjectId }).delete().catch(() => undefined);
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
});

describe("render job persistence", () => {
  it("snapshots the renderer contract and hashes the scene", async () => {
    const compositionId = await createTextComposition("Snapshot");
    const job = await services.renderJobService.enqueue({
      projectId,
      compositionId,
      userId: owner.user.id,
    });

    expect(job.status).toBe("QUEUED");
    expect(job.outputFormat).toBe("MP4");
    expect(job.progressPct).toBe(0);
    expect(job.sceneSha256).toMatch(/^[0-9a-f]{64}$/);

    const stored = JSON.parse(job.sceneGraph) as {
      composition: { id: string; layers: unknown[] };
    };
    expect(stored.composition.id).toBe(compositionId);
    expect(stored.composition.layers).toHaveLength(1);
  });

  it("claims the oldest queued job exactly once", async () => {
    // Drain anything left queued by earlier tests so this test owns the queue.
    while (await renderJobs.claimNext()) {
      // Keep claiming until the queue is empty.
    }

    const compositionId = await createTextComposition("Claim");
    const job = await services.renderJobService.enqueue({
      projectId,
      compositionId,
      userId: owner.user.id,
    });

    const first = await renderJobs.claimNext();
    expect(first).not.toBeNull();
    expect(first!.id).toBe(job.id);
    expect(first!.status).toBe("RUNNING");
    expect(first!.startedAt).not.toBeNull();

    // The only queued row is now RUNNING, so a second claim finds no work
    // rather than handing the same row out twice.
    const second = await renderJobs.claimNext();
    expect(second).toBeNull();
  });

  it("cancels a queued job without running it", async () => {
    const compositionId = await createTextComposition("Cancel queued");
    const job = await services.renderJobService.enqueue({
      projectId,
      compositionId,
      userId: owner.user.id,
    });

    const cancelled = await services.renderJobService.cancel({
      projectId,
      renderJobId: job.id,
      userId: owner.user.id,
    });

    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.finishedAt).not.toBeNull();
    expect(await renderJobs.claimNext()).toBeNull();
  });

  it("marks a running job as cancel-requested", async () => {
    const compositionId = await createTextComposition("Cancel running");
    const job = await services.renderJobService.enqueue({
      projectId,
      compositionId,
      userId: owner.user.id,
    });

    const claimed = await renderJobs.claimNext();
    expect(claimed!.id).toBe(job.id);

    const requested = await services.renderJobService.cancel({
      projectId,
      renderJobId: job.id,
      userId: owner.user.id,
    });

    expect(requested.status).toBe("CANCEL_REQUESTED");
  });

  it("treats a render job from another project as missing", async () => {
    const compositionId = await createTextComposition("Scoped");
    const job = await services.renderJobService.enqueue({
      projectId,
      compositionId,
      userId: owner.user.id,
    });

    await expect(
      services.renderJobService.get({
        projectId: otherProjectId,
        renderJobId: job.id,
        userId: owner.user.id,
      }),
    ).rejects.toMatchObject({ name: "HttpError", status: 404 });
  });

  it("persists an artifact with its checksum", async () => {
    const compositionId = await createTextComposition("Artifact");
    const job = await services.renderJobService.enqueue({
      projectId,
      compositionId,
      userId: owner.user.id,
    });

    const artifact = await renderJobs.createArtifact({
      id: "rart_integration",
      renderJobId: job.id,
      projectId,
      storageKey: `${projectId}/${job.id}.mp4`,
      mimeType: "video/mp4",
      byteSize: 1234,
      checksumSha256: "a".repeat(64),
      createdAt: new Date().toISOString(),
    });

    expect(artifact.renderJobId).toBe(job.id);

    const found = await renderJobs.getArtifactByJob(job.id);
    expect(found?.checksumSha256).toBe("a".repeat(64));

    const scoped = await renderJobs.getArtifact(otherProjectId, artifact.id);
    expect(scoped).toBeNull();
  });
});
