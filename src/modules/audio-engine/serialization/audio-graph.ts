import type {
  AudioCompositionRecord,
  AudioTrackKind,
  AudioAutomationProperty,
  AudioEasing,
} from "../domain/types";
import { sortAutomation } from "../domain/validation";

export const AUDIO_GRAPH_CONTRACT_VERSION = 1 as const;

export type AudioGraphAutomationPoint = {
  property: AudioAutomationProperty;
  timeMs: number;
  value: number;
  easing: AudioEasing;
};

export type AudioGraphTrack = {
  id: string;
  kind: AudioTrackKind;
  name: string;
  sourceRef: string;
  startMs: number;
  sourceOffsetMs: number;
  durationMs: number;
  gainDb: number;
  pan: number;
  fadeInMs: number;
  fadeOutMs: number;
  mute: boolean;
  solo: boolean;
  duckVoiceoverDb: number | null;
  automation: AudioGraphAutomationPoint[];
};

/**
 * The exact audio timeline a render job will mix.
 *
 * It is a snapshot taken at enqueue time. The worker renders this document and
 * never rereads the mutable track rows, so editing a track after enqueue cannot
 * change what a queued job produces. Tracks are ordered by `startMs` so two
 * snapshots of the same timeline serialise identically.
 */
export type AudioGraph = {
  contractVersion: typeof AUDIO_GRAPH_CONTRACT_VERSION;
  projectId: string;
  composition: {
    id: string;
    sampleRate: number;
    channels: number;
    durationMs: number;
    tracks: AudioGraphTrack[];
  };
};

export function buildAudioGraph(
  composition: AudioCompositionRecord,
): AudioGraph {
  const tracks = composition.tracks
    .slice()
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))
    .map<AudioGraphTrack>((track) => ({
      id: track.id,
      kind: track.kind,
      name: track.name,
      sourceRef: track.sourceRef,
      startMs: track.startMs,
      sourceOffsetMs: track.sourceOffsetMs,
      durationMs: track.durationMs,
      gainDb: track.gainDb,
      pan: track.pan,
      fadeInMs: track.fadeInMs,
      fadeOutMs: track.fadeOutMs,
      mute: track.mute,
      solo: track.solo,
      duckVoiceoverDb: track.duckVoiceoverDb ?? null,
      automation: sortAutomation(track.automation).map((point) => ({
        property: point.property,
        timeMs: point.timeMs,
        value: point.value,
        easing: point.easing,
      })),
    }));

  return {
    contractVersion: AUDIO_GRAPH_CONTRACT_VERSION,
    projectId: composition.projectId,
    composition: {
      id: composition.id,
      sampleRate: composition.sampleRate,
      channels: composition.channels,
      durationMs: composition.durationMs,
      tracks,
    },
  };
}
