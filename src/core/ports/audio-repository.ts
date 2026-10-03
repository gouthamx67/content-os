import type {
  AudioArtifactRecord,
  AudioAutomationPointRecord,
  AudioCompositionRecord,
  AudioCompositionStatus,
  AudioEasing,
  AudioOutputFormat,
  AudioRenderJobRecord,
  AudioTrackKind,
  AudioTrackRecord,
  MuxedVideoArtifactRecord,
} from "../../modules/audio-engine/domain/types";
import type { RenderJobStatus } from "../../modules/video-rendering/domain/types";

export type CreateAudioCompositionInput = {
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
};

export type CreateAudioTrackInput = {
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
};

export type UpdateAudioTrackInput = Partial<
  Omit<CreateAudioTrackInput, "id" | "audioCompositionId" | "createdAt">
> & { updatedAt: string };

export type UpsertAudioAutomationInput = {
  id: string;
  trackId: string;
  property: "VOLUME_DB";
  timeMs: number;
  value: number;
  easing: AudioEasing;
  createdAt: string;
};

export type CreateAudioRenderJobInput = {
  id: string;
  projectId: string;
  audioCompositionId: string;
  videoRenderJobId: string | null;
  requestedById: string;
  outputFormat: AudioOutputFormat;
  contractVersion: number;
  audioGraph: string;
  audioSha256: string;
  sampleRate: number;
  channels: number;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateAudioArtifactInput = {
  id: string;
  audioRenderJobId: string;
  projectId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  createdAt: string;
};

export type CreateMuxedArtifactInput = CreateAudioArtifactInput & {
  videoRenderJobId: string;
};

export type ListAudioRenderJobsFilter = {
  audioCompositionId?: string;
  status?: RenderJobStatus;
  limit?: number;
};

/**
 * Every read and write is project-scoped. A track or job id is only meaningful
 * inside a project, so cross-project access is prevented by the signature rather
 * than by a check a caller might forget.
 */
export interface AudioRepository {
  createComposition(
    input: CreateAudioCompositionInput,
  ): Promise<AudioCompositionRecord>;

  getComposition(
    projectId: string,
    audioCompositionId: string,
  ): Promise<AudioCompositionRecord | null>;

  getCompositionByVisual(
    projectId: string,
    visualCompositionId: string,
  ): Promise<AudioCompositionRecord | null>;

  updateCompositionDuration(input: {
    projectId: string;
    audioCompositionId: string;
    durationMs: number;
    updatedAt: string;
  }): Promise<void>;

  addTrack(input: CreateAudioTrackInput): Promise<AudioTrackRecord>;

  getTrack(
    projectId: string,
    audioCompositionId: string,
    trackId: string,
  ): Promise<AudioTrackRecord | null>;

  updateTrack(
    projectId: string,
    audioCompositionId: string,
    trackId: string,
    changes: UpdateAudioTrackInput,
  ): Promise<AudioTrackRecord>;

  deleteTrack(
    projectId: string,
    audioCompositionId: string,
    trackId: string,
  ): Promise<void>;

  upsertAutomationPoint(
    input: UpsertAudioAutomationInput,
  ): Promise<AudioAutomationPointRecord>;

  listAutomation(
    projectId: string,
    audioCompositionId: string,
    trackId: string,
  ): Promise<AudioAutomationPointRecord[]>;

  createRenderJob(
    input: CreateAudioRenderJobInput,
  ): Promise<AudioRenderJobRecord>;

  getRenderJob(
    projectId: string,
    audioRenderJobId: string,
  ): Promise<AudioRenderJobRecord | null>;

  listRenderJobs(
    projectId: string,
    filter?: ListAudioRenderJobsFilter,
  ): Promise<AudioRenderJobRecord[]>;

  /** Atomically claims the oldest queued job. A racing loser sees null. */
  claimNext(): Promise<AudioRenderJobRecord | null>;

  updateProgress(
    audioRenderJobId: string,
    progressPct: number,
    updatedAt: string,
  ): Promise<void>;

  markRunning(input: {
    audioRenderJobId: string;
    ffmpegVersion: string | null;
    startedAt: string;
    updatedAt: string;
  }): Promise<void>;

  markSucceeded(input: {
    audioRenderJobId: string;
    ffmpegVersion: string | null;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void>;

  markFailed(input: {
    audioRenderJobId: string;
    errorCode: string;
    errorMessage: string;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void>;

  markCancelled(input: {
    audioRenderJobId: string;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void>;

  requestCancel(projectId: string, audioRenderJobId: string): Promise<boolean>;

  findCancelRequested(): Promise<AudioRenderJobRecord[]>;

  createAudioArtifact(
    input: CreateAudioArtifactInput,
  ): Promise<AudioArtifactRecord>;

  createMuxedArtifact(
    input: CreateMuxedArtifactInput,
  ): Promise<MuxedVideoArtifactRecord>;

  getAudioArtifactByJob(
    audioRenderJobId: string,
  ): Promise<AudioArtifactRecord | null>;

  getMuxedArtifactByJob(
    audioRenderJobId: string,
  ): Promise<MuxedVideoArtifactRecord | null>;
}
