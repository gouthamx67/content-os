import type { PublicOrm } from "../../prisma/db";
import { db } from "../../prisma/db";
import type { Models } from "../../prisma/contract.d";
import { pgTimestampToIso } from "../../lib/time";
import type {
  AudioRepository,
  CreateAudioArtifactInput,
  CreateAudioCompositionInput,
  CreateAudioRenderJobInput,
  CreateAudioTrackInput,
  CreateMuxedArtifactInput,
  ListAudioRenderJobsFilter,
  UpdateAudioTrackInput,
  UpsertAudioAutomationInput,
} from "../../core/ports/audio-repository";
import type {
  AudioArtifactRecord,
  AudioAutomationPointRecord,
  AudioCompositionRecord,
  AudioRenderJobRecord,
  AudioTrackRecord,
  MuxedVideoArtifactRecord,
} from "../../modules/audio-engine/domain/types";

type CompositionRow = Omit<
  Models.public_AudioComposition,
  "composition" | "tracks" | "renderJobs"
>;
type TrackRow = Omit<Models.public_AudioTrack, "composition" | "automation">;
type AutomationRow = Omit<Models.public_AudioAutomationPoint, "track">;
type JobRow = Omit<
  Models.public_AudioRenderJob,
  "audioComposition" | "audioArtifact" | "muxedArtifact"
>;
type AudioArtifactRow = Omit<Models.public_AudioArtifact, "renderJob">;
type MuxedRow = Omit<Models.public_MuxedVideoArtifact, "renderJob">;

function decodeAutomation(row: AutomationRow): AudioAutomationPointRecord {
  return {
    id: row.id,
    trackId: row.trackId,
    property: row.property,
    timeMs: row.timeMs,
    value: row.value,
    easing: row.easing,
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

function decodeTrack(
  row: TrackRow,
  automation: AudioAutomationPointRecord[],
): AudioTrackRecord {
  return {
    id: row.id,
    audioCompositionId: row.audioCompositionId,
    kind: row.kind,
    name: row.name,
    sourceRef: row.sourceRef,
    startMs: row.startMs,
    sourceOffsetMs: row.sourceOffsetMs,
    durationMs: row.durationMs,
    gainDb: row.gainDb,
    pan: row.pan,
    fadeInMs: row.fadeInMs,
    fadeOutMs: row.fadeOutMs,
    mute: row.mute,
    solo: row.solo,
    duckVoiceoverDb: row.duckVoiceoverDb ?? null,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
    automation,
  };
}

function decodeComposition(
  row: CompositionRow,
  tracks: AudioTrackRecord[],
): AudioCompositionRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    compositionId: row.compositionId,
    name: row.name,
    sampleRate: row.sampleRate,
    channels: row.channels,
    durationMs: row.durationMs,
    status: row.status,
    createdById: row.createdById,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
    tracks,
  };
}

function decodeJob(row: JobRow): AudioRenderJobRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    audioCompositionId: row.audioCompositionId,
    videoRenderJobId: row.videoRenderJobId ?? null,
    requestedById: row.requestedById,
    status: row.status,
    outputFormat: row.outputFormat,
    contractVersion: row.contractVersion,
    audioGraph: row.audioGraph,
    audioSha256: row.audioSha256,
    progressPct: row.progressPct,
    sampleRate: row.sampleRate,
    channels: row.channels,
    durationMs: row.durationMs,
    ffmpegVersion: row.ffmpegVersion ?? null,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    createdAt: pgTimestampToIso(row.createdAt),
    startedAt: row.startedAt ? pgTimestampToIso(row.startedAt) : null,
    finishedAt: row.finishedAt ? pgTimestampToIso(row.finishedAt) : null,
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function decodeAudioArtifact(row: AudioArtifactRow): AudioArtifactRecord {
  return {
    id: row.id,
    audioRenderJobId: row.audioRenderJobId,
    projectId: row.projectId,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

function decodeMuxed(row: MuxedRow): MuxedVideoArtifactRecord {
  return {
    id: row.id,
    audioRenderJobId: row.audioRenderJobId,
    projectId: row.projectId,
    videoRenderJobId: row.videoRenderJobId,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

export class PostgresAudioRepository implements AudioRepository {
  private readonly orm: PublicOrm;

  constructor(orm: PublicOrm = db.orm.public) {
    this.orm = orm;
  }

  async createComposition(
    input: CreateAudioCompositionInput,
  ): Promise<AudioCompositionRecord> {
    const row = (await this.orm.AudioComposition.create({
      id: input.id,
      projectId: input.projectId,
      compositionId: input.compositionId,
      name: input.name,
      sampleRate: input.sampleRate,
      channels: input.channels,
      durationMs: input.durationMs,
      status: input.status,
      createdById: input.createdById,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })) as unknown as CompositionRow;

    return decodeComposition(row, []);
  }

  async getComposition(
    projectId: string,
    audioCompositionId: string,
  ): Promise<AudioCompositionRecord | null> {
    const row = (await this.orm.AudioComposition.where({
      id: audioCompositionId,
      projectId,
    }).first()) as unknown as CompositionRow | null;

    if (!row) return null;
    return this.loadComposition(row);
  }

  async getCompositionByVisual(
    projectId: string,
    visualCompositionId: string,
  ): Promise<AudioCompositionRecord | null> {
    const row = (await this.orm.AudioComposition.where({
      compositionId: visualCompositionId,
      projectId,
    }).first()) as unknown as CompositionRow | null;

    if (!row) return null;
    return this.loadComposition(row);
  }

  private async loadComposition(
    row: CompositionRow,
  ): Promise<AudioCompositionRecord> {
    const trackRows = (await this.orm.AudioTrack.where({
      audioCompositionId: row.id,
    })
      .orderBy((t) => t.startMs.asc())
      .all()) as unknown as TrackRow[];

    const tracks: AudioTrackRecord[] = [];
    for (const trackRow of trackRows) {
      tracks.push(decodeTrack(trackRow, await this.automationFor(trackRow.id)));
    }

    return decodeComposition(row, tracks);
  }

  private async automationFor(
    trackId: string,
  ): Promise<AudioAutomationPointRecord[]> {
    const rows = (await this.orm.AudioAutomationPoint.where({ trackId })
      .orderBy((a) => a.timeMs.asc())
      .all()) as unknown as AutomationRow[];

    return rows.map(decodeAutomation);
  }

  async updateCompositionDuration(input: {
    projectId: string;
    audioCompositionId: string;
    durationMs: number;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.AudioComposition.where({
      id: input.audioCompositionId,
      projectId: input.projectId,
    }).update({
      durationMs: input.durationMs,
      updatedAt: input.updatedAt,
    });
  }

  async addTrack(input: CreateAudioTrackInput): Promise<AudioTrackRecord> {
    const row = (await this.orm.AudioTrack.create({
      id: input.id,
      audioCompositionId: input.audioCompositionId,
      kind: input.kind,
      name: input.name,
      sourceRef: input.sourceRef,
      startMs: input.startMs,
      sourceOffsetMs: input.sourceOffsetMs,
      durationMs: input.durationMs,
      gainDb: input.gainDb,
      pan: input.pan,
      fadeInMs: input.fadeInMs,
      fadeOutMs: input.fadeOutMs,
      mute: input.mute,
      solo: input.solo,
      duckVoiceoverDb: input.duckVoiceoverDb,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })) as unknown as TrackRow;

    return decodeTrack(row, []);
  }

  async getTrack(
    projectId: string,
    audioCompositionId: string,
    trackId: string,
  ): Promise<AudioTrackRecord | null> {
    const composition = await this.getComposition(projectId, audioCompositionId);
    if (!composition) return null;
    return composition.tracks.find((track) => track.id === trackId) ?? null;
  }

  async updateTrack(
    projectId: string,
    audioCompositionId: string,
    trackId: string,
    changes: UpdateAudioTrackInput,
  ): Promise<AudioTrackRecord> {
    const existing = await this.getTrack(projectId, audioCompositionId, trackId);
    if (!existing) {
      throw new Error("Audio track not found");
    }

    const row = (await this.orm.AudioTrack.where({ id: trackId }).update({
      ...changes,
    })) as unknown as TrackRow;

    return decodeTrack(row, existing.automation);
  }

  async deleteTrack(
    projectId: string,
    audioCompositionId: string,
    trackId: string,
  ): Promise<void> {
    const existing = await this.getTrack(projectId, audioCompositionId, trackId);
    if (!existing) return;
    await this.orm.AudioTrack.where({ id: trackId }).delete();
  }

  async upsertAutomationPoint(
    input: UpsertAudioAutomationInput,
  ): Promise<AudioAutomationPointRecord> {
    const existing = (await this.orm.AudioAutomationPoint.where({
      trackId: input.trackId,
      property: input.property,
      timeMs: input.timeMs,
    }).first()) as unknown as AutomationRow | null;

    if (existing) {
      const row = (await this.orm.AudioAutomationPoint.where({
        id: existing.id,
      }).update({
        value: input.value,
        easing: input.easing,
      })) as unknown as AutomationRow;

      return decodeAutomation(row);
    }

    const row = (await this.orm.AudioAutomationPoint.create({
      id: input.id,
      trackId: input.trackId,
      property: input.property,
      timeMs: input.timeMs,
      value: input.value,
      easing: input.easing,
      createdAt: input.createdAt,
    })) as unknown as AutomationRow;

    return decodeAutomation(row);
  }

  async listAutomation(
    projectId: string,
    audioCompositionId: string,
    trackId: string,
  ): Promise<AudioAutomationPointRecord[]> {
    const track = await this.getTrack(projectId, audioCompositionId, trackId);
    return track ? track.automation : [];
  }

  async createRenderJob(
    input: CreateAudioRenderJobInput,
  ): Promise<AudioRenderJobRecord> {
    const row = (await this.orm.AudioRenderJob.create({
      id: input.id,
      projectId: input.projectId,
      audioCompositionId: input.audioCompositionId,
      videoRenderJobId: input.videoRenderJobId,
      requestedById: input.requestedById,
      status: "QUEUED",
      outputFormat: input.outputFormat,
      contractVersion: input.contractVersion,
      audioGraph: input.audioGraph,
      audioSha256: input.audioSha256,
      progressPct: 0,
      sampleRate: input.sampleRate,
      channels: input.channels,
      durationMs: input.durationMs,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })) as unknown as JobRow;

    return decodeJob(row);
  }

  async getRenderJob(
    projectId: string,
    audioRenderJobId: string,
  ): Promise<AudioRenderJobRecord | null> {
    const row = (await this.orm.AudioRenderJob.where({
      id: audioRenderJobId,
      projectId,
    }).first()) as unknown as JobRow | null;

    return row ? decodeJob(row) : null;
  }

  async listRenderJobs(
    projectId: string,
    filter: ListAudioRenderJobsFilter = {},
  ): Promise<AudioRenderJobRecord[]> {
    const rows = (await this.orm.AudioRenderJob.where({
      projectId,
      ...(filter.audioCompositionId
        ? { audioCompositionId: filter.audioCompositionId }
        : {}),
      ...(filter.status ? { status: filter.status } : {}),
    })
      .orderBy((j) => j.createdAt.desc())
      .limit(filter.limit ?? 50)
      .all()) as unknown as JobRow[];

    return rows.map(decodeJob);
  }

  async claimNext(): Promise<AudioRenderJobRecord | null> {
    const now = new Date().toISOString();
    let claimedId: string | null = null;

    await db.transaction(async (tx) => {
      const candidate = (await tx.orm.public.AudioRenderJob.where({
        status: "QUEUED",
      })
        .orderBy((j) => j.createdAt.asc())
        .first()) as unknown as JobRow | null;

      if (!candidate) return;

      const plan = tx.sql.public.audio_render_job
        .update({ status: "RUNNING", progressPct: 0, startedAt: now, updatedAt: now })
        .where((f, fns) => fns.eq(f.id, candidate.id))
        .where((f, fns) => fns.eq(f.status, "QUEUED"))
        .returning("id")
        .build();

      const rows = await tx.query(plan);
      if (rows.length === 1) claimedId = candidate.id;
    });

    if (!claimedId) return null;
    return this.getById(claimedId);
  }

  async updateProgress(
    audioRenderJobId: string,
    progressPct: number,
    updatedAt: string,
  ): Promise<void> {
    await this.orm.AudioRenderJob.where({ id: audioRenderJobId }).update({
      progressPct: Math.max(0, Math.min(100, Math.round(progressPct))),
      updatedAt,
    });
  }

  async markRunning(input: {
    audioRenderJobId: string;
    ffmpegVersion: string | null;
    startedAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.AudioRenderJob.where({ id: input.audioRenderJobId }).update({
      status: "RUNNING",
      ffmpegVersion: input.ffmpegVersion,
      startedAt: input.startedAt,
      updatedAt: input.updatedAt,
    });
  }

  async markSucceeded(input: {
    audioRenderJobId: string;
    ffmpegVersion: string | null;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.AudioRenderJob.where({ id: input.audioRenderJobId }).update({
      status: "SUCCEEDED",
      progressPct: 100,
      ffmpegVersion: input.ffmpegVersion,
      finishedAt: input.finishedAt,
      updatedAt: input.updatedAt,
    });
  }

  async markFailed(input: {
    audioRenderJobId: string;
    errorCode: string;
    errorMessage: string;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.AudioRenderJob.where({ id: input.audioRenderJobId }).update({
      status: "FAILED",
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      finishedAt: input.finishedAt,
      updatedAt: input.updatedAt,
    });
  }

  async markCancelled(input: {
    audioRenderJobId: string;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.orm.AudioRenderJob.where({ id: input.audioRenderJobId }).update({
      status: "CANCELLED",
      finishedAt: input.finishedAt,
      updatedAt: input.updatedAt,
    });
  }

  async requestCancel(
    projectId: string,
    audioRenderJobId: string,
  ): Promise<boolean> {
    const job = await this.getRenderJob(projectId, audioRenderJobId);
    if (!job) return false;
    if (job.status !== "QUEUED" && job.status !== "RUNNING") return false;

    const now = new Date().toISOString();
    const update = db.sql.public.audio_render_job;
    const builder =
      job.status === "QUEUED"
        ? update
            .update({ status: "CANCELLED", finishedAt: now, updatedAt: now })
            .where((f, fns) => fns.eq(f.id, audioRenderJobId))
            .where((f, fns) => fns.eq(f.status, "QUEUED"))
        : update
            .update({ status: "CANCEL_REQUESTED", updatedAt: now })
            .where((f, fns) => fns.eq(f.id, audioRenderJobId))
            .where((f, fns) => fns.eq(f.status, "RUNNING"));

    const rows = await db.runtime().query(builder.returning("id").build());
    return rows.length === 1;
  }

  async findCancelRequested(): Promise<AudioRenderJobRecord[]> {
    const rows = (await this.orm.AudioRenderJob.where({
      status: "CANCEL_REQUESTED",
    }).all()) as unknown as JobRow[];

    return rows.map(decodeJob);
  }

  async createAudioArtifact(
    input: CreateAudioArtifactInput,
  ): Promise<AudioArtifactRecord> {
    const row = (await this.orm.AudioArtifact.create({
      id: input.id,
      audioRenderJobId: input.audioRenderJobId,
      projectId: input.projectId,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      checksumSha256: input.checksumSha256,
      createdAt: input.createdAt,
    })) as unknown as AudioArtifactRow;

    return decodeAudioArtifact(row);
  }

  async createMuxedArtifact(
    input: CreateMuxedArtifactInput,
  ): Promise<MuxedVideoArtifactRecord> {
    const row = (await this.orm.MuxedVideoArtifact.create({
      id: input.id,
      audioRenderJobId: input.audioRenderJobId,
      projectId: input.projectId,
      videoRenderJobId: input.videoRenderJobId,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      checksumSha256: input.checksumSha256,
      createdAt: input.createdAt,
    })) as unknown as MuxedRow;

    return decodeMuxed(row);
  }

  async getAudioArtifactByJob(
    audioRenderJobId: string,
  ): Promise<AudioArtifactRecord | null> {
    const row = (await this.orm.AudioArtifact.where({
      audioRenderJobId,
    }).first()) as unknown as AudioArtifactRow | null;

    return row ? decodeAudioArtifact(row) : null;
  }

  async getMuxedArtifactByJob(
    audioRenderJobId: string,
  ): Promise<MuxedVideoArtifactRecord | null> {
    const row = (await this.orm.MuxedVideoArtifact.where({
      audioRenderJobId,
    }).first()) as unknown as MuxedRow | null;

    return row ? decodeMuxed(row) : null;
  }

  private async getById(
    audioRenderJobId: string,
  ): Promise<AudioRenderJobRecord | null> {
    const row = (await this.orm.AudioRenderJob.where({
      id: audioRenderJobId,
    }).first()) as unknown as JobRow | null;

    return row ? decodeJob(row) : null;
  }
}
