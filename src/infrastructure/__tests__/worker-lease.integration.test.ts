import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicOrm } from "../../prisma/db";
import type { RenderJobRepository } from "../../core/ports/render-job-repository";
import type { WorkerKind } from "../worker-heartbeat";
import { WORKER_LEASE_EXPIRED_CODE } from "../../lib/worker-lease";

const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";

type Services = typeof import("../../infrastructure/services");

let services: Services;
let orm: PublicOrm;
let renderJobs: RenderJobRepository;
let readWorkerLiveness: typeof import("../worker-heartbeat").readWorkerLiveness;

let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;

const heartbeatIds: string[] = [];
const EXPIRED_AT = "2000-01-01T00:00:00.000Z";

async function enqueueJob(name: string): Promise<string> {
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
    textContent: "lease me",
  });
  const job = await services.renderJobService.enqueue({
    projectId,
    compositionId: composition.id,
    userId: owner.user.id,
  });
  return job.id;
}

async function expireLease(renderJobId: string): Promise<void> {
  await orm.RenderJob.where({ id: renderJobId }).update({
    leaseExpiresAt: EXPIRED_AT,
  });
}

/**
 * Claims everything already on the queue so a later claimNext() is guaranteed
 * to return the job this test just enqueued. Claimed rows carry a fresh lease,
 * so they never count toward a later expiry sweep.
 */
async function drainQueue(): Promise<void> {
  while (await renderJobs.claimNext()) {
    // Keep claiming until the queue is empty.
  }
}

beforeAll(async () => {
  process.env["DATABASE_URL"] = TEST_DATABASE_URL;

  const [{ db }, loadedServices, loadedContainer, heartbeat] = await Promise.all([
    import("../../prisma/db"),
    import("../../infrastructure/services"),
    import("../../infrastructure/container"),
    import("../worker-heartbeat"),
  ]);

  services = loadedServices;
  orm = db.orm.public;
  renderJobs = loadedContainer.container.repositories.renderJobs;
  readWorkerLiveness = heartbeat.readWorkerLiveness;

  owner = await services.authService.register({
    email: `cp24-lease-${Date.now()}@test.local`,
    password: "test-password-1",
  });

  const project = await services.projectService.createForWorkspace(
    owner.workspace!.id,
    { name: "CP24 lease" },
    owner.user.id,
  );
  projectId = project.id;
});

afterAll(async () => {
  if (!owner) return;

  await orm.RenderJob.where((row) => row.projectId.eq(projectId))
    .delete()
    .catch(() => undefined);
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

  for (const workerId of heartbeatIds) {
    await orm.WorkerHeartbeat.where({ workerId })
      .delete()
      .catch(() => undefined);
  }
});

describe("worker lease recovery", () => {
  it("stamps a lease when a job is claimed", async () => {
    await drainQueue();
    const renderJobId = await enqueueJob("Claim lease");
    const claimed = await renderJobs.claimNext();
    expect(claimed?.id).toBe(renderJobId);
    expect(claimed?.status).toBe("RUNNING");

    const row = await orm.RenderJob.where({ id: renderJobId }).first();
    expect(row?.leaseExpiresAt).not.toBeNull();
  });

  it("requeues a RUNNING job whose lease expired and names the reason", async () => {
    await drainQueue();
    const renderJobId = await enqueueJob("Requeue lease");
    await renderJobs.claimNext();
    await expireLease(renderJobId);

    const result = await renderJobs.reclaimExpiredLeases(
      new Date().toISOString(),
    );
    expect(result.requeued).toBeGreaterThanOrEqual(1);

    const after = await renderJobs.get(projectId, renderJobId);
    expect(after?.status).toBe("QUEUED");
    expect(after?.errorCode).toBe(WORKER_LEASE_EXPIRED_CODE);
    expect(after?.progressPct).toBe(0);
    expect(after?.startedAt).toBeNull();
  });

  it("finishes a CANCEL_REQUESTED job whose owner vanished", async () => {
    await drainQueue();
    const renderJobId = await enqueueJob("Cancel lease");
    await renderJobs.claimNext();
    await renderJobs.requestCancel(projectId, renderJobId);
    await expireLease(renderJobId);

    const result = await renderJobs.reclaimExpiredLeases(
      new Date().toISOString(),
    );
    expect(result.cancelled).toBeGreaterThanOrEqual(1);

    const after = await renderJobs.get(projectId, renderJobId);
    expect(after?.status).toBe("CANCELLED");
  });

  it("guards terminal writes so only the first finalizer wins", async () => {
    await drainQueue();
    const renderJobId = await enqueueJob("Terminal guard");
    await renderJobs.claimNext();

    const now = new Date().toISOString();
    const first = await renderJobs.markSucceeded({
      renderJobId,
      ffmpegVersion: null,
      finishedAt: now,
      updatedAt: now,
    });
    expect(first).toBe(true);

    const second = await renderJobs.markSucceeded({
      renderJobId,
      ffmpegVersion: null,
      finishedAt: now,
      updatedAt: now,
    });
    expect(second).toBe(false);

    const after = await renderJobs.get(projectId, renderJobId);
    expect(after?.status).toBe("SUCCEEDED");
    const row = await orm.RenderJob.where({ id: renderJobId }).first();
    expect(row?.leaseExpiresAt).toBeNull();
  });

  it("does not renew a lease for a job that is not RUNNING", async () => {
    await drainQueue();
    const renderJobId = await enqueueJob("Renew guard");
    await renderJobs.claimNext();
    const now = new Date().toISOString();
    await renderJobs.markFailed({
      renderJobId,
      errorCode: "TEST",
      errorMessage: "test",
      finishedAt: now,
      updatedAt: now,
    });

    await expect(renderJobs.renewLease(renderJobId, now)).resolves.toBe(false);
  });
});

describe("worker liveness", () => {
  async function writeHeartbeat(
    kind: WorkerKind,
    overrides: Partial<{
      status: string;
      lastTickAt: string;
      lastEvent: string | null;
    }> = {},
  ): Promise<string> {
    const workerId = `itest:${kind}:${randomUUID()}`;
    heartbeatIds.push(workerId);
    await orm.WorkerHeartbeat.create({
      workerId,
      kind,
      status: overrides.status ?? "RUNNING",
      startedAt: new Date().toISOString(),
      lastTickAt: overrides.lastTickAt ?? new Date().toISOString(),
      lastEvent: overrides.lastEvent ?? null,
      processed: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      updatedAt: new Date().toISOString(),
    });
    return workerId;
  }

  it("reports ACTIVE for a fresh RUNNING heartbeat", async () => {
    await writeHeartbeat("render");
    const liveness = await readWorkerLiveness();
    expect(liveness.find((worker) => worker.kind === "render")?.status).toBe(
      "ACTIVE",
    );
  });

  it("reports STALE for a RUNNING heartbeat that went quiet", async () => {
    for (const workerId of heartbeatIds) {
      await orm.WorkerHeartbeat.where({ workerId }).delete();
    }
    heartbeatIds.length = 0;

    await writeHeartbeat("render", {
      lastTickAt: "2000-01-01T00:00:00.000Z",
    });
    const liveness = await readWorkerLiveness();
    expect(liveness.find((worker) => worker.kind === "render")?.status).toBe(
      "STALE",
    );
  });

  it("reports OFFLINE when the newest heartbeat is not RUNNING", async () => {
    for (const workerId of heartbeatIds) {
      await orm.WorkerHeartbeat.where({ workerId }).delete();
    }
    heartbeatIds.length = 0;

    await writeHeartbeat("render", { status: "STOPPED" });
    const liveness = await readWorkerLiveness();
    expect(liveness.find((worker) => worker.kind === "render")?.status).toBe(
      "OFFLINE",
    );
    expect(liveness).toHaveLength(6);
  });
});
