import "dotenv/config";
import {
  createRenderWorker,
  renderWorkerHealth,
} from "../infrastructure/container";
import { logEvent, sanitizeError } from "../lib/observability";
import { runWorkerProcess } from "../infrastructure/worker-runtime";

/**
 * Standalone render worker.
 *
 * Rendering is CPU-bound, so it must not share the Next.js process: a long
 * encode would block request handling. The queue lives in Postgres, which is
 * what lets the web app enqueue and this process consume without a message
 * broker between them.
 */
runWorkerProcess({
  name: "render-worker",
  kind: "render",
  health: renderWorkerHealth,
  run: (signal) => createRenderWorker().run(signal),
}).catch((error: unknown) => {
  logEvent("error", "worker.crashed", {
    worker: "render-worker",
    error: sanitizeError(error),
  });
  process.exitCode = 1;
});
