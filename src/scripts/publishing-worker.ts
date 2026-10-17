import "dotenv/config";
import {
  createPublishingWorker,
  publishingWorkerHealth,
} from "../infrastructure/container";

/**
 * Standalone CP23 publishing worker.
 *
 * Due schedules, ambiguous outcomes and analytics refreshes all live in
 * Postgres, so the web app enqueues and this process consumes without a broker.
 * The worker tolerates an unconfigured provider registry: it then reports
 * provider-unavailable states honestly rather than pretending to publish.
 */
async function main(): Promise<void> {
  const worker = createPublishingWorker();
  const controller = new AbortController();

  const shutdown = (signal: string) => {
    if (controller.signal.aborted) return;
    console.log(`[publishing-worker] ${signal} received, draining`);
    controller.abort();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log("[publishing-worker] started");
  await worker.run(controller.signal);

  const health = publishingWorkerHealth.snapshot();
  console.log(
    `[publishing-worker] stopped (processed=${health.processed} succeeded=${health.succeeded} failed=${health.failed})`,
  );
}

main().catch((error: unknown) => {
  console.error("[publishing-worker] crashed", error);
  process.exitCode = 1;
});
