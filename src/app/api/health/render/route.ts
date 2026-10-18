import { NextResponse } from "next/server";
import {
  verifyFfmpegCapabilities,
  type FfmpegCapabilities,
} from "../../../../modules/video-rendering/ffmpeg/capabilities";
import { clientIdentity, enforceRateLimit, RATE_LIMITS } from "../../../../lib/rate-limit";
import { logEvent, requestIdFrom, sanitizeError } from "../../../../lib/observability";
import { readWorkerLiveness } from "../../../../infrastructure/worker-heartbeat";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cached: { at: number; capabilities: FfmpegCapabilities } | null = null;

async function capabilities(): Promise<FfmpegCapabilities> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.capabilities;
  }

  const value = await verifyFfmpegCapabilities();
  cached = { at: Date.now(), capabilities: value };
  return value;
}

/**
 * Reports whether this deployment can actually render.
 *
 * The response is sanitized for an unauthenticated endpoint: booleans about
 * FFmpeg capability and the worker's heartbeat-derived liveness, never raw
 * binary versions, paths, or error messages. Details go to the server log
 * with the request id.
 */
export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const limited = await enforceRateLimit(
    RATE_LIMITS.healthProbe,
    clientIdentity(request),
  );
  if (limited) return limited;

  const liveness = (await readWorkerLiveness()).find(
    (worker) => worker.kind === "render",
  );

  try {
    const ffmpeg = await capabilities();

    return NextResponse.json({
      ok: true,
      ffmpeg: {
        available: true,
        filtersOk: Object.values(ffmpeg.filters).every(Boolean),
      },
      worker: liveness,
    });
  } catch (error) {
    logEvent("error", "health.render_probe_failed", {
      requestId,
      error: sanitizeError(error),
    });

    return NextResponse.json(
      {
        ok: false,
        ffmpeg: { available: false, filtersOk: false },
        worker: liveness,
      },
      { status: 503 },
    );
  }
}
