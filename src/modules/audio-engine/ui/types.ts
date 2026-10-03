export type AudioKind = "VOICEOVER" | "MUSIC" | "SFX" | "AMBIENCE";

export type AudioAutomationView = {
  id: string;
  trackId: string;
  property: string;
  timeMs: number;
  value: number;
  easing: string;
};

export type AudioTrackView = {
  id: string;
  audioCompositionId: string;
  kind: AudioKind;
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
  automation: AudioAutomationView[];
};

export type AudioCompositionView = {
  id: string;
  projectId: string;
  compositionId: string;
  name: string;
  sampleRate: number;
  channels: number;
  durationMs: number;
  status: string;
  tracks: AudioTrackView[];
};

export type AudioRenderJobView = {
  id: string;
  audioCompositionId: string;
  videoRenderJobId: string | null;
  status: string;
  outputFormat: "WAV" | "MP4";
  progressPct: number;
  errorCode: string | null;
  errorMessage: string | null;
};

export type AudioArtifactView = {
  id: string;
  mimeType: string;
  byteSize: number;
  streamUrl: string;
};

export type MuxedArtifactView = {
  id: string;
  videoRenderJobId: string;
  mimeType: string;
  byteSize: number;
  streamUrl: string;
};
