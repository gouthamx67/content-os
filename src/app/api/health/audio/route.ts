import { NextResponse } from "next/server";
import { audioWorkerHealth } from "../../../../infrastructure/container";
import { getFfmpegVersion } from "../../../../modules/video-rendering/ffmpeg/capabilities";

/**
 * Reports whether this deployment can actually mix and mux audio.
 *
 * The audio worker shares FFmpeg with the video renderer, so a missing binary
 * is the one failure that can be checked here without doing real work. Worker
 * liveness and counters answer whether a queued job is likely to move.
 */
export async function GET() {
  const health = audioWorkerHealth.snapshot();

  try {
    const version = await getFfmpegVersion();

    return NextResponse.json({
      ok: true,
      ffmpeg: { version },
      worker: {
        running: health.running,
        busy: health.currentJobId !== null,
        startedAt: health.startedAt,
        lastTickAt: health.lastTickAt,
        lastSuccessAt: health.lastSuccessAt,
        lastFailureAt: health.lastFailureAt,
        processed: health.processed,
        succeeded: health.succeeded,
        failed: health.failed,
        cancelled: health.cancelled,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Audio health check failed",
        worker: {
          running: health.running,
          busy: health.currentJobId !== null,
          processed: health.processed,
          succeeded: health.succeeded,
          failed: health.failed,
          cancelled: health.cancelled,
        },
      },
      { status: 503 },
    );
  }
}
