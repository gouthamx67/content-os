import { NextResponse } from "next/server";
import { db } from "../../../prisma/db";
import { describeFeatureCapabilities } from "../../../lib/server-config";
import { clientIdentity, enforceRateLimit, RATE_LIMITS } from "../../../lib/rate-limit";
import { logEvent, requestIdFrom, sanitizeError } from "../../../lib/observability";
import { readWorkerLiveness } from "../../../infrastructure/worker-heartbeat";

/**
 * Liveness and readiness for the web process, plus honest capability status.
 *
 * - `ok` is true only when the readiness probe (a real database query)
 *   succeeds; a web process that cannot reach its database reports 503.
 * - `workers` is read from the worker_heartbeat table because workers run in
 *   separate OS processes; an OFFLINE worker is reported as such rather than
 *   guessed at.
 * - `capabilities` reflects configuration only (never a probe), so an
 *   unconfigured publishing provider reads as unavailable instead of failing.
 */
export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const limited = await enforceRateLimit(
    RATE_LIMITS.healthProbe,
    clientIdentity(request),
  );
  if (limited) return limited;

  let databaseReady = true;
  try {
    const plan = db.raw.sql`SELECT 1 AS ok`
      .returnsRow({ ok: "pg/int4@1" })
      .build();
    await db.runtime().query(plan);
  } catch (error) {
    databaseReady = false;
    logEvent("error", "health.readiness_failed", {
      requestId,
      error: sanitizeError(error),
    });
  }

  const workers = databaseReady ? await readWorkerLiveness() : [];
  const capabilities = describeFeatureCapabilities();

  return NextResponse.json(
    {
      ok: databaseReady,
      service: "content-os",
      timestamp: new Date().toISOString(),
      database: databaseReady ? "ok" : "unreachable",
      workers,
      capabilities,
    },
    { status: databaseReady ? 200 : 503 },
  );
}
