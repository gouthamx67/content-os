import { NextResponse } from "next/server";
import { getFfmpegVersion } from "../../../../modules/video-rendering/ffmpeg/capabilities";
import { clientIdentity, enforceRateLimit, RATE_LIMITS } from "../../../../lib/rate-limit";
import { logEvent, requestIdFrom, sanitizeError } from "../../../../lib/observability";
import { readWorkerLiveness } from "../../../../infrastructure/worker-heartbeat";

/**
 * Reports whether this deployment can actually mix and mux audio.
 *
 * The audio worker shares FFmpeg with the video renderer, so a missing binary
 * is the one failure that can be checked here without doing real work. The
 * response is sanitized for an unauthenticated endpoint: capability booleans
 * and heartbeat-derived liveness only.
 */
export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  const limited = await enforceRateLimit(
    RATE_LIMITS.healthProbe,
    clientIdentity(request),
  );
  if (limited) return limited;

  const liveness = (await readWorkerLiveness()).find(
    (worker) => worker.kind === "audio",
  );

  try {
    await getFfmpegVersion();

    return NextResponse.json({
      ok: true,
      ffmpeg: { available: true },
      worker: liveness,
    });
  } catch (error) {
    logEvent("error", "health.audio_probe_failed", {
      requestId,
      error: sanitizeError(error),
    });

    return NextResponse.json(
      {
        ok: false,
        ffmpeg: { available: false },
        worker: liveness,
      },
      { status: 503 },
    );
  }
}
