/**
 * The vocabulary of the CP23 publishing engine.
 *
 * Every status here mirrors a database check constraint in `contract.prisma`,
 * so an invalid status cannot reach a row even if a caller invents one. The
 * records are the decoded rows as the repositories hand them back: JSON-shaped
 * columns are already parsed, timestamps are ISO strings.
 */

export const PUBLISHING_CONNECTION_STATUSES = [
  "CONNECTED",
  "AUTH_REQUIRED",
  "REVOKED",
  "DISCONNECTED",
] as const;
export type PublishingConnectionStatus =
  (typeof PUBLISHING_CONNECTION_STATUSES)[number];

export const PUBLICATION_SOURCE_TYPES = [
  "WRITING_DOCUMENT",
  "CAMPAIGN_DELIVERABLE",
] as const;
export type PublicationSourceType = (typeof PUBLICATION_SOURCE_TYPES)[number];

export const PUBLICATION_STATUSES = [
  "DRAFT",
  "READY",
  "SCHEDULED",
  "QUEUED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "AMBIGUOUS",
  "AUTH_REQUIRED",
  "STALE",
  "CANCELLED",
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const PUBLISH_ATTEMPT_OUTCOMES = [
  "SUCCEEDED",
  "FAILED",
  "AMBIGUOUS",
] as const;
export type PublishAttemptOutcome = (typeof PUBLISH_ATTEMPT_OUTCOMES)[number];

export const RECOMMENDATION_CATEGORIES = [
  "PERFORMANCE_OUTLIER",
  "TIMING_WINDOW",
] as const;
export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];

export const RECOMMENDATION_CONFIDENCES = ["LOW", "MEDIUM", "HIGH"] as const;
export type RecommendationConfidence = (typeof RECOMMENDATION_CONFIDENCES)[number];

export const RECOMMENDATION_STATUSES = ["OPEN", "ACCEPTED", "DISMISSED"] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

/**
 * Provider capabilities this engine knows how to test for. A provider declares
 * what it can do; the UIs never offer an action the declared capability does
 * not cover.
 */
export const PROVIDER_CAPABILITIES = [
  "TEXT_POST",
  "IDEMPOTENT_PUBLISH",
] as const;
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export const METRIC_PROVENANCES = ["PROVIDER_API"] as const;
export type MetricProvenance = (typeof METRIC_PROVENANCES)[number];

export const ANALYTICS_COMPLETENESS = ["COMPLETE", "PARTIAL"] as const;
export type AnalyticsCompleteness = (typeof ANALYTICS_COMPLETENESS)[number];

export type ValidationFindingSeverity = "ERROR" | "WARNING";

export type ValidationFinding = {
  code: string;
  severity: ValidationFindingSeverity;
  message: string;
  remediation: string | null;
};

/**
 * The frozen publish payload. `contentSha256` is over the canonical JSON
 * `{ title, content }`, so a source edit between validation and dispatch is
 * detectable and lands the publication in STALE instead of publishing bytes
 * nobody approved.
 */
export type PublishableSnapshot = {
  title: string;
  content: string;
  contentSha256: string;
  sourceLabel: string;
  approvalNote: string | null;
};

export type PublishingConnectionRecord = {
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
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicationRecord = {
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
  scheduledFor: string | null;
  scheduledTimezone: string | null;
  validation: ValidationFinding[] | null;
  validatedAt: string | null;
  attemptedCount: number;
  externalPostId: string | null;
  externalUrl: string | null;
  externalPublishedAt: string | null;
  publishedAt: string | null;
  cancelledAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastErrorRetryable: boolean | null;
  analyticsRequestedAt: string | null;
  analyticsClaimedAt: string | null;
  analyticsCollectedAt: string | null;
  analyticsErrorCode: string | null;
  analyticsErrorMessage: string | null;
  recommendationId: string | null;
  originPublicationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublishAttemptRecord = {
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
  createdAt: string;
};

export type AnalyticsSnapshotRecord = {
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
  provenance: MetricProvenance;
  completeness: AnalyticsCompleteness;
  createdAt: string;
};

export type RecommendationEvidenceItem = {
  publicationId: string;
  snapshotId: string | null;
  metricKey: string;
  value: number;
  collectedAt: string | null;
};

export type RecommendationEvidence = {
  comparison: string;
  metricKey: string;
  observedValue: number;
  baselineValue: number;
  baselineLabel: string;
  sampleSize: number;
  items: RecommendationEvidenceItem[];
};

export type ProposedChanges = {
  sourcePublicationId: string;
  suggestedWindowStartHourUtc: number | null;
  suggestedWindowEndHourUtc: number | null;
  note: string;
};

export type OptimizationRecommendationRecord = {
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
  proposedChanges: ProposedChanges;
  status: RecommendationStatus;
  reviewedById: string | null;
  reviewedAt: string | null;
  resultPublicationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ResolvedPublicationSource = {
  sourceType: PublicationSourceType;
  sourceId: string;
  sourceRevision: string;
  snapshot: PublishableSnapshot;
  findings: ValidationFinding[];
};
