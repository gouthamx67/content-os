import type {
  GeneratedImageAssetRecord,
  GraphicDocumentRecord,
  GraphicTemplateType,
  ImageGenerationJobRecord,
  ImageGenerationJobStatus,
  ImageGenerationProvider,
  ImageOutputFormat,
} from "../../modules/image-generation/domain/types";

export type CreateGraphicDocumentInput = {
  id: string;
  projectId: string;
  createdById: string;
  name: string;
  templateType: GraphicTemplateType;
  width: number;
  height: number;
  outputFormat: ImageOutputFormat;
  transparent: boolean;
  designGraph: string;
  designGraphHash: string;
  contractVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type UpdateGraphicDocumentInput = {
  name?: string;
  designGraph?: string;
  designGraphHash?: string;
  updatedAt: string;
};

export type CreateImageGenerationJobInput = {
  id: string;
  projectId: string;
  requestedById: string;
  graphicDocumentId: string | null;
  provider: ImageGenerationProvider;
  outputFormat: ImageOutputFormat;
  width: number;
  height: number;
  transparent: boolean;
  prompt: string;
  generationRecipe: string;
  recipeSha256: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateGeneratedImageAssetInput = {
  id: string;
  projectId: string;
  generationJobId: string | null;
  graphicDocumentId: string | null;
  storageKey: string;
  mimeType: string;
  outputFormat: ImageOutputFormat;
  width: number;
  height: number;
  byteSize: number;
  checksumSha256: string;
  transparent: boolean;
  metadata: string | null;
  createdAt: string;
};

export type ListImageGenerationJobsFilter = {
  graphicDocumentId?: string;
  status?: ImageGenerationJobStatus;
  limit?: number;
};

export type ListGeneratedImageAssetsFilter = {
  generationJobId?: string;
  graphicDocumentId?: string;
  limit?: number;
};

/**
 * Every read and write is project-scoped. Two projects can each own a graphic
 * document with unrelated content under the same id-shaped key, so a method
 * taking a bare id would make cross-project access a matter of discipline
 * instead of something the signature prevents.
 */
export interface ImageGenerationRepository {
  createDocument(
    input: CreateGraphicDocumentInput,
  ): Promise<GraphicDocumentRecord>;

  getDocument(
    projectId: string,
    documentId: string,
  ): Promise<GraphicDocumentRecord | null>;

  listDocuments(
    projectId: string,
    limit?: number,
  ): Promise<GraphicDocumentRecord[]>;

  updateDocument(
    projectId: string,
    documentId: string,
    changes: UpdateGraphicDocumentInput,
  ): Promise<GraphicDocumentRecord>;

  softDeleteDocument(
    projectId: string,
    documentId: string,
    deletedAt: string,
  ): Promise<void>;

  createJob(
    input: CreateImageGenerationJobInput,
  ): Promise<ImageGenerationJobRecord>;

  getJob(
    projectId: string,
    jobId: string,
  ): Promise<ImageGenerationJobRecord | null>;

  listJobs(
    projectId: string,
    filter?: ListImageGenerationJobsFilter,
  ): Promise<ImageGenerationJobRecord[]>;

  /** Atomically claims the oldest queued job. A racing loser sees null. */
  claimNext(): Promise<ImageGenerationJobRecord | null>;

  updateProgress(
    jobId: string,
    progressPct: number,
    updatedAt: string,
  ): Promise<void>;

  markRunning(input: {
    jobId: string;
    providerVersion: string | null;
    startedAt: string;
    updatedAt: string;
  }): Promise<void>;

  markSucceeded(input: {
    jobId: string;
    providerJobId: string | null;
    providerModel: string | null;
    providerVersion: string | null;
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

  requestCancel(projectId: string, jobId: string): Promise<boolean>;

  findCancelRequested(): Promise<ImageGenerationJobRecord[]>;

  createAsset(
    input: CreateGeneratedImageAssetInput,
  ): Promise<GeneratedImageAssetRecord>;

  getAsset(
    projectId: string,
    assetId: string,
  ): Promise<GeneratedImageAssetRecord | null>;

  listAssets(
    projectId: string,
    filter?: ListGeneratedImageAssetsFilter,
  ): Promise<GeneratedImageAssetRecord[]>;

  getAssetByJob(jobId: string): Promise<GeneratedImageAssetRecord | null>;

  softDeleteAsset(
    projectId: string,
    assetId: string,
    deletedAt: string,
  ): Promise<void>;
}
