import { describe, expect, it, vi } from "vitest";
import { PublishingWorker } from "../publishing-worker";
import type { PublishingRepository } from "../../../core/ports/publishing-repository";
import type { PublicationRecord } from "../domain/types";
import { RenderWorkerHealth } from "../../video-rendering/worker-health";

function publication(id: string, status: PublicationRecord["status"]): PublicationRecord {
  return { id, projectId: "p1", status } as PublicationRecord;
}

function fakeRepository(overrides: Partial<PublishingRepository>) {
  return {
    claimNextDue: vi.fn(async () => null),
    claimNextAmbiguous: vi.fn(async () => null),
    claimNextAnalytics: vi.fn(async () => null),
    ...overrides,
  } as unknown as PublishingRepository;
}

describe("PublishingWorker", () => {
  it("reports no work when every queue is empty", async () => {
    const repository = fakeRepository({});
    const worker = new PublishingWorker({
      repository,
      dispatch: vi.fn(),
      collectAnalytics: vi.fn(),
    });
    await expect(worker.tick()).resolves.toBe(false);
  });

  it("drains due publishes before reconciliations and analytics", async () => {
    const due = publication("pub-due", "QUEUED");
    const order: string[] = [];
    const repository = fakeRepository({
      claimNextDue: vi.fn(async () => due),
      claimNextAmbiguous: vi.fn(async () => {
        order.push("ambiguous");
        return publication("pub-amb", "AMBIGUOUS");
      }),
      claimNextAnalytics: vi.fn(async () => {
        order.push("analytics");
        return publication("pub-an", "PUBLISHED");
      }),
    });
    const health = new RenderWorkerHealth();
    const worker = new PublishingWorker({
      repository,
      dispatch: vi.fn(async () => publication("pub-due", "PUBLISHED")),
      collectAnalytics: vi.fn(),
      health,
    });

    await worker.tick();
    expect(order).toEqual([]);
    expect(health.snapshot().succeeded).toBe(1);
  });

  it("reconciles an ambiguous publication by dispatching the same record", async () => {
    const ambiguous = publication("pub-amb", "AMBIGUOUS");
    const repository = fakeRepository({
      claimNextAmbiguous: vi.fn(async () => ambiguous),
    });
    const dispatch = vi.fn(async () => publication("pub-amb", "PUBLISHED"));
    const worker = new PublishingWorker({
      repository,
      dispatch,
      collectAnalytics: vi.fn(),
    });

    await expect(worker.tick()).resolves.toBe(true);
    expect(dispatch).toHaveBeenCalledWith(ambiguous);
  });

  it("collects analytics through the analytics callable and counts failures", async () => {
    const published = publication("pub-an", "PUBLISHED");
    const repository = fakeRepository({
      claimNextAnalytics: vi.fn(async () => published),
    });
    const health = new RenderWorkerHealth();
    const worker = new PublishingWorker({
      repository,
      dispatch: vi.fn(),
      collectAnalytics: vi.fn(async () => ({
        ...published,
        analyticsErrorCode: "PUBLISHING_PROVIDER_AUTH",
      })),
      health,
    });

    await worker.tick();
    expect(health.snapshot().failed).toBe(1);
    expect(health.snapshot().succeeded).toBe(0);
  });

  it("records a throwing handler as a failed job instead of crashing the loop", async () => {
    const repository = fakeRepository({
      claimNextDue: vi.fn(async () => publication("pub-boom", "QUEUED")),
    });
    const health = new RenderWorkerHealth();
    const worker = new PublishingWorker({
      repository,
      dispatch: vi.fn(async () => {
        throw new Error("provider exploded");
      }),
      collectAnalytics: vi.fn(),
      health,
    });

    await expect(worker.tick()).resolves.toBe(true);
    expect(health.snapshot().failed).toBe(1);
    expect(health.snapshot().lastError).toBe("provider exploded");
  });

  it("stops its run loop when the signal aborts", async () => {
    const repository = fakeRepository({});
    const health = new RenderWorkerHealth();
    const worker = new PublishingWorker({
      repository,
      dispatch: vi.fn(),
      collectAnalytics: vi.fn(),
      health,
      pollIntervalMs: 5,
    });
    const controller = new AbortController();
    const running = worker.run(controller.signal);
    setTimeout(() => controller.abort(), 20);
    await running;
    expect(health.snapshot().running).toBe(false);
    expect(health.snapshot().lastTickAt).not.toBeNull();
  });
});
