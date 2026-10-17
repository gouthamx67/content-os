import { db } from "../../prisma/db";
import type { PublicOrm } from "../../prisma/db";
import type { Models } from "../../prisma/contract.d";
import { pgTimestampToIso } from "../../lib/time";
import type {
  CreateAttemptInput,
  CreateConnectionInput,
  CreatePublicationInput,
  CreateRecommendationInput,
  CreateSnapshotInput,
  ListPublicationsFilter,
  PublishingRepository,
  UpdateConnectionInput,
  UpdatePublicationInput,
  UpdateRecommendationInput,
} from "../../core/ports/publishing-repository";
import type {
  AnalyticsSnapshotRecord,
  OptimizationRecommendationRecord,
  ProviderCapability,
  PublicationRecord,
  PublicationStatus,
  PublishAttemptOutcome,
  PublishAttemptRecord,
  PublishableSnapshot,
  PublishingConnectionRecord,
  PublishingConnectionStatus,
  RecommendationEvidence,
  RecommendationStatus,
  ValidationFinding,
} from "../../modules/publishing-engine/domain/types";

type ConnectionRow = Omit<
  Models.public_PublishingConnection,
  "project" | "publications"
>;
type PublicationRow = Omit<
  Models.public_Publication,
  "project" | "connection" | "attempts" | "snapshots"
>;
type AttemptRow = Omit<
  Models.public_PublishAttempt,
  "project" | "publication"
>;
type SnapshotRow = Omit<
  Models.public_AnalyticsSnapshot,
  "project" | "publication"
>;
type RecommendationRow = Omit<Models.public_OptimizationRecommendation, "project">;

function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function ts(value: string | null): string | null {
  return value === null ? null : pgTimestampToIso(value);
}

function tsRequired(value: string): string {
  return pgTimestampToIso(value);
}

function decodeConnection(row: ConnectionRow): PublishingConnectionRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    createdById: row.createdById,
    providerId: row.providerId,
    externalAccountId: row.externalAccountId,
    displayName: row.displayName,
    scopes: parseJson<string[]>(row.scopes, []),
    capabilities: parseJson<ProviderCapability[]>(row.capabilities, []),
    status: row.status as PublishingConnectionStatus,
    credentialCiphertext: row.credentialCiphertext ?? null,
    credentialExpiresAt: ts(row.credentialExpiresAt ?? null),
    lastCheckedAt: ts(row.lastCheckedAt ?? null),
    lastErrorCode: row.lastErrorCode ?? null,
    connectedAt: ts(row.connectedAt ?? null),
    disconnectedAt: ts(row.disconnectedAt ?? null),
    createdAt: tsRequired(row.createdAt),
    updatedAt: tsRequired(row.updatedAt),
  };
}

function decodePublication(row: PublicationRow): PublicationRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    createdById: row.createdById,
    connectionId: row.connectionId,
    sourceType: row.sourceType as PublicationRecord["sourceType"],
    sourceId: row.sourceId,
    sourceRevision: row.sourceRevision,
    sourceHash: row.sourceHash,
    sourceSnapshot: parseJson<PublishableSnapshot>(row.sourceSnapshot, {
      title: "",
      content: "",
      contentSha256: "",
      sourceLabel: "",
      approvalNote: null,
    }),
    title: row.title,
    content: row.content,
    status: row.status as PublicationStatus,
    idempotencyKey: row.idempotencyKey,
    scheduledFor: ts(row.scheduledFor ?? null),
    scheduledTimezone: row.scheduledTimezone ?? null,
    validation: row.validation
      ? parseJson<ValidationFinding[]>(row.validation, [])
      : null,
    validatedAt: ts(row.validatedAt ?? null),
    attemptedCount: row.attemptedCount,
    externalPostId: row.externalPostId ?? null,
    externalUrl: row.externalUrl ?? null,
    externalPublishedAt: ts(row.externalPublishedAt ?? null),
    publishedAt: ts(row.publishedAt ?? null),
    cancelledAt: ts(row.cancelledAt ?? null),
    lastErrorCode: row.lastErrorCode ?? null,
    lastErrorMessage: row.lastErrorMessage ?? null,
    lastErrorRetryable: row.lastErrorRetryable ?? null,
    analyticsRequestedAt: ts(row.analyticsRequestedAt ?? null),
    analyticsClaimedAt: ts(row.analyticsClaimedAt ?? null),
    analyticsCollectedAt: ts(row.analyticsCollectedAt ?? null),
    analyticsErrorCode: row.analyticsErrorCode ?? null,
    analyticsErrorMessage: row.analyticsErrorMessage ?? null,
    recommendationId: row.recommendationId ?? null,
    originPublicationId: row.originPublicationId ?? null,
    createdAt: tsRequired(row.createdAt),
    updatedAt: tsRequired(row.updatedAt),
  };
}

function decodeAttempt(row: AttemptRow): PublishAttemptRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    publicationId: row.publicationId,
    attemptNumber: row.attemptNumber,
    outcome: row.outcome as PublishAttemptOutcome,
    providerRequestId: row.providerRequestId ?? null,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    retryable: row.retryable ?? null,
    metadata: row.metadata
      ? parseJson<Record<string, unknown>>(row.metadata, {})
      : null,
    startedAt: tsRequired(row.startedAt),
    finishedAt: tsRequired(row.finishedAt),
    createdAt: tsRequired(row.createdAt),
  };
}

function decodeSnapshot(row: SnapshotRow): AnalyticsSnapshotRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    publicationId: row.publicationId,
    providerId: row.providerId,
    metricKey: row.metricKey,
    value: row.value,
    unit: row.unit,
    definition: row.definition,
    windowStart: tsRequired(row.windowStart),
    windowEnd: tsRequired(row.windowEnd),
    asOf: tsRequired(row.asOf),
    collectedAt: tsRequired(row.collectedAt),
    provenance: row.provenance as AnalyticsSnapshotRecord["provenance"],
    completeness: row.completeness as AnalyticsSnapshotRecord["completeness"],
    createdAt: tsRequired(row.createdAt),
  };
}

function decodeRecommendation(
  row: RecommendationRow,
): OptimizationRecommendationRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    createdById: row.createdById,
    category: row.category as OptimizationRecommendationRecord["category"],
    dedupeKey: row.dedupeKey,
    title: row.title,
    explanation: row.explanation,
    evidence: parseJson<RecommendationEvidence>(row.evidence, {
      comparison: "",
      metricKey: "",
      observedValue: 0,
      baselineValue: 0,
      baselineLabel: "",
      sampleSize: 0,
      items: [],
    }),
    confidence: row.confidence as OptimizationRecommendationRecord["confidence"],
    confidenceRationale: row.confidenceRationale,
    limitations: row.limitations,
    suggestedAction: row.suggestedAction,
    proposedChanges: parseJson<OptimizationRecommendationRecord["proposedChanges"]>(
      row.proposedChanges,
      {
        sourcePublicationId: "",
        suggestedWindowStartHourUtc: null,
        suggestedWindowEndHourUtc: null,
        note: "",
      },
    ),
    status: row.status as RecommendationStatus,
    reviewedById: row.reviewedById ?? null,
    reviewedAt: ts(row.reviewedAt ?? null),
    resultPublicationId: row.resultPublicationId ?? null,
    createdAt: tsRequired(row.createdAt),
    updatedAt: tsRequired(row.updatedAt),
  };
}

function connectionColumns(
  changes: UpdateConnectionInput,
): Record<string, unknown> {
  const columns: Record<string, unknown> = { updatedAt: changes.updatedAt };
  if (changes.displayName !== undefined) columns["displayName"] = changes.displayName;
  if (changes.scopes !== undefined) {
    columns["scopes"] = JSON.stringify(changes.scopes);
  }
  if (changes.capabilities !== undefined) {
    columns["capabilities"] = JSON.stringify(changes.capabilities);
  }
  if (changes.status !== undefined) columns["status"] = changes.status;
  if (changes.credentialCiphertext !== undefined) {
    columns["credentialCiphertext"] = changes.credentialCiphertext;
  }
  if (changes.credentialExpiresAt !== undefined) {
    columns["credentialExpiresAt"] = changes.credentialExpiresAt;
  }
  if (changes.lastCheckedAt !== undefined) {
    columns["lastCheckedAt"] = changes.lastCheckedAt;
  }
  if (changes.lastErrorCode !== undefined) {
    columns["lastErrorCode"] = changes.lastErrorCode;
  }
  if (changes.connectedAt !== undefined) {
    columns["connectedAt"] = changes.connectedAt;
  }
  if (changes.disconnectedAt !== undefined) {
    columns["disconnectedAt"] = changes.disconnectedAt;
  }
  return columns;
}

function publicationColumns(
  changes: UpdatePublicationInput,
): Record<string, unknown> {
  const columns: Record<string, unknown> = { updatedAt: changes.updatedAt };
  if (changes.sourceRevision !== undefined) {
    columns["sourceRevision"] = changes.sourceRevision;
  }
  if (changes.sourceHash !== undefined) columns["sourceHash"] = changes.sourceHash;
  if (changes.sourceSnapshot !== undefined) {
    columns["sourceSnapshot"] = JSON.stringify(changes.sourceSnapshot);
  }
  if (changes.title !== undefined) columns["title"] = changes.title;
  if (changes.content !== undefined) columns["content"] = changes.content;
  if (changes.status !== undefined) columns["status"] = changes.status;
  if (changes.scheduledFor !== undefined) {
    columns["scheduledFor"] = changes.scheduledFor;
  }
  if (changes.scheduledTimezone !== undefined) {
    columns["scheduledTimezone"] = changes.scheduledTimezone;
  }
  if (changes.validation !== undefined) {
    columns["validation"] =
      changes.validation === null ? null : JSON.stringify(changes.validation);
  }
  if (changes.validatedAt !== undefined) columns["validatedAt"] = changes.validatedAt;
  if (changes.attemptedCount !== undefined) {
    columns["attemptedCount"] = changes.attemptedCount;
  }
  if (changes.externalPostId !== undefined) {
    columns["externalPostId"] = changes.externalPostId;
  }
  if (changes.externalUrl !== undefined) {
    columns["externalUrl"] = changes.externalUrl;
  }
  if (changes.externalPublishedAt !== undefined) {
    columns["externalPublishedAt"] = changes.externalPublishedAt;
  }
  if (changes.publishedAt !== undefined) columns["publishedAt"] = changes.publishedAt;
  if (changes.cancelledAt !== undefined) columns["cancelledAt"] = changes.cancelledAt;
  if (changes.lastErrorCode !== undefined) {
    columns["lastErrorCode"] = changes.lastErrorCode;
  }
  if (changes.lastErrorMessage !== undefined) {
    columns["lastErrorMessage"] = changes.lastErrorMessage;
  }
  if (changes.lastErrorRetryable !== undefined) {
    columns["lastErrorRetryable"] = changes.lastErrorRetryable;
  }
  if (changes.analyticsRequestedAt !== undefined) {
    columns["analyticsRequestedAt"] = changes.analyticsRequestedAt;
  }
  if (changes.analyticsClaimedAt !== undefined) {
    columns["analyticsClaimedAt"] = changes.analyticsClaimedAt;
  }
  if (changes.analyticsCollectedAt !== undefined) {
    columns["analyticsCollectedAt"] = changes.analyticsCollectedAt;
  }
  if (changes.analyticsErrorCode !== undefined) {
    columns["analyticsErrorCode"] = changes.analyticsErrorCode;
  }
  if (changes.analyticsErrorMessage !== undefined) {
    columns["analyticsErrorMessage"] = changes.analyticsErrorMessage;
  }
  return columns;
}

function recommendationColumns(
  changes: UpdateRecommendationInput,
): Record<string, unknown> {
  const columns: Record<string, unknown> = { updatedAt: changes.updatedAt };
  if (changes.status !== undefined) columns["status"] = changes.status;
  if (changes.reviewedById !== undefined) {
    columns["reviewedById"] = changes.reviewedById;
  }
  if (changes.reviewedAt !== undefined) columns["reviewedAt"] = changes.reviewedAt;
  if (changes.resultPublicationId !== undefined) {
    columns["resultPublicationId"] = changes.resultPublicationId;
  }
  return columns;
}

function isUniqueViolation(error: unknown): boolean {
  const levels: unknown[] = [error];
  if (typeof error === "object" && error !== null) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined) levels.push(cause);
  }
  return levels.some((level) => {
    if (typeof level !== "object" || level === null) return false;
    return (level as { code?: unknown }).code === "23505";
  });
}

function claimPlan(kind: "due" | "ambiguous" | "analytics", nowIso: string, boundaryIso: string) {
  if (kind === "due") {
    return db.raw.sql`
      UPDATE "public"."publication"
      SET status = 'PUBLISHING', "updatedAt" = ${nowIso}::timestamptz
      WHERE id = (
        SELECT id FROM "public"."publication"
        WHERE status = 'QUEUED'
           OR (status = 'SCHEDULED' AND "scheduledFor" <= ${nowIso}::timestamptz)
        ORDER BY CASE WHEN status = 'QUEUED' THEN 0 ELSE 1 END ASC,
                 "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `
      .returnsRow({ id: "pg/text@1" })
      .build();
  }

  if (kind === "ambiguous") {
    return db.raw.sql`
      UPDATE "public"."publication"
      SET status = 'PUBLISHING', "updatedAt" = ${nowIso}::timestamptz
      WHERE id = (
        SELECT id FROM "public"."publication"
        WHERE status = 'AMBIGUOUS'
          AND "updatedAt" <= ${boundaryIso}::timestamptz
        ORDER BY "updatedAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `
      .returnsRow({ id: "pg/text@1" })
      .build();
  }

  return db.raw.sql`
    UPDATE "public"."publication"
    SET "analyticsClaimedAt" = ${nowIso}::timestamptz,
        "updatedAt" = ${nowIso}::timestamptz
    WHERE id = (
      SELECT id FROM "public"."publication"
      WHERE "analyticsRequestedAt" IS NOT NULL
        AND status = 'PUBLISHED'
        AND ("analyticsClaimedAt" IS NULL OR "analyticsClaimedAt" <= ${boundaryIso}::timestamptz)
      ORDER BY "analyticsRequestedAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `
    .returnsRow({ id: "pg/text@1" })
    .build();
}

export class PostgresPublishingRepository implements PublishingRepository {
  constructor(private readonly orm: PublicOrm) {}

  async createConnection(
    input: CreateConnectionInput,
  ): Promise<PublishingConnectionRecord> {
    const row = (await this.orm.PublishingConnection.create({
      id: input.id,
      projectId: input.projectId,
      createdById: input.createdById,
      providerId: input.providerId,
      externalAccountId: input.externalAccountId,
      displayName: input.displayName,
      scopes: JSON.stringify(input.scopes),
      capabilities: JSON.stringify(input.capabilities),
      status: input.status,
      credentialCiphertext: input.credentialCiphertext,
      credentialExpiresAt: input.credentialExpiresAt,
      connectedAt: input.connectedAt,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })) as unknown as ConnectionRow;
    return decodeConnection(row);
  }

  async getConnection(
    projectId: string,
    connectionId: string,
  ): Promise<PublishingConnectionRecord | null> {
    const row = (await this.orm.PublishingConnection.where({
      id: connectionId,
      projectId,
    }).first()) as ConnectionRow | null;
    return row ? decodeConnection(row) : null;
  }

  async findConnectionByAccount(
    projectId: string,
    providerId: string,
    externalAccountId: string,
  ): Promise<PublishingConnectionRecord | null> {
    const row = (await this.orm.PublishingConnection.where({
      projectId,
      providerId,
      externalAccountId,
    }).first()) as ConnectionRow | null;
    return row ? decodeConnection(row) : null;
  }

  async listConnections(projectId: string): Promise<PublishingConnectionRecord[]> {
    const rows = (await this.orm.PublishingConnection.where({ projectId })
      .orderBy((row) => row.createdAt.asc())
      .all()) as unknown as ConnectionRow[];
    return rows.map(decodeConnection);
  }

  async updateConnection(
    projectId: string,
    connectionId: string,
    changes: UpdateConnectionInput,
  ): Promise<PublishingConnectionRecord | null> {
    const row = (await this.orm.PublishingConnection.where({
      id: connectionId,
      projectId,
    }).update(connectionColumns(changes))) as ConnectionRow | null;
    return row ? decodeConnection(row) : null;
  }

  async createPublication(
    input: CreatePublicationInput,
  ): Promise<PublicationRecord> {
    const row = (await this.orm.Publication.create({
      id: input.id,
      projectId: input.projectId,
      createdById: input.createdById,
      connectionId: input.connectionId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceRevision: input.sourceRevision,
      sourceHash: input.sourceHash,
      sourceSnapshot: JSON.stringify(input.sourceSnapshot),
      title: input.title,
      content: input.content,
      status: input.status,
      idempotencyKey: input.idempotencyKey,
      scheduledFor: input.scheduledFor ?? null,
      scheduledTimezone: input.scheduledTimezone ?? null,
      validation:
        input.validation === undefined || input.validation === null
          ? null
          : JSON.stringify(input.validation),
      validatedAt: input.validatedAt ?? null,
      recommendationId: input.recommendationId ?? null,
      originPublicationId: input.originPublicationId ?? null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })) as unknown as PublicationRow;
    return decodePublication(row);
  }

  async getPublication(
    projectId: string,
    publicationId: string,
  ): Promise<PublicationRecord | null> {
    const row = (await this.orm.Publication.where({
      id: publicationId,
      projectId,
    }).first()) as PublicationRow | null;
    return row ? decodePublication(row) : null;
  }

  async listPublications(
    projectId: string,
    filter: ListPublicationsFilter = {},
  ): Promise<PublicationRecord[]> {
    const rows = (await this.orm.Publication.where({
      projectId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.sourceType ? { sourceType: filter.sourceType } : {}),
      ...(filter.sourceId ? { sourceId: filter.sourceId } : {}),
    })
      .orderBy((row) => row.createdAt.desc())
      .limit(filter.limit ?? 100)
      .all()) as unknown as PublicationRow[];
    return rows.map(decodePublication);
  }

  async updatePublication(
    projectId: string,
    publicationId: string,
    changes: UpdatePublicationInput,
  ): Promise<PublicationRecord | null> {
    const row = (await this.orm.Publication.where({
      id: publicationId,
      projectId,
    }).update(publicationColumns(changes))) as PublicationRow | null;
    return row ? decodePublication(row) : null;
  }

  async transitionPublication(
    projectId: string,
    publicationId: string,
    fromStatus: PublicationStatus,
    changes: UpdatePublicationInput,
  ): Promise<PublicationRecord | null> {
    const row = (await this.orm.Publication.where({
      id: publicationId,
      projectId,
      status: fromStatus,
    }).update(publicationColumns(changes))) as PublicationRow | null;
    return row ? decodePublication(row) : null;
  }

  async claimNextDue(nowIso: string): Promise<PublicationRecord | null> {
    return this.claimAndLoad(claimPlan("due", nowIso, nowIso));
  }

  async claimNextAmbiguous(
    coolDownBeforeIso: string,
  ): Promise<PublicationRecord | null> {
    const nowIso = new Date().toISOString();
    return this.claimAndLoad(claimPlan("ambiguous", nowIso, coolDownBeforeIso));
  }

  async claimNextAnalytics(
    nowIso: string,
    staleClaimBeforeIso: string,
  ): Promise<PublicationRecord | null> {
    return this.claimAndLoad(claimPlan("analytics", nowIso, staleClaimBeforeIso));
  }

  async recordAttempt(input: CreateAttemptInput): Promise<PublishAttemptRecord> {
    const row = (await this.orm.PublishAttempt.create({
      id: input.id,
      projectId: input.projectId,
      publicationId: input.publicationId,
      attemptNumber: input.attemptNumber,
      outcome: input.outcome,
      providerRequestId: input.providerRequestId,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      retryable: input.retryable,
      metadata: input.metadata === null ? null : JSON.stringify(input.metadata),
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    })) as unknown as AttemptRow;
    return decodeAttempt(row);
  }

  async listAttempts(
    projectId: string,
    publicationId: string,
  ): Promise<PublishAttemptRecord[]> {
    const rows = (await this.orm.PublishAttempt.where({
      projectId,
      publicationId,
    })
      .orderBy((row) => row.attemptNumber.asc())
      .all()) as unknown as AttemptRow[];
    return rows.map(decodeAttempt);
  }

  async createSnapshots(
    inputs: readonly CreateSnapshotInput[],
  ): Promise<number> {
    let stored = 0;
    for (const input of inputs) {
      const existing = await this.orm.AnalyticsSnapshot.where({
        publicationId: input.publicationId,
        metricKey: input.metricKey,
        collectedAt: input.collectedAt,
      }).first();
      if (existing) continue;
      try {
        await this.orm.AnalyticsSnapshot.create({
          id: input.id,
          projectId: input.projectId,
          publicationId: input.publicationId,
          providerId: input.providerId,
          metricKey: input.metricKey,
          value: input.value,
          unit: input.unit,
          definition: input.definition,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          asOf: input.asOf,
          collectedAt: input.collectedAt,
          provenance: input.provenance,
          completeness: input.completeness,
        });
        stored += 1;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    return stored;
  }

  async listSnapshots(
    projectId: string,
    publicationId: string,
  ): Promise<AnalyticsSnapshotRecord[]> {
    const rows = (await this.orm.AnalyticsSnapshot.where({
      projectId,
      publicationId,
    })
      .orderBy((row) => row.collectedAt.asc())
      .all()) as unknown as SnapshotRow[];
    return rows.map(decodeSnapshot);
  }

  async latestSnapshotPoints(
    projectId: string,
    publicationIds: readonly string[],
  ): Promise<AnalyticsSnapshotRecord[]> {
    if (publicationIds.length === 0) return [];
    const wanted = new Set(publicationIds);
    const rows = (await this.orm.AnalyticsSnapshot.where({ projectId })
      .orderBy((row) => row.collectedAt.asc())
      .all()) as unknown as SnapshotRow[];
    const latest = new Map<string, AnalyticsSnapshotRecord>();
    for (const row of rows) {
      if (!wanted.has(row.publicationId)) continue;
      const record = decodeSnapshot(row);
      latest.set(`${record.publicationId}:${record.metricKey}`, record);
    }
    return [...latest.values()];
  }

  async createRecommendation(
    input: CreateRecommendationInput,
  ): Promise<OptimizationRecommendationRecord> {
    const row = (await this.orm.OptimizationRecommendation.create({
      id: input.id,
      projectId: input.projectId,
      createdById: input.createdById,
      category: input.category,
      dedupeKey: input.dedupeKey,
      title: input.title,
      explanation: input.explanation,
      evidence: JSON.stringify(input.evidence),
      confidence: input.confidence,
      confidenceRationale: input.confidenceRationale,
      limitations: input.limitations,
      suggestedAction: input.suggestedAction,
      proposedChanges: JSON.stringify(input.proposedChanges),
      status: "OPEN",
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })) as unknown as RecommendationRow;
    return decodeRecommendation(row);
  }

  async findRecommendationByDedupe(
    projectId: string,
    dedupeKey: string,
  ): Promise<OptimizationRecommendationRecord | null> {
    const row = (await this.orm.OptimizationRecommendation.where({
      projectId,
      dedupeKey,
    }).first()) as RecommendationRow | null;
    return row ? decodeRecommendation(row) : null;
  }

  async getRecommendation(
    projectId: string,
    recommendationId: string,
  ): Promise<OptimizationRecommendationRecord | null> {
    const row = (await this.orm.OptimizationRecommendation.where({
      id: recommendationId,
      projectId,
    }).first()) as RecommendationRow | null;
    return row ? decodeRecommendation(row) : null;
  }

  async listRecommendations(
    projectId: string,
    filter: { status?: RecommendationStatus; limit?: number } = {},
  ): Promise<OptimizationRecommendationRecord[]> {
    const rows = (await this.orm.OptimizationRecommendation.where({
      projectId,
      ...(filter.status ? { status: filter.status } : {}),
    })
      .orderBy((row) => row.createdAt.desc())
      .limit(filter.limit ?? 100)
      .all()) as unknown as RecommendationRow[];
    return rows.map(decodeRecommendation);
  }

  async updateRecommendation(
    projectId: string,
    recommendationId: string,
    changes: UpdateRecommendationInput,
  ): Promise<OptimizationRecommendationRecord | null> {
    const row = (await this.orm.OptimizationRecommendation.where({
      id: recommendationId,
      projectId,
    }).update(recommendationColumns(changes))) as RecommendationRow | null;
    return row ? decodeRecommendation(row) : null;
  }

  private async claimAndLoad(
    plan: ReturnType<typeof claimPlan>,
  ): Promise<PublicationRecord | null> {
    const rows = (await db.runtime().query(plan)) as Array<{ id: string }>;
    const claimed = rows[0];
    if (!claimed) return null;
    const row = (await this.orm.Publication.where({
      id: claimed.id,
    }).first()) as PublicationRow | null;
    return row ? decodePublication(row) : null;
  }
}
