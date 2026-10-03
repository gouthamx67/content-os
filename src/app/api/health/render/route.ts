import { NextResponse } from "next/server";
import {
  getFfprobeVersion,
  verifyFfmpegCapabilities,
  type FfmpegCapabilities,
} from "../../../../modules/video-rendering/ffmpeg/capabilities";
import { renderWorkerHealth } from "../../../../infrastructure/container";

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
 * Existence of the worker process is not enough: it can be alive while FFmpeg
 * is missing a filter the compiler emits. This endpoint answers both, so a
 * failing render can be triaged before it is enqueued.
 */
export async function GET() {
  const health = renderWorkerHealth.snapshot();

  try {
    const [ffmpeg, ffprobe] = await Promise.all([
      capabilities(),
      getFfprobeVersion(),
    ]);

    return NextResponse.json({
      ok: true,
      ffmpeg: { version: ffmpeg.version, filters: ffmpeg.filters },
      ffprobe: { version: ffprobe },
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
        error: error instanceof Error ? error.message : "Render health check failed",
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
