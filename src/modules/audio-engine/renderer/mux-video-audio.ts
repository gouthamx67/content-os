import {
  runFfmpeg,
  type FfmpegProgress,
} from "../../video-rendering/ffmpeg/ffmpeg-runner";
import { ffmpegNumber } from "../../video-rendering/ffmpeg/expressions";

const MUX_BASE_PERCENT = 80;
const MUX_SHARE = 0.2;

export type MuxVideoAudioInput = {
  videoPath: string;
  audioPath: string;
  outputPath: string;
  durationMs: number;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
};

/**
 * Muxes the CP15 video master with the CP16 mix into the final MP4.
 *
 * The video is stream-copied: CP15 already encoded it, and re-encoding here
 * would both lose quality and make the final artifact's checksum depend on this
 * step. Audio is encoded once to AAC at the contract's 48 kHz stereo.
 */
export async function muxVideoAudio(
  input: MuxVideoAudioInput,
): Promise<{ outputPath: string }> {
  const durationSec = input.durationMs / 1000;

  await runFfmpeg(
    [
      "-i",
      input.videoPath,
      "-i",
      input.audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      "-t",
      ffmpegNumber(durationSec),
      input.outputPath,
    ],
    {
      totalDurationMs: input.durationMs,
      onProgress: (progress: FfmpegProgress) => {
        input.onProgress?.(
          MUX_BASE_PERCENT + progress.percent * MUX_SHARE,
        );
      },
      signal: input.signal,
    },
  );

  return { outputPath: input.outputPath };
}
