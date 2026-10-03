import type { RenderJobStatus } from "../../video-rendering/domain/types";

/**
 * CP16 audio engine domain.
 *
 * These records are what the repository decodes rows into and what the services
 * return. They are independent of the persistence shape: a track is a source
 * reference plus timing, level and automation, not a row of columns, so the
 * compiler can turn a composition into an FFmpeg graph without touching
 * Postgres.
 */

export const AUDIO_COMPOSITION_STATUSES = [
  "DRAFT",
  "READY",
  "ARCHIVED",
] as const;
export type AudioCompositionStatus =
  (typeof AUDIO_COMPOSITION_STATUSES)[number];

export const AUDIO_TRACK_KINDS = [
  "VOICEOVER",
  "MUSIC",
  "SFX",
  "AMBIENCE",
] as const;
export type AudioTrackKind = (typeof AUDIO_TRACK_KINDS)[number];

export const AUDIO_AUTOMATION_PROPERTIES = ["VOLUME_DB"] as const;
export type AudioAutomationProperty =
  (typeof AUDIO_AUTOMATION_PROPERTIES)[number];

export const AUDIO_EASINGS = [
  "LINEAR",
  "EASE_IN",
  "EASE_OUT",
  "EASE_IN_OUT",
] as const;
export type AudioEasing = (typeof AUDIO_EASINGS)[number];

export const AUDIO_OUTPUT_FORMATS = ["WAV", "MP4"] as const;
export type AudioOutputFormat = (typeof AUDIO_OUTPUT_FORMATS)[number];

export type AudioAutomationPointRecord = {
  id: string;
  trackId: string;
  property: AudioAutomationProperty;
  timeMs: number;
  value: number;
  easing: AudioEasing;
  createdAt: string;
};

export type AudioTrackRecord = {
  id: string;
  audioCompositionId: string;
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
  createdAt: string;
  updatedAt: string;
  automation: AudioAutomationPointRecord[];
};

export type AudioCompositionRecord = {
  id: string;
  projectId: string;
  compositionId: string;
  name: string;
  sampleRate: number;
  channels: number;
  durationMs: number;
  status: AudioCompositionStatus;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  tracks: AudioTrackRecord[];
};

export type AudioRenderJobRecord = {
  id: string;
  projectId: string;
  audioCompositionId: string;
  videoRenderJobId: string | null;
  requestedById: string;
  status: RenderJobStatus;
  outputFormat: AudioOutputFormat;
  contractVersion: number;
  audioGraph: string;
  audioSha256: string;
  progressPct: number;
  sampleRate: number;
  channels: number;
  durationMs: number;
  ffmpegVersion: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type AudioArtifactRecord = {
  id: string;
  audioRenderJobId: string;
  projectId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  createdAt: string;
};

export type MuxedVideoArtifactRecord = {
  id: string;
  audioRenderJobId: string;
  projectId: string;
  videoRenderJobId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  createdAt: string;
};

export function isAudioTrackKind(value: unknown): value is AudioTrackKind {
  return (
    typeof value === "string" &&
    (AUDIO_TRACK_KINDS as readonly string[]).includes(value)
  );
}

export function isAudioEasing(value: unknown): value is AudioEasing {
  return (
    typeof value === "string" &&
    (AUDIO_EASINGS as readonly string[]).includes(value)
  );
}
