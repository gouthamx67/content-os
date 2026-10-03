import { createId } from "../../../lib/id";
import { HttpError } from "../../../lib/http";
import type { AudioRepository } from "../../../core/ports/audio-repository";
import type { RenderJobStatus } from "../../video-rendering/domain/types";
import type {
  AudioArtifactRecord,
  AudioRenderJobRecord,
  MuxedVideoArtifactRecord,
} from "../domain/types";
import { AudioError } from "../errors";
import {
  validateAudioComposition,
  validateAudioTrackInput,
} from "../domain/validation";
import {
  AUDIO_GRAPH_CONTRACT_VERSION,
  buildAudioGraph,
} from "../serialization/audio-graph";
import { hashAudioGraph } from "../serialization/hash-audio-graph";
import { stableStringify } from "../../video-rendering/serialization/stable-json";

export type VideoRenderSummary = {
  id: string;
  projectId: string;
  status: RenderJobStatus;
};

export type AudioRenderJobServiceDeps = {
  repository: AudioRepository;
  authorizeProject: (projectId: string, userId: string) => Promise<void>;
  /** Unscoped read used only to tell "not found" apart from "another project". */
  videoRenderFor: (videoRenderJobId: string) => Promise<VideoRenderSummary | null>;
};

export type EnqueueAudioRenderArgs = {
  projectId: string;
  audioCompositionId: string;
  userId: string;
  videoRenderJobId?: string | null;
};

/**
 * Enqueues an audio render and answers questions about existing audio jobs.
 *
 * Enqueueing freezes the graph. The job keeps both the document and its hash, so
 * a render can be reproduced and audited, and editing a track while a job is
 * queued cannot change its output.
 */
export class AudioRenderJobService {
  constructor(private readonly deps: AudioRenderJobServiceDeps) {}

  async enqueue(args: EnqueueAudioRenderArgs): Promise<AudioRenderJobRecord> {
    await this.deps.authorizeProject(args.projectId, args.userId);

    const composition = await this.deps.repository.getComposition(
      args.projectId,
      args.audioCompositionId,
    );

    if (!composition) {
      throw new HttpError(404, "Audio composition not found");
    }

    let outputFormat: "WAV" | "MP4" = "WAV";

    if (args.videoRenderJobId) {
      const video = await this.deps.videoRenderFor(args.videoRenderJobId);

      if (!video) {
        throw new AudioError(
          "VIDEO_RENDER_NOT_FOUND",
          "Video render job not found",
          404,
        );
      }

      if (video.projectId !== args.projectId) {
        throw new AudioError(
          "VIDEO_RENDER_PROJECT_MISMATCH",
          "Video render job belongs to another project",
          400,
        );
      }

      if (video.status !== "SUCCEEDED") {
        throw new AudioError(
          "VIDEO_ARTIFACT_NOT_READY",
          "Video render has not finished successfully",
          409,
        );
      }

      outputFormat = "MP4";
    }

    validateAudioComposition(composition.tracks, composition.durationMs);

    for (const track of composition.tracks) {
      validateAudioTrackInput({
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
        compositionDurationMs: composition.durationMs,
      });
    }

    const graph = buildAudioGraph(composition);
    const now = new Date().toISOString();

    return this.deps.repository.createRenderJob({
      id: createId("ajob"),
      projectId: args.projectId,
      audioCompositionId: composition.id,
      videoRenderJobId: args.videoRenderJobId ?? null,
      requestedById: args.userId,
      outputFormat,
      contractVersion: AUDIO_GRAPH_CONTRACT_VERSION,
      audioGraph: stableStringify(graph),
      audioSha256: hashAudioGraph(graph),
      sampleRate: composition.sampleRate,
      channels: composition.channels,
      durationMs: composition.durationMs,
      createdAt: now,
      updatedAt: now,
    });
  }

  async get(args: {
    projectId: string;
    audioRenderJobId: string;
    userId: string;
  }): Promise<AudioRenderJobRecord> {
    await this.deps.authorizeProject(args.projectId, args.userId);

    const job = await this.deps.repository.getRenderJob(
      args.projectId,
      args.audioRenderJobId,
    );

    if (!job) {
      throw new HttpError(404, "Audio render job not found");
    }

    return job;
  }

  async list(args: {
    projectId: string;
    userId: string;
    audioCompositionId?: string;
    status?: RenderJobStatus;
    limit?: number;
  }): Promise<AudioRenderJobRecord[]> {
    await this.deps.authorizeProject(args.projectId, args.userId);

    return this.deps.repository.listRenderJobs(args.projectId, {
      audioCompositionId: args.audioCompositionId,
      status: args.status,
      limit: args.limit,
    });
  }

  async cancel(args: {
    projectId: string;
    audioRenderJobId: string;
    userId: string;
  }): Promise<AudioRenderJobRecord> {
    const existing = await this.get(args);

    const accepted = await this.deps.repository.requestCancel(
      args.projectId,
      args.audioRenderJobId,
    );

    if (!accepted) {
      return this.get(args);
    }

    const updated = await this.deps.repository.getRenderJob(
      args.projectId,
      args.audioRenderJobId,
    );

    return updated ?? existing;
  }

  async audioArtifact(args: {
    projectId: string;
    audioRenderJobId: string;
    userId: string;
  }): Promise<AudioArtifactRecord | null> {
    await this.get(args);
    return this.deps.repository.getAudioArtifactByJob(args.audioRenderJobId);
  }

  async muxedArtifact(args: {
    projectId: string;
    audioRenderJobId: string;
    userId: string;
  }): Promise<MuxedVideoArtifactRecord | null> {
    await this.get(args);
    return this.deps.repository.getMuxedArtifactByJob(args.audioRenderJobId);
  }
}
