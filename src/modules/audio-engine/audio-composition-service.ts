import { createId } from "../../lib/id";
import { HttpError } from "../../lib/http";
import type {
  AudioRepository,
  UpdateAudioTrackInput,
} from "../../core/ports/audio-repository";
import type {
  AudioAutomationPointRecord,
  AudioCompositionRecord,
  AudioTrackRecord,
} from "./domain/types";
import {
  sortAutomation,
  validateAudioComposition,
  validateAudioTrackInput,
  validateAutomationInput,
} from "./domain/validation";

export type AudioCompositionServiceDeps = {
  repository: AudioRepository;
  authorizeProject: (projectId: string, userId: string) => Promise<void>;
};

export type CreateTrackArgs = {
  projectId: string;
  audioCompositionId: string;
  userId: string;
  kind: string;
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
};

export type UpdateTrackArgs = {
  projectId: string;
  audioCompositionId: string;
  trackId: string;
  userId: string;
  changes: Omit<UpdateAudioTrackInput, "updatedAt">;
};

export type UpsertAutomationArgs = {
  projectId: string;
  audioCompositionId: string;
  trackId: string;
  userId: string;
  property: string;
  timeMs: number;
  value: number;
  easing: string;
};

/**
 * Owns the mutable side of an audio composition: tracks and their automation.
 *
 * Every method authorizes the project first and resolves the composition
 * through the project-scoped repository, so an id from another project is
 * indistinguishable from an id that does not exist.
 */
export class AudioCompositionService {
  constructor(private readonly deps: AudioCompositionServiceDeps) {}

  async get(
    projectId: string,
    audioCompositionId: string,
    userId: string,
  ): Promise<AudioCompositionRecord> {
    await this.deps.authorizeProject(projectId, userId);

    const composition = await this.deps.repository.getComposition(
      projectId,
      audioCompositionId,
    );

    if (!composition) {
      throw new HttpError(404, "Audio composition not found");
    }

    return composition;
  }

  async getByVisual(
    projectId: string,
    visualCompositionId: string,
    userId: string,
  ): Promise<AudioCompositionRecord> {
    await this.deps.authorizeProject(projectId, userId);

    const composition = await this.deps.repository.getCompositionByVisual(
      projectId,
      visualCompositionId,
    );

    if (!composition) {
      throw new HttpError(404, "Audio composition not found");
    }

    return composition;
  }

  async addTrack(args: CreateTrackArgs): Promise<AudioTrackRecord> {
    const composition = await this.get(
      args.projectId,
      args.audioCompositionId,
      args.userId,
    );

    validateAudioTrackInput({
      kind: args.kind,
      name: args.name,
      sourceRef: args.sourceRef,
      startMs: args.startMs,
      sourceOffsetMs: args.sourceOffsetMs,
      durationMs: args.durationMs,
      gainDb: args.gainDb,
      pan: args.pan,
      fadeInMs: args.fadeInMs,
      fadeOutMs: args.fadeOutMs,
      mute: args.mute,
      solo: args.solo,
      duckVoiceoverDb: args.duckVoiceoverDb,
      compositionDurationMs: composition.durationMs,
    });

    validateAudioComposition(
      [...composition.tracks, { id: `pending-${args.kind}` }],
      composition.durationMs,
    );

    const now = new Date().toISOString();

    return this.deps.repository.addTrack({
      id: createId("atrk"),
      audioCompositionId: composition.id,
      kind: args.kind as AudioTrackRecord["kind"],
      name: args.name,
      sourceRef: args.sourceRef,
      startMs: args.startMs,
      sourceOffsetMs: args.sourceOffsetMs,
      durationMs: args.durationMs,
      gainDb: args.gainDb,
      pan: args.pan,
      fadeInMs: args.fadeInMs,
      fadeOutMs: args.fadeOutMs,
      mute: args.mute,
      solo: args.solo,
      duckVoiceoverDb: args.duckVoiceoverDb,
      createdAt: now,
      updatedAt: now,
    });
  }

  async updateTrack(args: UpdateTrackArgs): Promise<AudioTrackRecord> {
    const composition = await this.get(
      args.projectId,
      args.audioCompositionId,
      args.userId,
    );

    const existing = composition.tracks.find(
      (track) => track.id === args.trackId,
    );

    if (!existing) {
      throw new HttpError(404, "Audio track not found");
    }

    const merged = { ...existing, ...args.changes };

    validateAudioTrackInput({
      kind: merged.kind,
      name: merged.name,
      sourceRef: merged.sourceRef,
      startMs: merged.startMs,
      sourceOffsetMs: merged.sourceOffsetMs,
      durationMs: merged.durationMs,
      gainDb: merged.gainDb,
      pan: merged.pan,
      fadeInMs: merged.fadeInMs,
      fadeOutMs: merged.fadeOutMs,
      mute: merged.mute,
      solo: merged.solo,
      duckVoiceoverDb: merged.duckVoiceoverDb,
      compositionDurationMs: composition.durationMs,
    });

    return this.deps.repository.updateTrack(
      args.projectId,
      composition.id,
      args.trackId,
      { ...args.changes, updatedAt: new Date().toISOString() },
    );
  }

  async deleteTrack(args: {
    projectId: string;
    audioCompositionId: string;
    trackId: string;
    userId: string;
  }): Promise<void> {
    const composition = await this.get(
      args.projectId,
      args.audioCompositionId,
      args.userId,
    );

    const existing = composition.tracks.find(
      (track) => track.id === args.trackId,
    );

    if (!existing) {
      throw new HttpError(404, "Audio track not found");
    }

    await this.deps.repository.deleteTrack(
      args.projectId,
      composition.id,
      args.trackId,
    );
  }

  async upsertAutomation(
    args: UpsertAutomationArgs,
  ): Promise<AudioAutomationPointRecord> {
    const composition = await this.get(
      args.projectId,
      args.audioCompositionId,
      args.userId,
    );

    const track = composition.tracks.find(
      (candidate) => candidate.id === args.trackId,
    );

    if (!track) {
      throw new HttpError(404, "Audio track not found");
    }

    validateAutomationInput({
      property: args.property,
      timeMs: args.timeMs,
      value: args.value,
      durationMs: track.durationMs,
    });

    return this.deps.repository.upsertAutomationPoint({
      id: createId("apnt"),
      trackId: track.id,
      property: "VOLUME_DB",
      timeMs: args.timeMs,
      value: args.value,
      easing: args.easing as AudioAutomationPointRecord["easing"],
      createdAt: new Date().toISOString(),
    });
  }

  async listAutomation(args: {
    projectId: string;
    audioCompositionId: string;
    trackId: string;
    userId: string;
  }): Promise<AudioAutomationPointRecord[]> {
    const composition = await this.get(
      args.projectId,
      args.audioCompositionId,
      args.userId,
    );

    const track = composition.tracks.find(
      (candidate) => candidate.id === args.trackId,
    );

    if (!track) {
      throw new HttpError(404, "Audio track not found");
    }

    return sortAutomation(track.automation);
  }
}
