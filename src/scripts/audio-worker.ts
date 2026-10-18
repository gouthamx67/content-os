import "dotenv/config";
import { createAudioWorker, audioWorkerHealth } from "../infrastructure/container";
import { logEvent, sanitizeError } from "../lib/observability";
import { runWorkerProcess } from "../infrastructure/worker-runtime";

/**
 * Standalone CP16 audio worker.
 *
 * Mixing and muxing are CPU-bound, so they run beside the Next.js process
 * rather than inside it. The queue lives in Postgres, which is what lets the web
 * app enqueue and this process consume without a message broker between them.
 */
runWorkerProcess({
  name: "audio-worker",
  kind: "audio",
  health: audioWorkerHealth,
  run: (signal) => createAudioWorker().run(signal),
}).catch((error: unknown) => {
  logEvent("error", "worker.crashed", {
    worker: "audio-worker",
    error: sanitizeError(error),
  });
  process.exitCode = 1;
});
