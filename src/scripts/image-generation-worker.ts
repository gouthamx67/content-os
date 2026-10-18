import "dotenv/config";
import {
  createImageWorker,
  imageWorkerHealth,
} from "../infrastructure/container";
import { logEvent, sanitizeError } from "../lib/observability";
import { runWorkerProcess } from "../infrastructure/worker-runtime";

/**
 * Standalone CP17 image generation worker.
 *
 * Rasterization is CPU-bound, so it runs beside the Next.js process rather than
 * inside it. The queue lives in Postgres, which is what lets the web app enqueue
 * and this process consume without a message broker between them.
 */
runWorkerProcess({
  name: "image-worker",
  kind: "image",
  health: imageWorkerHealth,
  run: (signal) => createImageWorker().run(signal),
}).catch((error: unknown) => {
  logEvent("error", "worker.crashed", {
    worker: "image-worker",
    error: sanitizeError(error),
  });
  process.exitCode = 1;
});
