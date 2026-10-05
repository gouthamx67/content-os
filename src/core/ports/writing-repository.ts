import type {
  ClaimStatus,
  WritingBlockType,
  WritingClaimRecord,
  WritingDocumentRecord,
  WritingGenerationJobRecord,
  WritingJobStatus,
  WritingLength,
  WritingProvider,
  WritingTone,
  WritingVariantRecord,
} from "../../modules/writing-engine/domain/types";

export type CreateWritingDocumentInput = {
  id: string;
  projectId: string;
  createdById: string;
  title: string;
  blockType: WritingBlockType;
  tone: WritingTone;
  length: WritingLength;
  objective: string;
  audience: string | null;
  language: string | null;
  content: string;
  contentSha256: string;
  contextSnapshot: string;
  contextSha256: string;
  version: number;
  brandVersion: number | null;
  intelligenceVersion: number | null;
  intentId: string | null;
  directionId: string | null;
  storyboardId: string | null;
  sceneId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdateWritingDocumentInput = {
  content?: string;
  contentSha256?: string;
  version?: number;
  selectedVariantId?: string | null;
  updatedAt: string;
};

export type CreateWritingVariantInput = {
  id: string;
  documentId: string;
  ordinal: number;
  label: string;
  text: string;
  textSha256: string;
  instruction: string | null;
  selected: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateWritingClaimInput = {
  id: string;
  projectId: string;
  documentId: string;
  variantId: string | null;
  text: string;
  status: ClaimStatus;
  sourceIds: string[];
  reasoning: string | null;
  createdAt: string;
};

export type CreateWritingJobInput = {
  id: string;
  projectId: string;
  requestedById: string;
  documentId: string | null;
  provider: WritingProvider;
  blockType: WritingBlockType;
  tone: WritingTone;
  length: WritingLength;
  objective: string;
  audience: string | null;
  language: string | null;
  prompt: string;
  generationRecipe: string;
  recipeSha256: string;
  contextSnapshot: string;
  contextSha256: string;
  variantCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ListWritingJobsFilter = {
  documentId?: string;
  status?: WritingJobStatus;
  limit?: number;
};

export type ListWritingDocumentsFilter = {
  blockType?: WritingBlockType;
  limit?: number;
};

export type ListWritingClaimsFilter = {
  variantId?: string;
  status?: ClaimStatus;
};

export type GeneratedDocumentPlan = {
  document: CreateWritingDocumentInput;
  variants: CreateWritingVariantInput[];
  claims: CreateWritingClaimInput[];
};

export type AppendVariantPlan = {
  projectId: string;
  documentId: string;
  variant: CreateWritingVariantInput;
  claims: CreateWritingClaimInput[];
  documentUpdate: UpdateWritingDocumentInput;
};

/**
 * Every read and write is project-scoped, and a child row is always reached
 * through its parent: a variant is fetched by `(documentId, variantId)` and a
 * claim by `(documentId, claimId)`, so a correctly shaped id from the wrong
 * project still resolves to nothing.
 */
export interface WritingRepository {
  createDocument(
    input: CreateWritingDocumentInput,
  ): Promise<WritingDocumentRecord>;

  getDocument(
    projectId: string,
    documentId: string,
  ): Promise<WritingDocumentRecord | null>;

  listDocuments(
    projectId: string,
    filter?: ListWritingDocumentsFilter,
  ): Promise<WritingDocumentRecord[]>;

  updateDocument(
    projectId: string,
    documentId: string,
    changes: UpdateWritingDocumentInput,
  ): Promise<WritingDocumentRecord>;

  createVariant(
    input: CreateWritingVariantInput,
  ): Promise<WritingVariantRecord>;

  getVariant(
    documentId: string,
    variantId: string,
  ): Promise<WritingVariantRecord | null>;

  listVariants(documentId: string): Promise<WritingVariantRecord[]>;

  countVariants(documentId: string): Promise<number>;

  /** Marks one variant selected and every sibling unselected in one transaction. */
  selectVariant(
    projectId: string,
    documentId: string,
    variantId: string,
    updatedAt: string,
  ): Promise<WritingVariantRecord | null>;

  createClaims(inputs: readonly CreateWritingClaimInput[]): Promise<number>;

  /** Writes a document, its variants and its claims in one transaction. */
  persistGeneratedDocument(
    plan: GeneratedDocumentPlan,
  ): Promise<WritingDocumentRecord>;

  /** Appends one variant with its claims and updates the parent in one transaction. */
  appendVariant(plan: AppendVariantPlan): Promise<WritingVariantRecord | null>;

  listClaims(
    projectId: string,
    documentId: string,
    filter?: ListWritingClaimsFilter,
  ): Promise<WritingClaimRecord[]>;

  getClaim(
    projectId: string,
    documentId: string,
    claimId: string,
  ): Promise<WritingClaimRecord | null>;

  createJob(input: CreateWritingJobInput): Promise<WritingGenerationJobRecord>;

  getJob(
    projectId: string,
    jobId: string,
  ): Promise<WritingGenerationJobRecord | null>;

  listJobs(
    projectId: string,
    filter?: ListWritingJobsFilter,
  ): Promise<WritingGenerationJobRecord[]>;

  /** Atomically claims the oldest queued job. A racing loser sees null. */
  claimNext(): Promise<WritingGenerationJobRecord | null>;

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
    documentId: string | null;
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

  findCancelRequested(): Promise<WritingGenerationJobRecord[]>;
}
