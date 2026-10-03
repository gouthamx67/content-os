import "dotenv/config";
import { createRenderWorker, renderWorkerHealth } from "../infrastructure/container";

/**
 * Standalone render worker.
 *
 * Rendering is CPU-bound, so it must not share the Next.js process: a long
 * encode would block request handling. The queue lives in Postgres, which is
 * what lets the web app enqueue and this process consume without a message
 * broker between them.
 */
async function main(): Promise<void> {
  const worker = createRenderWorker();
  const controller = new AbortController();

  const shutdown = (signal: string) => {
    if (controller.signal.aborted) return;
    console.log(`[render-worker] ${signal} received, draining`);
    controller.abort();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log("[render-worker] started");
  await worker.run(controller.signal);

  const health = renderWorkerHealth.snapshot();
  console.log(
    `[render-worker] stopped (processed=${health.processed} succeeded=${health.succeeded} failed=${health.failed} cancelled=${health.cancelled})`,
  );
}

main().catch((error: unknown) => {
  console.error("[render-worker] crashed", error);
  process.exitCode = 1;
});
