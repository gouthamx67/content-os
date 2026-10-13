import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupUser,
  createImageSource,
  createProject,
  createWritingSource,
  loadAdaptationTestContext,
  type Orm,
  type Services,
} from "./helpers";
import { createId } from "../../../lib/id";

let orm: Orm;
let services: Services;
let owner: Awaited<ReturnType<Services["authService"]["register"]>>;
let projectId: string;

const now = () => new Date().toISOString();

async function planFor(args: {
  targets: { formatId: string; platformId: string }[];
  sourceType?: "WRITING_VARIANT" | "GENERATED_IMAGE" | "VISUAL_COMPOSITION";
}) {
  const stamp = now();
  const batchId = createId("abatch");

  return {
    batch: {
      id: batchId,
      projectId,
      requestedById: owner.user.id,
      sourceType: args.sourceType ?? "WRITING_VARIANT",
      sourceId: "src-1",
      sourceSnapshot: "{}",
      sourceSha256: "a".repeat(64),
      targetCount: args.targets.length,
      createdAt: stamp,
      updatedAt: stamp,
    },
    jobs: args.targets.map((target) => ({
      id: createId("ajob"),
      batchId,
      projectId,
      requestedById: owner.user.id,
      platformId: target.platformId,
      formatId: target.formatId,
      kind: "COPY" as const,
      recipe: JSON.stringify({ recipeVersion: 1 }),
      recipeSha256: "b".repeat(64),
      createdAt: stamp,
      updatedAt: stamp,
    })),
  };
}

beforeAll(async () => {
  const loaded = await loadAdaptationTestContext();
  orm = loaded.orm;
  services = loaded.services;
  const created = await createProject(services);
  owner = created.owner;
  projectId = created.projectId;
});

afterAll(async () => {
  await cleanupUser(orm, owner, projectId);
});

describe("adaptation postgres repository", () => {
  it("writes a batch and its jobs together and reads them back", async () => {
    const plan = await planFor({
      targets: [
        { formatId: "COPY_SHORT", platformId: "linkedin" },
        { formatId: "COPY_LONG", platformId: "" },
      ],
    });

    const batch = await services.adaptationRepository.createBatchWithJobs(plan);
    const jobs = await services.adaptationRepository.listJobs(batch.id);

    expect(batch.id).toBe(plan.batch.id);
    expect(batch.targetCount).toBe(2);
    expect(batch.status).toBe("QUEUED");
    expect(batch.progressPct).toBe(0);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.formatId).sort()).toEqual([
      "COPY_LONG",
      "COPY_SHORT",
    ]);
    expect(jobs.every((job) => job.status === "QUEUED")).toBe(true);
  });

  it("resolves a batch only within its own project", async () => {
    const plan = await planFor({
      targets: [{ formatId: "COPY_SHORT", platformId: "" }],
    });
    await services.adaptationRepository.createBatchWithJobs(plan);

    expect(
      await services.adaptationRepository.getBatch(projectId, plan.batch.id),
    ).not.toBeNull();

    expect(
      await services.adaptationRepository.getBatch(
        "another-project",
        plan.batch.id,
      ),
    ).toBeNull();
  });

  it("lists a project's batches newest first", async () => {
    const first = await services.adaptationRepository.createBatchWithJobs(
      await planFor({ targets: [{ formatId: "COPY_SHORT", platformId: "" }] }),
    );
    const second = await services.adaptationRepository.createBatchWithJobs(
      await planFor({ targets: [{ formatId: "COPY_CAPTION", platformId: "" }] }),
    );

    const listed = await services.adaptationRepository.listBatches(projectId);

    expect(listed.map((batch) => batch.id)).toContain(first.id);
    expect(listed.map((batch) => batch.id)).toContain(second.id);
    expect(listed[0]!.createdAt >= listed[listed.length - 1]!.createdAt).toBe(
      true,
    );
  });

  it("claims each queued job once and never hands the same one out twice", async () => {
    // `claimNext` is a global queue that other tests in this file share, so the
    // leftovers are cleared first: otherwise the claim under test would land on
    // somebody else's row and prove nothing.
    for (const stale of await orm.AdaptationJob.where({ status: "QUEUED" }).all()) {
      await orm.AdaptationJob.where({ id: stale.id })
        .update({ status: "CANCELLED", finishedAt: now(), updatedAt: now() })
        .catch(() => undefined);
    }

    const plan = await planFor({
      targets: [{ formatId: "COPY_SHORT", platformId: "" }],
    });
    await services.adaptationRepository.createBatchWithJobs(plan);

    const first = await services.adaptationRepository.claimNext();
    const second = await services.adaptationRepository.claimNext();

    expect(first?.id).toBe(plan.jobs[0]!.id);
    expect(first?.status).toBe("RUNNING");

    // The job is claimed, so it can never be handed out a second time.
    expect(second).toBeNull();

    const settled = await services.adaptationRepository.getJob(
      projectId,
      first!.id,
    );
    expect(settled?.status).toBe("RUNNING");
  });

  it("marks a job succeeded with its measured output", async () => {
    const plan = await planFor({
      targets: [{ formatId: "COPY_SHORT", platformId: "" }],
    });
    await services.adaptationRepository.createBatchWithJobs(plan);

    const stamp = now();
    await services.adaptationRepository.markSucceeded({
      jobId: plan.jobs[0]!.id,
      output: {
        outputText: "Northwind Analytics is the content operating system.",
        outputMimeType: "text/plain; charset=utf-8",
        outputStorageKey: null,
        outputByteSize: 51,
        outputChecksumSha256: "c".repeat(64),
        outputWidth: null,
        outputHeight: null,
        renderJobId: null,
      },
      finishedAt: stamp,
      updatedAt: stamp,
    });

    const job = await services.adaptationRepository.getJob(
      projectId,
      plan.jobs[0]!.id,
    );

    expect(job?.status).toBe("SUCCEEDED");
    expect(job?.outputText).toContain("Northwind");
    expect(job?.outputChecksumSha256).toBe("c".repeat(64));
    expect(job?.finishedAt).not.toBeNull();
  });

  it("records a failure reason on the job", async () => {
    const plan = await planFor({
      targets: [{ formatId: "IMAGE_SQUARE", platformId: "" }],
    });
    await services.adaptationRepository.createBatchWithJobs(plan);

    const stamp = now();
    await services.adaptationRepository.markFailed({
      jobId: plan.jobs[0]!.id,
      errorCode: "ADAPTATION_IMAGE_SOURCE_OPAQUE",
      errorMessage: "The source image is not transparent",
      finishedAt: stamp,
      updatedAt: stamp,
    });

    const job = await services.adaptationRepository.getJob(
      projectId,
      plan.jobs[0]!.id,
    );

    expect(job?.status).toBe("FAILED");
    expect(job?.errorCode).toBe("ADAPTATION_IMAGE_SOURCE_OPAQUE");
    expect(job?.errorMessage).toContain("not transparent");
  });

  it("derives batch status and progress from its jobs", async () => {
    const plan = await planFor({
      targets: [
        { formatId: "COPY_SHORT", platformId: "" },
        { formatId: "COPY_LONG", platformId: "" },
        { formatId: "COPY_CAPTION", platformId: "" },
      ],
    });
    await services.adaptationRepository.createBatchWithJobs(plan);

    const stamp = now();
    const [first, second] = plan.jobs;

    await services.adaptationRepository.markSucceeded({
      jobId: first!.id,
      output: {
        outputText: "a",
        outputMimeType: "text/plain; charset=utf-8",
        outputStorageKey: null,
        outputByteSize: 1,
        outputChecksumSha256: "d".repeat(64),
        outputWidth: null,
        outputHeight: null,
        renderJobId: null,
      },
      finishedAt: stamp,
      updatedAt: stamp,
    });

    const partial = await services.adaptationRepository.refreshBatchStatus({
      batchId: plan.batch.id,
      updatedAt: stamp,
    });

    expect(partial?.progressPct).toBe(33);
    expect(partial?.status).toBe("RUNNING");
    expect(partial?.finishedAt).toBeNull();

    await services.adaptationRepository.markFailed({
      jobId: second!.id,
      errorCode: "ADAPTATION_FAILED",
      errorMessage: "nope",
      finishedAt: stamp,
      updatedAt: stamp,
    });

    // One target is still open, so the batch is still running rather than partial.
    const stillRunning = await services.adaptationRepository.refreshBatchStatus({
      batchId: plan.batch.id,
      updatedAt: stamp,
    });

    expect(stillRunning?.status).toBe("RUNNING");

    await services.adaptationRepository.markCancelled({
      jobId: plan.jobs[2]!.id,
      finishedAt: stamp,
      updatedAt: stamp,
    });

    const settled = await services.adaptationRepository.refreshBatchStatus({
      batchId: plan.batch.id,
      updatedAt: stamp,
    });

    expect(settled?.status).toBe("PARTIAL");
    expect(settled?.progressPct).toBe(100);
    expect(settled?.finishedAt).not.toBeNull();
  });

  it("cancels queued jobs outright and asks running ones to stop", async () => {
    const plan = await planFor({
      targets: [
        { formatId: "COPY_SHORT", platformId: "" },
        { formatId: "COPY_LONG", platformId: "" },
      ],
    });
    await services.adaptationRepository.createBatchWithJobs(plan);

    const [queued, running] = plan.jobs;
    const stamp = now();

    // Set the two jobs into known states without going through the global queue,
    // which other tests in this file also share.
    await services.adaptationRepository.markRunning({
      jobId: running!.id,
      startedAt: stamp,
      updatedAt: stamp,
    });

    const batch = await services.adaptationRepository.requestCancelBatch({
      projectId,
      batchId: plan.batch.id,
      finishedAt: stamp,
    });

    expect(batch).not.toBeNull();
    expect(batch?.status).toBe("CANCEL_REQUESTED");

    const jobs = await services.adaptationRepository.listJobs(plan.batch.id);
    const byId = new Map(jobs.map((job) => [job.id, job.status]));

    // Queued work is finished on the spot; running work is asked to stop and
    // finalises its own row.
    expect(byId.get(queued!.id)).toBe("CANCELLED");
    expect(byId.get(running!.id)).toBe("CANCEL_REQUESTED");

    // Once the running job finalises itself, the batch is fully cancelled.
    const pending = await services.adaptationRepository.findCancelRequestedJobs();
    const stillRunning = pending.find((job) => job.id === running!.id);

    expect(stillRunning).toBeDefined();

    await services.adaptationRepository.markCancelled({
      jobId: running!.id,
      finishedAt: stamp,
      updatedAt: stamp,
    });

    const finished = await services.adaptationRepository.refreshBatchStatus({
      batchId: plan.batch.id,
      updatedAt: stamp,
    });

    expect(finished?.status).toBe("CANCELLED");
    expect(finished?.progressPct).toBe(100);
  });

  it("refuses to cancel a batch that has already finished", async () => {
    const plan = await planFor({
      targets: [{ formatId: "COPY_SHORT", platformId: "" }],
    });
    await services.adaptationRepository.createBatchWithJobs(plan);

    const stamp = now();
    await services.adaptationRepository.markSucceeded({
      jobId: plan.jobs[0]!.id,
      output: {
        outputText: "done",
        outputMimeType: "text/plain; charset=utf-8",
        outputStorageKey: null,
        outputByteSize: 4,
        outputChecksumSha256: "e".repeat(64),
        outputWidth: null,
        outputHeight: null,
        renderJobId: null,
      },
      finishedAt: stamp,
      updatedAt: stamp,
    });

    await services.adaptationRepository.refreshBatchStatus({
      batchId: plan.batch.id,
      updatedAt: stamp,
    });

    const cancelled = await services.adaptationRepository.requestCancelBatch({
      projectId,
      batchId: plan.batch.id,
      finishedAt: stamp,
    });

    expect(cancelled).toBeNull();
  });

  it("parks a video job on its render and lists it for reconciliation", async () => {
    const plan = await planFor({
      targets: [{ formatId: "VIDEO_VERTICAL", platformId: "" }],
    });
    await services.adaptationRepository.createBatchWithJobs(plan);

    const stamp = now();
    await services.adaptationRepository.markWaitingRender({
      jobId: plan.jobs[0]!.id,
      renderJobId: "render-1",
      progressPct: 40,
      updatedAt: stamp,
    });

    const job = await services.adaptationRepository.getJob(
      projectId,
      plan.jobs[0]!.id,
    );

    expect(job?.status).toBe("WAITING_RENDER");
    expect(job?.renderJobId).toBe("render-1");
    expect(job?.progressPct).toBe(40);

    const waiting = await services.adaptationRepository.findWaitingRenderJobs();
    expect(waiting.map((entry) => entry.id)).toContain(plan.jobs[0]!.id);
  });

  it("finishes a queued job outright when only it is cancelled", async () => {
    const plan = await planFor({
      targets: [{ formatId: "COPY_SHORT", platformId: "" }],
    });
    await services.adaptationRepository.createBatchWithJobs(plan);

    const stamp = now();
    const accepted = await services.adaptationRepository.requestCancelJob({
      projectId,
      jobId: plan.jobs[0]!.id,
      finishedAt: stamp,
    });

    expect(accepted).toBe(true);

    const job = await services.adaptationRepository.getJob(
      projectId,
      plan.jobs[0]!.id,
    );

    expect(job?.status).toBe("CANCELLED");
    expect(job?.finishedAt).not.toBeNull();
  });

  it("finds a running job whose cancellation was never finalised", async () => {
    const plan = await planFor({
      targets: [{ formatId: "COPY_SHORT", platformId: "" }],
    });
    await services.adaptationRepository.createBatchWithJobs(plan);

    const stamp = now();

    await services.adaptationRepository.markRunning({
      jobId: plan.jobs[0]!.id,
      startedAt: stamp,
      updatedAt: stamp,
    });

    const accepted = await services.adaptationRepository.requestCancelJob({
      projectId,
      jobId: plan.jobs[0]!.id,
      finishedAt: stamp,
    });

    expect(accepted).toBe(true);

    const pending = await services.adaptationRepository.findCancelRequestedJobs();
    expect(pending.map((entry) => entry.id)).toContain(plan.jobs[0]!.id);
  });

  it("finds queued jobs older than the abandoned cutoff", async () => {
    const plan = await planFor({
      targets: [{ formatId: "COPY_SHORT", platformId: "mastodon" }],
    });
    await services.adaptationRepository.createBatchWithJobs(plan);

    const future = new Date(Date.now() + 60_000).toISOString();
    const stale = await services.adaptationRepository.findStaleQueuedJobs(future);

    expect(stale.map((entry) => entry.id)).toContain(plan.jobs[0]!.id);

    const past = new Date(Date.now() - 60_000).toISOString();
    const notStale = await services.adaptationRepository.findStaleQueuedJobs(past);

    expect(notStale.map((entry) => entry.id)).not.toContain(plan.jobs[0]!.id);
  });

  it("reports a job from another project as missing", async () => {
    const plan = await planFor({
      targets: [{ formatId: "COPY_SHORT", platformId: "" }],
    });
    await services.adaptationRepository.createBatchWithJobs(plan);

    expect(
      await services.adaptationRepository.getJob("other-project", plan.jobs[0]!.id),
    ).toBeNull();
  });
});

describe("adaptation project scoping", () => {
  it("keeps one project's variants out of another's snapshot lookup", async () => {
    const other = await createProject(services, "cp19-other");
    const writing = await createWritingSource(orm, services, {
      projectId,
      userId: owner.user.id,
    });

    await expect(
      services.adaptationSourceResolver.resolve({
        projectId: other.projectId,
        sourceType: "WRITING_VARIANT",
        sourceId: writing.variantId,
      }),
    ).rejects.toMatchObject({ code: "ADAPTATION_SOURCE_NOT_FOUND" });

    const resolved = await services.adaptationSourceResolver.resolve({
      projectId,
      sourceType: "WRITING_VARIANT",
      sourceId: writing.variantId,
    });

    expect(resolved.sourceType).toBe("WRITING_VARIANT");

    await cleanupUser(orm, other.owner, other.projectId);
  });

  it("reads a generated image's transparency from its pixels", async () => {
    const image = await createImageSource(
      services,
      { projectId, userId: owner.user.id },
      { width: 400, height: 300, transparent: true },
    );

    const resolved = await services.adaptationSourceResolver.resolve({
      projectId,
      sourceType: "GENERATED_IMAGE",
      sourceId: image.assetId,
    });

    expect(resolved.sourceType).toBe("GENERATED_IMAGE");
    if (resolved.sourceType !== "GENERATED_IMAGE") return;

    expect(resolved.transparent).toBe(true);
    expect(resolved.width).toBe(400);
    expect(resolved.height).toBe(300);
    expect(resolved.checksumSha256).toBe(
      (await services.imageRepository.getAsset(projectId, image.assetId))
        ?.checksumSha256,
    );
  });
});
