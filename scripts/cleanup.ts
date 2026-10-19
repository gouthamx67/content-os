import "dotenv/config";
import { db } from "../src/prisma/db";

/**
 * Operational housekeeping.
 *
 * Two tables grow without bound if nothing prunes them:
 *   - `rate_limit_event` gets one row per limited request, forever.
 *   - `worker_heartbeat` gets a row per worker process, including workers that
 *     were decommissioned months ago.
 *
 * This is deliberately dry-run by default. Deleting operational history is not
 * something a scheduler should do by surprise on its first run, so an operator
 * inspects the counts, then passes `--apply`.
 *
 * Usage:
 *   tsx scripts/cleanup.ts                 # dry run, prints what would go
 *   tsx scripts/cleanup.ts --apply         # performs the deletes
 *   tsx scripts/cleanup.ts --apply --rate-retention-hours 48 --heartbeat-retention-days 7
 */

type Options = {
  apply: boolean;
  rateRetentionHours: number;
  heartbeatRetentionDays: number;
};

function parseOptions(argv: string[]): Options {
  const options: Options = {
    apply: argv.includes("--apply"),
    rateRetentionHours: 24,
    heartbeatRetentionDays: 14,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    if (flag === "--rate-retention-hours" && next) {
      options.rateRetentionHours = Number(next);
      index += 1;
    } else if (flag === "--heartbeat-retention-days" && next) {
      options.heartbeatRetentionDays = Number(next);
      index += 1;
    }
  }

  if (!Number.isFinite(options.rateRetentionHours) || options.rateRetentionHours < 1) {
    throw new Error("--rate-retention-hours must be a number >= 1");
  }
  if (!Number.isFinite(options.heartbeatRetentionDays) || options.heartbeatRetentionDays < 1) {
    throw new Error("--heartbeat-retention-days must be a number >= 1");
  }

  return options;
}

function cutoffIso(ageMs: number): string {
  return new Date(Date.now() - ageMs).toISOString();
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const orm = db.orm.public;

  const rateCutoff = cutoffIso(options.rateRetentionHours * 60 * 60 * 1000);
  const heartbeatCutoff = cutoffIso(
    options.heartbeatRetentionDays * 24 * 60 * 60 * 1000,
  );

  const staleRateEvents = await orm.RateLimitEvent.where((row) =>
    row.createdAt.lt(rateCutoff),
  ).all();
  const staleHeartbeats = await orm.WorkerHeartbeat.where((row) =>
    row.lastTickAt.lt(heartbeatCutoff),
  ).all();

  console.log(
    `cleanup: rate_limit_event older than ${rateCutoff}: ${staleRateEvents.length} row(s)`,
  );
  console.log(
    `cleanup: worker_heartbeat last seen before ${heartbeatCutoff}: ${staleHeartbeats.length} row(s)`,
  );

  if (!options.apply) {
    console.log("cleanup: dry run only; pass --apply to delete");
    return;
  }

  if (staleRateEvents.length > 0) {
    await orm.RateLimitEvent.where((row) => row.createdAt.lt(rateCutoff)).delete();
  }
  if (staleHeartbeats.length > 0) {
    await orm.WorkerHeartbeat.where((row) => row.lastTickAt.lt(heartbeatCutoff)).delete();
  }

  console.log(
    `cleanup: deleted ${staleRateEvents.length} rate-limit row(s) and ${staleHeartbeats.length} heartbeat row(s)`,
  );
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    console.error(
      "cleanup: failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  });
