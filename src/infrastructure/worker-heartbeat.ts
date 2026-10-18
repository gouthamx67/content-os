import { db } from "../prisma/db";
import { pgTimestampToIso } from "../lib/time";

/**
 * Reads worker liveness for /api/health.
 *
 * The web process cannot see worker memory, so the heartbeat table is the only
 * honest source. A worker is ACTIVE only while it is both RUNNING and its last
 * tick is recent; a RUNNING row that went quiet is STALE (crash/suspend), and
 * anything else is OFFLINE. Stale rows are cleaned by the cleanup script, so
 * "no row" honestly means "nothing is running".
 */

export type WorkerLivenessStatus = "ACTIVE" | "STALE" | "OFFLINE";

export const WORKER_KINDS = [
  "render",
  "audio",
  "image",
  "writing",
  "adaptation",
  "publishing",
] as const;

export type WorkerKind = (typeof WORKER_KINDS)[number];

export type WorkerLiveness = {
  kind: string;
  status: WorkerLivenessStatus;
  lastTickAt: string | null;
  lastEvent: string | null;
  processed: number;
  succeeded: number;
  failed: number;
  cancelled: number;
};

const STALE_AFTER_MS = 15_000;

export async function readWorkerLiveness(): Promise<WorkerLiveness[]> {
  const rows = await db.orm.public.WorkerHeartbeat.all();
  const now = Date.now();

  return WORKER_KINDS.map((kind) => {
    const forKind = rows.filter((row) => row.kind === kind);
    if (forKind.length === 0) {
      return emptyLiveness(kind);
    }

    const freshest = forKind.reduce((best, row) =>
      pgTimestampToIso(row.lastTickAt) > pgTimestampToIso(best.lastTickAt)
        ? row
        : best,
    );
    const lastTickAt = pgTimestampToIso(freshest.lastTickAt);
    const fresh = now - new Date(lastTickAt).getTime() < STALE_AFTER_MS;
    const runningRows = forKind.filter((row) => row.status === "RUNNING");

    let status: WorkerLivenessStatus;
    if (runningRows.length > 0 && fresh) status = "ACTIVE";
    else if (runningRows.length > 0) status = "STALE";
    else status = "OFFLINE";

    return {
      kind,
      status,
      lastTickAt,
      lastEvent: freshest.lastEvent ?? null,
      processed: freshest.processed,
      succeeded: freshest.succeeded,
      failed: freshest.failed,
      cancelled: freshest.cancelled,
    };
  });
}

function emptyLiveness(kind: string): WorkerLiveness {
  return {
    kind,
    status: "OFFLINE",
    lastTickAt: null,
    lastEvent: null,
    processed: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
}
