import "dotenv/config";
import {
  createAdaptationWorker,
  adaptationWorkerHealth,
} from "../infrastructure/container";

/**
 * Standalone CP19 multi-format adaptation worker.
 *
 * Sharp is CPU-bound, so adaptation runs beside the Next.js process rather than
 * inside it. The queue lives in Postgres, which is what lets the web app freeze a
 * batch and this process produce it without a message broker between them.
 *
 * Video variants are parked on CP15 rather than encoded here: this worker hands
 * CP15 a re-framed scene and reconciles the render when it lands.
 */
async function main(): Promise<void> {
  const worker = createAdaptationWorker();
  const controller = new AbortController();

  const shutdown = (signal: string) => {
    if (controller.signal.aborted) return;
    console.log(`[multiformat-worker] ${signal} received, draining`);
    controller.abort();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log("[multiformat-worker] started");
  await worker.run(controller.signal);

  const health = adaptationWorkerHealth.snapshot();
  console.log(
    `[multiformat-worker] stopped (processed=${health.processed} succeeded=${health.succeeded} failed=${health.failed} cancelled=${health.cancelled})`,
  );
}

main().catch((error: unknown) => {
  console.error("[multiformat-worker] crashed", error);
  process.exitCode = 1;
});
