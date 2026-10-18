import type { PublishingRepository } from "../../core/ports/publishing-repository";
import type {
  AnalyticsSnapshotRecord,
  PublicationRecord,
} from "./domain/types";
import {
  ENGAGEMENT_DEFINITION,
  PROVIDER_METRIC_DEFINITIONS,
  deriveEngagement,
  type CompareMetricReading,
} from "./domain/metrics";
import { PublishingError } from "./errors";
import type { PublishingProviderRegistry } from "./providers/registry";
import { ProviderError } from "./providers/ports";
import { sanitizeProviderMessage } from "./providers/http";
import type { PublishingCryptoLoad } from "./secrets";
import type { ProjectAuthorization } from "./publishing-service";

export type AnalyticsDeps = {
  repository: PublishingRepository;
  providers: PublishingProviderRegistry;
  authorizeProject: ProjectAuthorization;
  loadCrypto: () => PublishingCryptoLoad;
  newId: (prefix: string) => string;
  now: () => string;
};

export type AnalyticsMetricView = {
  snapshotId: string;
  metricKey: string;
  value: number;
  unit: string;
  definition: string;
  collectedAt: string;
  provenance: string;
};

export type AnalyticsPublicationView = {
  publicationId: string;
  title: string;
  externalUrl: string | null;
  publishedAt: string | null;
  metrics: AnalyticsMetricView[];
  engagement: { value: number; collectedAt: string; formula: string } | null;
};

export type AnalyticsOverview = {
  publications: AnalyticsPublicationView[];
  totals: {
    publishedCount: number;
    measuredCount: number;
    engagement: number | null;
  };
  lastCollectedAt: string | null;
};

export type PublicationAnalyticsHistory = {
  publication: PublicationRecord;
  snapshots: AnalyticsSnapshotRecord[];
};

export class AnalyticsService {
  constructor(private readonly deps: AnalyticsDeps) {}

  async refresh(
    userId: string,
    projectId: string,
    publicationId: string,
  ): Promise<PublicationRecord> {
    await this.deps.authorizeProject(projectId, userId);
    const publication = await this.requirePublished(projectId, publicationId);
    const now = this.deps.now();
    const updated = await this.deps.repository.updatePublication(projectId, publication.id, {
      updatedAt: now,
      analyticsRequestedAt: now,
      analyticsClaimedAt: null,
      analyticsErrorCode: null,
      analyticsErrorMessage: null,
    });
    if (!updated) throw this.notFound(publicationId);
    return updated;
  }

  async getPublicationHistory(
    userId: string,
    projectId: string,
    publicationId: string,
  ): Promise<PublicationAnalyticsHistory> {
    await this.deps.authorizeProject(projectId, userId);
    const publication = await this.requirePublication(projectId, publicationId);
    const snapshots = await this.deps.repository.listSnapshots(projectId, publicationId);
    return { publication, snapshots };
  }

  async getOverview(userId: string, projectId: string): Promise<AnalyticsOverview> {
    await this.deps.authorizeProject(projectId, userId);
    const publications = await this.deps.repository.listPublications(projectId, {
      status: "PUBLISHED",
    });

    const views: AnalyticsPublicationView[] = [];
    let measuredCount = 0;
    let engagementTotal = 0;
    let lastCollectedAt: string | null = null;

    // One read for every publication's latest-per-metric reading instead of a
    // full history read per publication inside the loop.
    const latestPoints = await this.deps.repository.latestSnapshotPoints(
      projectId,
      publications.map((publication) => publication.id),
    );
    const latestByPublication = new Map<string, AnalyticsSnapshotRecord[]>();
    for (const snapshot of latestPoints) {
      const list = latestByPublication.get(snapshot.publicationId) ?? [];
      list.push(snapshot);
      latestByPublication.set(snapshot.publicationId, list);
    }

    for (const publication of publications) {
      const latest = latestByMetric(
        latestByPublication.get(publication.id) ?? [],
      );
      const metrics: AnalyticsMetricView[] = [...latest.values()].map((snapshot) => ({
        snapshotId: snapshot.id,
        metricKey: snapshot.metricKey,
        value: snapshot.value,
        unit: snapshot.unit,
        definition: snapshot.definition,
        collectedAt: snapshot.collectedAt,
        provenance: snapshot.provenance,
      }));

      const readings: CompareMetricReading[] = [];
      for (const snapshot of latest.values()) {
        if (
          PROVIDER_METRIC_DEFINITIONS.some(
            (definition) => definition.key === snapshot.metricKey,
          )
        ) {
          readings.push({
            metricKey: snapshot.metricKey,
            value: snapshot.value,
            snapshotId: snapshot.id,
            collectedAt: snapshot.collectedAt,
          });
        }
        if (
          lastCollectedAt === null ||
          snapshot.collectedAt > lastCollectedAt
        ) {
          lastCollectedAt = snapshot.collectedAt;
        }
      }

      const engagement = deriveEngagement(readings);
      if (engagement) {
        measuredCount += 1;
        engagementTotal += engagement.value;
      }
      views.push({
        publicationId: publication.id,
        title: publication.title,
        externalUrl: publication.externalUrl,
        publishedAt: publication.publishedAt,
        metrics,
        engagement: engagement
          ? {
              value: engagement.value,
              collectedAt: engagement.collectedAt,
              formula: ENGAGEMENT_DEFINITION,
            }
          : null,
      });
    }

    return {
      publications: views,
      totals: {
        publishedCount: publications.length,
        measuredCount,
        engagement: measuredCount > 0 ? engagementTotal : null,
      },
      lastCollectedAt,
    };
  }

  /**
   * Collects one analytics refresh the worker has already claimed.
   *
   * The provider's readings are validated before anything is stored: a
   * non-finite or negative count fails the whole collection rather than
   * storing partial data under a COMPLETE label. Missing metrics stay missing —
   * nothing here writes a zero the provider did not report.
   */
  async collectClaimed(
    publication: PublicationRecord,
  ): Promise<PublicationRecord | null> {
    const projectId = publication.projectId;
    const now = this.deps.now();
    const finish = this.finishColumns(now);

    const connection = await this.deps.repository.getConnection(
      projectId,
      publication.connectionId,
    );
    if (!connection || connection.status !== "CONNECTED") {
      if (connection) {
        await this.deps.repository.updateConnection(projectId, connection.id, {
          updatedAt: now,
          status:
            connection.status === "DISCONNECTED" ? "DISCONNECTED" : "AUTH_REQUIRED",
          lastCheckedAt: now,
          lastErrorCode: "PUBLISHING_PROVIDER_AUTH",
        });
      }
      return this.deps.repository.updatePublication(projectId, publication.id, {
        ...finish,
        analyticsErrorCode: "PUBLISHING_PROVIDER_AUTH",
        analyticsErrorMessage: "The destination account is not connected.",
      });
    }

    const cryptoLoad = this.deps.loadCrypto();
    const provider = this.deps.providers.get(connection.providerId);
    if (!cryptoLoad.crypto || !provider) {
      return this.deps.repository.updatePublication(projectId, publication.id, {
        ...finish,
        analyticsErrorCode: "PUBLISHING_PROVIDER_UNAVAILABLE",
        analyticsErrorMessage: !cryptoLoad.crypto
          ? (cryptoLoad.problem ?? "Publishing secrets are unavailable.")
          : `Provider “${connection.providerId}” is not configured.`,
      });
    }

    if (!connection.credentialCiphertext || !publication.externalPostId) {
      return this.deps.repository.updatePublication(projectId, publication.id, {
        ...finish,
        analyticsErrorCode: "PUBLISHING_PROVIDER_AUTH",
        analyticsErrorMessage: !publication.externalPostId
          ? "The publication has no external post id to collect analytics for."
          : "The stored credential is missing; reconnect the account.",
      });
    }

    let credential: string;
    try {
      credential = cryptoLoad.crypto.box.open(connection.credentialCiphertext);
    } catch {
      return this.deps.repository.updatePublication(projectId, publication.id, {
        ...finish,
        analyticsErrorCode: "PUBLISHING_SECRETS_UNAVAILABLE",
        analyticsErrorMessage: "The stored credential could not be decrypted.",
      });
    }

    try {
      const readings = await provider.fetchMetrics(
        credential,
        publication.externalPostId,
      );
      const invalid = readings.filter(
        (reading) =>
          !Number.isFinite(reading.value) ||
          !Number.isInteger(reading.value) ||
          reading.value < 0,
      );
      if (invalid.length > 0) {
        return this.deps.repository.updatePublication(projectId, publication.id, {
          ...finish,
          analyticsErrorCode: "ANALYTICS_INVALID_METRICS",
          analyticsErrorMessage: `The provider returned invalid readings for ${invalid
            .map((reading) => reading.metricKey)
            .join(", ")}; nothing was stored.`,
        });
      }

      const stored = await this.deps.repository.createSnapshots(
        readings.map((reading) => ({
          id: this.deps.newId("snap"),
          projectId,
          publicationId: publication.id,
          providerId: provider.id,
          metricKey: reading.metricKey,
          value: reading.value,
          unit: reading.unit,
          definition: reading.definition,
          windowStart: reading.windowStart,
          windowEnd: reading.windowEnd,
          asOf: reading.asOf,
          collectedAt: now,
          provenance: reading.provenance,
          completeness: reading.completeness,
        })),
      );

      const collectedAt = stored > 0 ? now : publication.analyticsCollectedAt;
      return this.deps.repository.updatePublication(projectId, publication.id, {
        ...finish,
        analyticsCollectedAt: collectedAt,
      });
    } catch (error) {
      const providerError = error instanceof ProviderError ? error : null;
      const auth = providerError?.failure.kind === "AUTH";
      if (auth) {
        await this.deps.repository.updateConnection(projectId, connection.id, {
          updatedAt: now,
          status: "AUTH_REQUIRED",
          lastCheckedAt: now,
          lastErrorCode: "PUBLISHING_PROVIDER_AUTH",
        });
      }
      return this.deps.repository.updatePublication(projectId, publication.id, {
        ...finish,
        analyticsErrorCode: auth ? "PUBLISHING_PROVIDER_AUTH" : "PUBLISHING_NETWORK_ERROR",
        analyticsErrorMessage: sanitizeProviderMessage(
          providerError?.failure.message ??
            (error instanceof Error ? error.message : "The analytics request failed."),
        ),
      });
    }
  }

  private finishColumns(now: string): {
    updatedAt: string;
    analyticsRequestedAt: null;
    analyticsClaimedAt: null;
  } {
    return {
      updatedAt: now,
      analyticsRequestedAt: null,
      analyticsClaimedAt: null,
    };
  }

  private async requirePublication(
    projectId: string,
    publicationId: string,
  ): Promise<PublicationRecord> {
    const publication = await this.deps.repository.getPublication(
      projectId,
      publicationId,
    );
    if (!publication) throw this.notFound(publicationId);
    return publication;
  }

  private async requirePublished(
    projectId: string,
    publicationId: string,
  ): Promise<PublicationRecord> {
    const publication = await this.requirePublication(projectId, publicationId);
    if (publication.status !== "PUBLISHED") {
      throw new PublishingError(
        "ANALYTICS_NOT_AVAILABLE",
        `Only a published post has provider analytics; this publication is ${publication.status}.`,
      );
    }
    return publication;
  }

  private notFound(publicationId: string): PublishingError {
    return new PublishingError(
      "PUBLICATION_NOT_FOUND",
      `Publication ${publicationId} was not found in this project.`,
    );
  }
}

function latestByMetric(
  snapshots: readonly AnalyticsSnapshotRecord[],
): Map<string, AnalyticsSnapshotRecord> {
  const latest = new Map<string, AnalyticsSnapshotRecord>();
  for (const snapshot of snapshots) {
    const existing = latest.get(snapshot.metricKey);
    if (!existing || snapshot.collectedAt > existing.collectedAt) {
      latest.set(snapshot.metricKey, snapshot);
    }
  }
  return latest;
}
