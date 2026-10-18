import "dotenv/config";
import {
  createPublishingWorker,
  publishingWorkerHealth,
} from "../infrastructure/container";
import { logEvent, sanitizeError } from "../lib/observability";
import { runWorkerProcess } from "../infrastructure/worker-runtime";

/**
 * Standalone CP23 publishing worker.
 *
 * Due schedules, ambiguous outcomes and analytics refreshes all live in
 * Postgres, so the web app enqueues and this process consumes without a broker.
 * The worker tolerates an unconfigured provider registry: it then reports
 * provider-unavailable states honestly rather than pretending to publish.
 */
runWorkerProcess({
  name: "publishing-worker",
  kind: "publishing",
  health: publishingWorkerHealth,
  run: (signal) => createPublishingWorker().run(signal),
}).catch((error: unknown) => {
  logEvent("error", "worker.crashed", {
    worker: "publishing-worker",
    error: sanitizeError(error),
  });
  process.exitCode = 1;
});
