import { hostname } from "node:os";
import { db } from "../prisma/db";
import { assertServerConfig } from "../lib/server-config";
import { logEvent, sanitizeError } from "../lib/observability";
import type { RenderWorkerHealth } from "../modules/video-rendering/worker-health";

/**
 * Shared process runtime for the six standalone workers.
 *
 * Responsibilities:
 * - fail fast on invalid mandatory configuration before claiming any work;
 * - expose liveness to the web process through the worker_heartbeat table,
 *   because /api/health runs in a different process and cannot inspect this
 *   one's memory;
 * - drain on SIGINT/SIGTERM (stop claiming, finish the in-flight job), with a
 *   second signal forcing an immediate exit for operators who cannot wait.
 *
 * The in-flight job is never killed by the first signal: an ffmpeg render is
 * allowed to finish rather than leaving half-written artifacts behind.
 */

const HEARTBEAT_INTERVAL_MS = 5_000;

export type WorkerRunOptions = {
  /** Log/service name, for example "render-worker". */
  name: string;
  /** Heartbeat kind, for example "render". */
  kind: string;
  health: RenderWorkerHealth;
  run: (signal: AbortSignal) => Promise<void>;
};

async function writeHeartbeat(
  workerId: string,
  kind: string,
  status: "RUNNING" | "STOPPED",
  health: RenderWorkerHealth,
): Promise<void> {
  const snapshot = health.snapshot();
  const now = new Date().toISOString();
  const startedAt = snapshot.startedAt ?? now;
  const lastTickAt = snapshot.lastTickAt ?? startedAt;
  const lastEvent = snapshot.currentJobId
    ? `job:${snapshot.currentJobId}`
    : snapshot.lastError
      ? `error:${snapshot.lastError.slice(0, 200)}`
      : null;

  const values = {
    kind,
    status,
    startedAt,
    lastTickAt,
    processed: snapshot.processed,
    succeeded: snapshot.succeeded,
    failed: snapshot.failed,
    cancelled: snapshot.cancelled,
    lastEvent,
    updatedAt: now,
  };

  await db.orm.public.WorkerHeartbeat.upsert({
    create: { workerId, ...values },
    update: values,
  });
}

function startHeartbeat(
  workerId: string,
  kind: string,
  health: RenderWorkerHealth,
): () => Promise<void> {
  const beat = () => {
    void writeHeartbeat(workerId, kind, "RUNNING", health).catch((error) => {
      logEvent("warn", "worker.heartbeat_failed", {
        worker: kind,
        error: sanitizeError(error),
      });
    });
  };
  beat();
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();

  return async () => {
    clearInterval(timer);
    try {
      await writeHeartbeat(workerId, kind, "STOPPED", health);
    } catch (error) {
      logEvent("warn", "worker.heartbeat_failed", {
        worker: kind,
        error: sanitizeError(error),
      });
    }
  };
}

export async function runWorkerProcess(options: WorkerRunOptions): Promise<void> {
  assertServerConfig(`${options.name} startup`);

  const workerId = `${options.kind}:${hostname()}:${process.pid}`;
  const controller = new AbortController();

  const shutdown = (signal: string) => {
    if (controller.signal.aborted) {
      logEvent("warn", "worker.force_exit", {
        worker: options.name,
        signal,
      });
      process.exit(130);
    }
    logEvent("info", "worker.draining", {
      worker: options.name,
      signal,
      note: "finishing the in-flight job; send the signal again to exit now",
    });
    controller.abort();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const stopHeartbeat = startHeartbeat(workerId, options.kind, options.health);

  logEvent("info", "worker.started", {
    worker: options.name,
    workerId,
    pid: process.pid,
  });

  try {
    await options.run(controller.signal);
  } finally {
    await stopHeartbeat();
  }

  const snapshot = options.health.snapshot();
  logEvent("info", "worker.stopped", {
    worker: options.name,
    workerId,
    processed: snapshot.processed,
    succeeded: snapshot.succeeded,
    failed: snapshot.failed,
    cancelled: snapshot.cancelled,
  });
}
