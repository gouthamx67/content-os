import "dotenv/config";
import {
  createWritingWorker,
  writingWorkerHealth,
} from "../infrastructure/container";

/**
 * Standalone CP18 writing generation worker.
 *
 * The queue lives in Postgres, which is what lets the web app enqueue and this
 * process consume without a message broker between them. Copy is generated from
 * each job's frozen context, so a project edit during a run cannot change what
 * the job writes.
 */
async function main(): Promise<void> {
  const worker = createWritingWorker();
  const controller = new AbortController();

  const shutdown = (signal: string) => {
    if (controller.signal.aborted) return;
    console.log(`[writing-worker] ${signal} received, draining`);
    controller.abort();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log("[writing-worker] started");
  await worker.run(controller.signal);

  const health = writingWorkerHealth.snapshot();
  console.log(
    `[writing-worker] stopped (processed=${health.processed} succeeded=${health.succeeded} failed=${health.failed} cancelled=${health.cancelled})`,
  );
}

main().catch((error: unknown) => {
  console.error("[writing-worker] crashed", error);
  process.exitCode = 1;
});
