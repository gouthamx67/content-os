import "dotenv/config";
import {
  createAdaptationWorker,
  adaptationWorkerHealth,
} from "../infrastructure/container";
import { logEvent, sanitizeError } from "../lib/observability";
import { runWorkerProcess } from "../infrastructure/worker-runtime";

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
runWorkerProcess({
  name: "multiformat-worker",
  kind: "adaptation",
  health: adaptationWorkerHealth,
  run: (signal) => createAdaptationWorker().run(signal),
}).catch((error: unknown) => {
  logEvent("error", "worker.crashed", {
    worker: "multiformat-worker",
    error: sanitizeError(error),
  });
  process.exitCode = 1;
});
