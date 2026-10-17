import type {
  AnalyticsSnapshotRecord,
  OptimizationRecommendationRecord,
  PublicationRecord,
  PublicationSourceType,
  PublicationStatus,
  PublishAttemptOutcome,
  PublishAttemptRecord,
  PublishableSnapshot,
  PublishingConnectionRecord,
  PublishingConnectionStatus,
  ProviderCapability,
  RecommendationCategory,
  RecommendationConfidence,
  RecommendationEvidence,
  RecommendationStatus,
  ValidationFinding,
} from "../../modules/publishing-engine/domain/types";

/**
 * Persistence boundary for CP23.
 *
 * Reads and writes are project-scoped: a correctly shaped id from another
 * project resolves to null rather than a row. Claim methods are atomic —
 * two racing workers cannot both win the same publication, and a claim never
 * steals a row that is already being processed.
 */

export type CreateConnectionInput = {
  id: string;
  projectId: string;
  createdById: string;
  providerId: string;
  externalAccountId: string;
  displayName: string;
  scopes: string[];
  capabilities: ProviderCapability[];
  status: PublishingConnectionStatus;
  credentialCiphertext: string | null;
  credentialExpiresAt: string | null;
  connectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdateConnectionInput = {
  updatedAt: string;
  displayName?: string;
  scopes?: string[];
  capabilities?: ProviderCapability[];
  status?: PublishingConnectionStatus;
  credentialCiphertext?: string | null;
  credentialExpiresAt?: string | null;
  lastCheckedAt?: string | null;
  lastErrorCode?: string | null;
  connectedAt?: string | null;
  disconnectedAt?: string | null;
};

export type CreatePublicationInput = {
  id: string;
  projectId: string;
  createdById: string;
  connectionId: string;
  sourceType: PublicationSourceType;
  sourceId: string;
  sourceRevision: string;
  sourceHash: string;
  sourceSnapshot: PublishableSnapshot;
  title: string;
  content: string;
  status: PublicationStatus;
  idempotencyKey: string;
  scheduledFor?: string | null;
  scheduledTimezone?: string | null;
  validation?: ValidationFinding[] | null;
  validatedAt?: string | null;
  recommendationId?: string | null;
  originPublicationId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdatePublicationInput = {
  updatedAt: string;
  sourceRevision?: string;
  sourceHash?: string;
  sourceSnapshot?: PublishableSnapshot;
  title?: string;
  content?: string;
  status?: PublicationStatus;
  scheduledFor?: string | null;
  scheduledTimezone?: string | null;
  validation?: ValidationFinding[] | null;
  validatedAt?: string | null;
  attemptedCount?: number;
  externalPostId?: string | null;
  externalUrl?: string | null;
  externalPublishedAt?: string | null;
  publishedAt?: string | null;
  cancelledAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastErrorRetryable?: boolean | null;
  analyticsRequestedAt?: string | null;
  analyticsClaimedAt?: string | null;
  analyticsCollectedAt?: string | null;
  analyticsErrorCode?: string | null;
  analyticsErrorMessage?: string | null;
};

export type ListPublicationsFilter = {
  status?: PublicationStatus;
  sourceType?: PublicationSourceType;
  sourceId?: string;
  limit?: number;
};

export type CreateAttemptInput = {
  id: string;
  projectId: string;
  publicationId: string;
  attemptNumber: number;
  outcome: PublishAttemptOutcome;
  providerRequestId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean | null;
  metadata: Record<string, unknown> | null;
  startedAt: string;
  finishedAt: string;
};

export type CreateSnapshotInput = {
  id: string;
  projectId: string;
  publicationId: string;
  providerId: string;
  metricKey: string;
  value: number;
  unit: string;
  definition: string;
  windowStart: string;
  windowEnd: string;
  asOf: string;
  collectedAt: string;
  provenance: string;
  completeness: string;
};

export type CreateRecommendationInput = {
  id: string;
  projectId: string;
  createdById: string;
  category: RecommendationCategory;
  dedupeKey: string;
  title: string;
  explanation: string;
  evidence: RecommendationEvidence;
  confidence: RecommendationConfidence;
  confidenceRationale: string;
  limitations: string;
  suggestedAction: string;
  proposedChanges: OptimizationRecommendationRecord["proposedChanges"];
  createdAt: string;
  updatedAt: string;
};

export type UpdateRecommendationInput = {
  updatedAt: string;
  status?: RecommendationStatus;
  reviewedById?: string | null;
  reviewedAt?: string | null;
  resultPublicationId?: string | null;
};

export interface PublishingRepository {
  createConnection(input: CreateConnectionInput): Promise<PublishingConnectionRecord>;
  getConnection(
    projectId: string,
    connectionId: string,
  ): Promise<PublishingConnectionRecord | null>;
  findConnectionByAccount(
    projectId: string,
    providerId: string,
    externalAccountId: string,
  ): Promise<PublishingConnectionRecord | null>;
  listConnections(projectId: string): Promise<PublishingConnectionRecord[]>;
  updateConnection(
    projectId: string,
    connectionId: string,
    changes: UpdateConnectionInput,
  ): Promise<PublishingConnectionRecord | null>;

  createPublication(input: CreatePublicationInput): Promise<PublicationRecord>;
  getPublication(
    projectId: string,
    publicationId: string,
  ): Promise<PublicationRecord | null>;
  listPublications(
    projectId: string,
    filter?: ListPublicationsFilter,
  ): Promise<PublicationRecord[]>;
  updatePublication(
    projectId: string,
    publicationId: string,
    changes: UpdatePublicationInput,
  ): Promise<PublicationRecord | null>;
  /**
   * Compare-and-swap one status transition. Returns null when the row was not
   * in `fromStatus` (already claimed, cancelled or otherwise moved).
   */
  transitionPublication(
    projectId: string,
    publicationId: string,
    fromStatus: PublicationStatus,
    changes: UpdatePublicationInput,
  ): Promise<PublicationRecord | null>;

  /** Atomically claims the oldest QUEUED or due SCHEDULED publication. */
  claimNextDue(nowIso: string): Promise<PublicationRecord | null>;
  /** Atomically claims an AMBIGUOUS publication older than the cooldown. */
  claimNextAmbiguous(coolDownBeforeIso: string): Promise<PublicationRecord | null>;
  /** Atomically claims a pending analytics refresh, stamping the claim time. */
  claimNextAnalytics(
    nowIso: string,
    staleClaimBeforeIso: string,
  ): Promise<PublicationRecord | null>;

  recordAttempt(input: CreateAttemptInput): Promise<PublishAttemptRecord>;
  listAttempts(
    projectId: string,
    publicationId: string,
  ): Promise<PublishAttemptRecord[]>;

  /** Inserts readings, skipping ones already stored for the same instant. */
  createSnapshots(inputs: readonly CreateSnapshotInput[]): Promise<number>;
  listSnapshots(
    projectId: string,
    publicationId: string,
  ): Promise<AnalyticsSnapshotRecord[]>;
  /** Latest reading per (publicationId, metricKey) across the given posts. */
  latestSnapshotPoints(
    projectId: string,
    publicationIds: readonly string[],
  ): Promise<AnalyticsSnapshotRecord[]>;

  createRecommendation(
    input: CreateRecommendationInput,
  ): Promise<OptimizationRecommendationRecord>;
  findRecommendationByDedupe(
    projectId: string,
    dedupeKey: string,
  ): Promise<OptimizationRecommendationRecord | null>;
  getRecommendation(
    projectId: string,
    recommendationId: string,
  ): Promise<OptimizationRecommendationRecord | null>;
  listRecommendations(
    projectId: string,
    filter?: { status?: RecommendationStatus; limit?: number },
  ): Promise<OptimizationRecommendationRecord[]>;
  updateRecommendation(
    projectId: string,
    recommendationId: string,
    changes: UpdateRecommendationInput,
  ): Promise<OptimizationRecommendationRecord | null>;
}
