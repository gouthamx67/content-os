import type {
  RenderArtifactRecord,
  RenderJobRecord,
  RenderJobStatus,
  RenderOutputFormat,
} from "../../modules/video-rendering/domain/types";

export type CreateRenderJobInput = {
  id: string;
  projectId: string;
  compositionId: string;
  requestedById: string;
  contractVersion: number;
  sceneGraph: string;
  sceneSha256: string;
  outputFormat: RenderOutputFormat;
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateRenderArtifactInput = {
  id: string;
  renderJobId: string;
  projectId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  createdAt: string;
};

export type ListRenderJobsFilter = {
  compositionId?: string;
  status?: RenderJobStatus;
  limit?: number;
};

/**
 * Every read and write is project-scoped. A render job id is only meaningful
 * inside a project, so cross-project access is prevented by the signature
 * rather than by a check a caller might forget.
 */
export interface RenderJobRepository {
  create(input: CreateRenderJobInput): Promise<RenderJobRecord>;

  get(projectId: string, renderJobId: string): Promise<RenderJobRecord | null>;

  list(
    projectId: string,
    filter?: ListRenderJobsFilter,
  ): Promise<RenderJobRecord[]>;

  /**
   * Atomically claims the oldest queued job. Two workers racing the same row
   * must not both win; the loser sees null.
   */
  claimNext(): Promise<RenderJobRecord | null>;

  updateProgress(
    renderJobId: string,
    progressPct: number,
    updatedAt: string,
  ): Promise<void>;

  markRunning(input: {
    renderJobId: string;
    ffmpegVersion: string | null;
    startedAt: string;
    updatedAt: string;
  }): Promise<void>;

  /** Returns false when the row was already finished by another transition. */
  markSucceeded(input: {
    renderJobId: string;
    ffmpegVersion: string | null;
    finishedAt: string;
    updatedAt: string;
  }): Promise<boolean>;

  /** Returns false when the row was already finished by another transition. */
  markFailed(input: {
    renderJobId: string;
    errorCode: string;
    errorMessage: string;
    finishedAt: string;
    updatedAt: string;
  }): Promise<boolean>;

  /** Returns false when the row was already finished by another transition. */
  markCancelled(input: {
    renderJobId: string;
    finishedAt: string;
    updatedAt: string;
  }): Promise<boolean>;

  /** Extends the claim lease while the job is still RUNNING. */
  renewLease(renderJobId: string, nowIso: string): Promise<boolean>;

  /**
   * Recovery sweep: finishes cancels and requeues RUNNING jobs whose worker
   * stopped refreshing the lease.
   */
  reclaimExpiredLeases(nowIso: string): Promise<{
    cancelled: number;
    requeued: number;
  }>;

  /** Transitions QUEUED/RUNNING to CANCEL_REQUESTED. Returns false if not cancellable. */
  requestCancel(projectId: string, renderJobId: string): Promise<boolean>;

  findCancelRequested(): Promise<RenderJobRecord[]>;

  createArtifact(
    input: CreateRenderArtifactInput,
  ): Promise<RenderArtifactRecord>;

  getArtifactByJob(renderJobId: string): Promise<RenderArtifactRecord | null>;

  getArtifact(
    projectId: string,
    artifactId: string,
  ): Promise<RenderArtifactRecord | null>;
}
