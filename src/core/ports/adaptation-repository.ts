import type {
  AdaptationBatchRecord,
  AdaptationBatchStatus,
  AdaptationJobRecord,
  AdaptationJobStatus,
  AdaptationKind,
  AdaptationSourceType,
} from "../../modules/multiformat-engine/domain/types";

export type CreateAdaptationBatchInput = {
  id: string;
  projectId: string;
  requestedById: string;
  sourceType: AdaptationSourceType;
  sourceId: string;
  sourceSnapshot: string;
  sourceSha256: string;
  targetCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateAdaptationJobInput = {
  id: string;
  batchId: string;
  projectId: string;
  requestedById: string;
  platformId: string;
  formatId: string;
  kind: AdaptationKind;
  recipe: string;
  recipeSha256: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateAdaptationPlan = {
  batch: CreateAdaptationBatchInput;
  jobs: readonly CreateAdaptationJobInput[];
};

export type ListAdaptationBatchesFilter = {
  status?: AdaptationBatchStatus;
  sourceId?: string;
  limit?: number;
};

export type AdaptSucceededOutput = {
  outputText?: string | null;
  outputMimeType?: string | null;
  outputStorageKey?: string | null;
  outputByteSize?: number | null;
  outputChecksumSha256?: string | null;
  outputWidth?: number | null;
  outputHeight?: number | null;
  renderJobId?: string | null;
};

/**
 * Persistence for CP19, project-scoped everywhere.
 *
 * A batch and its jobs are written in one transaction: a batch whose jobs were
 * only half written would report a target count it cannot deliver, and the UI
 * would then wait forever for work that was never queued. Every read carries the
 * project, so a well-formed id belonging to another project resolves to nothing.
 */
export interface AdaptationRepository {
  createBatchWithJobs(
    plan: CreateAdaptationPlan,
  ): Promise<AdaptationBatchRecord>;

  getBatch(
    projectId: string,
    batchId: string,
  ): Promise<AdaptationBatchRecord | null>;

  listBatches(
    projectId: string,
    filter?: ListAdaptationBatchesFilter,
  ): Promise<AdaptationBatchRecord[]>;

  listJobs(batchId: string): Promise<AdaptationJobRecord[]>;

  listJobsByProject(
    projectId: string,
    filter?: { status?: AdaptationJobStatus; limit?: number },
  ): Promise<AdaptationJobRecord[]>;

  getJob(
    projectId: string,
    jobId: string,
  ): Promise<AdaptationJobRecord | null>;

  /**
   * Atomically claims the oldest queued job. A worker that loses the race sees
   * null, so the same adaptation is never produced twice concurrently.
   */
  claimNext(): Promise<AdaptationJobRecord | null>;

  updateProgress(
    jobId: string,
    progressPct: number,
    updatedAt: string,
  ): Promise<void>;

  markRunning(input: {
    jobId: string;
    startedAt: string;
    updatedAt: string;
  }): Promise<void>;

  /** Parks a video job until the CP15 render it asked for produces bytes. */
  markWaitingRender(input: {
    jobId: string;
    renderJobId: string;
    progressPct: number;
    updatedAt: string;
  }): Promise<void>;

  markSucceeded(input: {
    jobId: string;
    output: AdaptSucceededOutput;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void>;

  markFailed(input: {
    jobId: string;
    errorCode: string;
    errorMessage: string;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void>;

  markCancelled(input: {
    jobId: string;
    finishedAt: string;
    updatedAt: string;
  }): Promise<void>;

  /**
   * Moves a batch into cancellation and cancels what is still open.
   *
   * Queued jobs are finished on the spot; jobs already running are asked to stop
   * and finalise themselves. Returns the batch as it now stands, or null when the
   * batch is gone or already finished.
   */
  requestCancelBatch(input: {
    projectId: string;
    batchId: string;
    finishedAt: string;
  }): Promise<AdaptationBatchRecord | null>;

  requestCancelJob(input: {
    projectId: string;
    jobId: string;
    finishedAt: string;
  }): Promise<boolean>;

  findCancelRequestedJobs(): Promise<AdaptationJobRecord[]>;

  /** Video jobs parked on a CP15 render, for reconciliation. */
  findWaitingRenderJobs(): Promise<AdaptationJobRecord[]>;

  /** Recomputes a batch's status and progress from its jobs and persists both. */
  refreshBatchStatus(input: {
    batchId: string;
    updatedAt: string;
  }): Promise<AdaptationBatchRecord | null>;

  /** Jobs queued longer than `olderThanIso`, for the abandoned-queue sweep. */
  findStaleQueuedJobs(olderThanIso: string): Promise<AdaptationJobRecord[]>;
}