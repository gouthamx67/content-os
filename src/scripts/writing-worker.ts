import "dotenv/config";
import {
  createWritingWorker,
  writingWorkerHealth,
} from "../infrastructure/container";
import { logEvent, sanitizeError } from "../lib/observability";
import { runWorkerProcess } from "../infrastructure/worker-runtime";

/**
 * Standalone CP18 writing generation worker.
 *
 * The queue lives in Postgres, which is what lets the web app enqueue and this
 * process consume without a message broker between them. Copy is generated from
 * each job's frozen context, so a project edit during a run cannot change what
 * the job writes.
 */
runWorkerProcess({
  name: "writing-worker",
  kind: "writing",
  health: writingWorkerHealth,
  run: (signal) => createWritingWorker().run(signal),
}).catch((error: unknown) => {
  logEvent("error", "worker.crashed", {
    worker: "writing-worker",
    error: sanitizeError(error),
  });
  process.exitCode = 1;
});
