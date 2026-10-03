import type { AudioGraph, AudioGraphTrack } from "../serialization/audio-graph";
import {
  buildVoiceoverDuckIntervals,
  resolveAudibleTracks,
} from "../mixing/ducking";
import { AudioFeatureError } from "../errors";
import { ffmpegNumber } from "../../video-rendering/ffmpeg/expressions";
import {
  automationDbExpression,
  duckDbExpression,
  linearVolumeExpression,
  panGains,
} from "./audio-expressions";

export type AudioCompilerAsset = {
  path: string;
};

export type CompileAudioOptions = {
  assets: Map<string, AudioCompilerAsset>;
};

export type CompiledAudio = {
  inputArgs: string[];
  filterComplex: string;
  outputLabel: string;
  outputArgs: string[];
  outputDurationSec: number;
};

/**
 * Compiles an audio graph into one FFmpeg invocation.
 *
 * A silent bed of exactly the composition's length is mixed with every audible
 * track, so the output is always the right duration even if every track ends
 * early. Gain is compiled to an expression over `t` rather than evaluated in
 * JavaScript: automation and ducking happen inside the encoder at the same time
 * as the decode, and the result is deterministic for a given graph.
 */
export function compileAudio(
  graph: AudioGraph,
  options: CompileAudioOptions,
): CompiledAudio {
  const { sampleRate, channels, durationMs } = graph.composition;
  const durationSec = durationMs / 1000;

  const audible = resolveAudibleTracks(graph.composition.tracks);
  const duckIntervals = buildVoiceoverDuckIntervals(audible);

  const inputArgs: string[] = [
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=${sampleRate}:cl=stereo`,
  ];

  const filters: string[] = [
    `[0:a]aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=stereo,` +
      `apad=whole_dur=${ffmpegNumber(durationSec)},` +
      `atrim=duration=${ffmpegNumber(durationSec)},` +
      `asetpts=PTS-STARTPTS[abase]`,
  ];

  const mixLabels = ["[abase]"];
  let inputIndex = 1;

  for (const track of audible) {
    const asset = options.assets.get(track.id);
    if (!asset) {
      throw new AudioFeatureError(
        "AUDIO_SOURCE_NOT_FOUND",
        `Track "${track.name}" has no resolved source`,
      );
    }

    inputArgs.push("-i", asset.path);

    const steps = trackFilters(track, graph, duckIntervals);
    const label = `a${inputIndex}`;
    filters.push(`[${inputIndex}:a]${steps.join(",")}[${label}]`);
    mixLabels.push(`[${label}]`);
    inputIndex += 1;
  }

  if (mixLabels.length > 1) {
    filters.push(
      `${mixLabels.join("")}amix=inputs=${mixLabels.length}:normalize=0:dropout_transition=0:duration=longest[amix]`,
    );
    filters.push(
      `[amix]atrim=duration=${ffmpegNumber(durationSec)},asetpts=PTS-STARTPTS[aout]`,
    );
  } else {
    filters.push(`[abase]anull[aout]`);
  }

  return {
    inputArgs,
    filterComplex: filters.join(";"),
    outputLabel: "aout",
    outputArgs: [
      "-map",
      "[aout]",
      "-c:a",
      "pcm_s16le",
      "-ar",
      String(sampleRate),
      "-ac",
      String(channels),
      "-t",
      ffmpegNumber(durationSec),
    ],
    outputDurationSec: durationSec,
  };
}

function trackFilters(
  track: AudioGraphTrack,
  graph: AudioGraph,
  duckIntervals: ReturnType<typeof buildVoiceoverDuckIntervals>,
): string[] {
  const { sampleRate } = graph.composition;
  const steps: string[] = [
    `aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=stereo`,
    `atrim=start=${ffmpegNumber(track.sourceOffsetMs / 1000)}:duration=${ffmpegNumber(
      track.durationMs / 1000,
    )}`,
    "asetpts=PTS-STARTPTS",
  ];

  if (track.fadeInMs > 0) {
    steps.push(
      `afade=t=in:st=0:d=${ffmpegNumber(track.fadeInMs / 1000)}`,
    );
  }

  if (track.fadeOutMs > 0) {
    const startSec = Math.max(0, track.durationMs - track.fadeOutMs) / 1000;
    steps.push(
      `afade=t=out:st=${ffmpegNumber(startSec)}:d=${ffmpegNumber(track.fadeOutMs / 1000)}`,
    );
  }

  const { left, right } = panGains(track.pan);
  if (left !== 1 || right !== 1) {
    steps.push(
      `pan=stereo|c0=c0*${ffmpegNumber(left)}|c1=c1*${ffmpegNumber(right)}`,
    );
  }

  const gain = automationDbExpression(track.automation, track.gainDb);
  const duck = duckDbExpression(
    duckIntervals,
    track.duckVoiceoverDb ?? 0,
    track.startMs,
  );
  const volume = linearVolumeExpression(gain, duck);

  if (volume.constant) {
    steps.push(`volume=${volume.expression}`);
  } else {
    steps.push(`volume='${volume.expression}':eval=frame`);
  }

  if (track.startMs > 0) {
    steps.push(`adelay=${Math.round(track.startMs)}:all=1`);
  }

  return steps;
}
