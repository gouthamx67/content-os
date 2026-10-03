import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getFfmpegVersion } from "../../video-rendering/ffmpeg/capabilities";
import {
  runFfmpeg,
  type FfmpegProgress,
} from "../../video-rendering/ffmpeg/ffmpeg-runner";
import { resolveAudibleTracks } from "../mixing/ducking";
import type { AudioGraph } from "../serialization/audio-graph";
import type { AudioSourceResolver } from "../assets/audio-source-resolver";
import { materializeAudioSource } from "../assets/materialize-audio-source";
import { compileAudio, type AudioCompilerAsset } from "../ffmpeg/compile-audio";

const AUDIO_RENDER_SHARE = 0.8;

export type RenderAudioInput = {
  audioRenderJobId: string;
  projectId: string;
  graph: AudioGraph;
  sources: AudioSourceResolver;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
  workDirRoot?: string;
};

export type RenderAudioResult = {
  outputPath: string;
  ffmpegVersion: string;
  dispose: () => Promise<void>;
};

/**
 * Mixes one audio graph to a PCM WAV in a private work directory.
 *
 * Only audible tracks are materialised: a muted track's bytes are never copied,
 * so muting a track also removes its source from the render's disk footprint.
 * Progress is reported on the 0–80 band so the worker can reserve the rest for
 * muxing.
 */
export async function renderAudio(
  input: RenderAudioInput,
): Promise<RenderAudioResult> {
  const workDir = await mkdtemp(
    path.join(
      input.workDirRoot ?? tmpdir(),
      `content-os-audio-${safe(input.audioRenderJobId)}-`,
    ),
  );

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await rm(workDir, { recursive: true, force: true });
  };

  try {
    const assets = new Map<string, AudioCompilerAsset>();
    const audible = resolveAudibleTracks(input.graph.composition.tracks);

    for (let index = 0; index < audible.length; index += 1) {
      const track = audible[index]!;
      const source = await input.sources.resolve(input.projectId, track.sourceRef);
      const filePath = await materializeAudioSource(source, workDir, index);
      assets.set(track.id, { path: filePath });
    }

    const compiled = compileAudio(input.graph, { assets });
    const outputPath = path.join(workDir, "output.wav");
    const ffmpegVersion = await getFfmpegVersion();

    await runFfmpeg(
      [
        ...compiled.inputArgs,
        "-filter_complex",
        compiled.filterComplex,
        ...compiled.outputArgs,
        outputPath,
      ],
      {
        totalDurationMs: input.graph.composition.durationMs,
        onProgress: (progress: FfmpegProgress) => {
          input.onProgress?.(progress.percent * AUDIO_RENDER_SHARE);
        },
        signal: input.signal,
      },
    );

    return { outputPath, ffmpegVersion, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
}
