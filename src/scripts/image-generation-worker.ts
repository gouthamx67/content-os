import "dotenv/config";
import {
  createImageWorker,
  imageWorkerHealth,
} from "../infrastructure/container";

/**
 * Standalone CP17 image generation worker.
 *
 * Rasterization is CPU-bound, so it runs beside the Next.js process rather than
 * inside it. The queue lives in Postgres, which is what lets the web app enqueue
 * and this process consume without a message broker between them.
 */
async function main(): Promise<void> {
  const worker = createImageWorker();
  const controller = new AbortController();

  const shutdown = (signal: string) => {
    if (controller.signal.aborted) return;
    console.log(`[image-worker] ${signal} received, draining`);
    controller.abort();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log("[image-worker] started");
  await worker.run(controller.signal);

  const health = imageWorkerHealth.snapshot();
  console.log(
    `[image-worker] stopped (processed=${health.processed} succeeded=${health.succeeded} failed=${health.failed} cancelled=${health.cancelled})`,
  );
}

main().catch((error: unknown) => {
  console.error("[image-worker] crashed", error);
  process.exitCode = 1;
});
