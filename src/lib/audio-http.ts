import { NextResponse } from "next/server";
import { HttpError } from "./http";
import { AudioError } from "../modules/audio-engine/errors";
import { VisualValidationError } from "../modules/visual-motion-engine/domain/validation";
import type {
  AudioArtifactRecord,
  AudioAutomationPointRecord,
  AudioCompositionRecord,
  AudioRenderJobRecord,
  AudioTrackRecord,
  MuxedVideoArtifactRecord,
} from "../modules/audio-engine/domain/types";

/**
 * One error shape for every audio route.
 *
 * An audio failure is either the caller's (a bad track, a source from another
 * project) or the renderer's. The status carried by the error is reused so a
 * fixable message reaches the client, and the code lets a client branch without
 * matching on English.
 */
export function audioErrorResponse(error: unknown): NextResponse {
  if (error instanceof AudioError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof VisualValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}

export function audioAutomationView(point: AudioAutomationPointRecord) {
  return {
    id: point.id,
    trackId: point.trackId,
    property: point.property,
    timeMs: point.timeMs,
    value: point.value,
    easing: point.easing,
    createdAt: point.createdAt,
  };
}

export function audioTrackView(track: AudioTrackRecord) {
  return {
    id: track.id,
    audioCompositionId: track.audioCompositionId,
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
    duckVoiceoverDb: track.duckVoiceoverDb,
    createdAt: track.createdAt,
    updatedAt: track.updatedAt,
    automation: track.automation.map(audioAutomationView),
  };
}

export function audioCompositionView(composition: AudioCompositionRecord) {
  return {
    id: composition.id,
    projectId: composition.projectId,
    compositionId: composition.compositionId,
    name: composition.name,
    sampleRate: composition.sampleRate,
    channels: composition.channels,
    durationMs: composition.durationMs,
    status: composition.status,
    createdAt: composition.createdAt,
    updatedAt: composition.updatedAt,
    tracks: composition.tracks.map(audioTrackView),
  };
}

/**
 * The wire shape of an audio render job.
 *
 * The frozen `audioGraph`, storage keys and FFmpeg arguments are deliberately
 * absent: the graph is an internal reproduction document and the storage layout
 * is not the client's business. The client gets ids, status and stream URLs.
 */
export function audioRenderJobView(job: AudioRenderJobRecord) {
  return {
    id: job.id,
    projectId: job.projectId,
    audioCompositionId: job.audioCompositionId,
    videoRenderJobId: job.videoRenderJobId,
    status: job.status,
    outputFormat: job.outputFormat,
    progressPct: job.progressPct,
    contractVersion: job.contractVersion,
    audioSha256: job.audioSha256,
    sampleRate: job.sampleRate,
    channels: job.channels,
    durationMs: job.durationMs,
    ffmpegVersion: job.ffmpegVersion,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
  };
}

export function audioArtifactView(artifact: AudioArtifactRecord) {
  return {
    id: artifact.id,
    audioRenderJobId: artifact.audioRenderJobId,
    mimeType: artifact.mimeType,
    byteSize: artifact.byteSize,
    checksumSha256: artifact.checksumSha256,
    createdAt: artifact.createdAt,
    streamUrl: `/api/projects/${artifact.projectId}/audio/renders/${artifact.audioRenderJobId}/stream`,
  };
}

export function muxedArtifactView(artifact: MuxedVideoArtifactRecord) {
  return {
    id: artifact.id,
    audioRenderJobId: artifact.audioRenderJobId,
    videoRenderJobId: artifact.videoRenderJobId,
    mimeType: artifact.mimeType,
    byteSize: artifact.byteSize,
    checksumSha256: artifact.checksumSha256,
    createdAt: artifact.createdAt,
    streamUrl: `/api/projects/${artifact.projectId}/audio/renders/${artifact.audioRenderJobId}/video`,
  };
}
