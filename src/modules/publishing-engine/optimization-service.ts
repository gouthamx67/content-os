import type { PublishingRepository } from "../../core/ports/publishing-repository";
import type {
  AnalyticsSnapshotRecord,
  OptimizationRecommendationRecord,
  PublicationRecord,
  RecommendationEvidence,
  RecommendationStatus,
} from "./domain/types";
import type { PublicationMetricsSample as MetricsSample } from "./domain/metrics";
import {
  MINIMUM_SAMPLE_SIZE,
  PROVIDER_METRIC_DEFINITIONS,
  suggestRecommendations,
} from "./domain/metrics";
import { PublishingError } from "./errors";
import type { ProjectAuthorization } from "./publishing-service";

export type OptimizationDeps = {
  repository: PublishingRepository;
  authorizeProject: ProjectAuthorization;
  newId: (prefix: string) => string;
  now: () => string;
};

export type GenerateRecommendationsResult = {
  created: OptimizationRecommendationRecord[];
  refreshed: OptimizationRecommendationRecord[];
  skipped: number;
  sampleSize: number;
  medianEngagement: number;
  minimumSampleSize: number;
};

export type AcceptResult = {
  recommendation: OptimizationRecommendationRecord;
  publication: PublicationRecord;
};

const RECENT_PUBLICATION_LIMIT = 100;
const SAMPLE_LIMIT = 50;

export class OptimizationService {
  constructor(private readonly deps: OptimizationDeps) {}

  async listRecommendations(
    userId: string,
    projectId: string,
    filter?: { status?: RecommendationStatus; limit?: number },
  ): Promise<OptimizationRecommendationRecord[]> {
    await this.deps.authorizeProject(projectId, userId);
    return this.deps.repository.listRecommendations(projectId, filter);
  }

  /**
   * Runs the deterministic analyzer over the project's own stored readings.
   *
   * Drafts are persisted idempotently by `dedupeKey`: an OPEN or ACCEPTED
   * recommendation is left alone, and a DISMISSED one is only revived when the
   * evidence material actually changed. Below the minimum sample size nothing
   * is written at all — the caller gets the honest count instead.
   */
  async generate(
    userId: string,
    projectId: string,
  ): Promise<GenerateRecommendationsResult> {
    await this.deps.authorizeProject(projectId, userId);
    const publications = (
      await this.deps.repository.listPublications(projectId, {
        status: "PUBLISHED",
        limit: RECENT_PUBLICATION_LIMIT,
      })
    ).slice(0, SAMPLE_LIMIT);

    const samples: MetricsSample[] = [];
    for (const publication of publications) {
      if (!publication.publishedAt) continue;
      const snapshots = await this.deps.repository.latestSnapshotPoints(
        projectId,
        [publication.id],
      );
      const latest = latestByMetric(snapshots);
      samples.push({
        publicationId: publication.id,
        publishedAt: publication.publishedAt,
        readings: [...latest.values()]
          .filter((snapshot) =>
            PROVIDER_METRIC_DEFINITIONS.some(
              (definition) => definition.key === snapshot.metricKey,
            ),
          )
          .map((snapshot) => ({
            metricKey: snapshot.metricKey,
            value: snapshot.value,
            snapshotId: snapshot.id,
            collectedAt: snapshot.collectedAt,
          })),
      });
    }

    const analysis = suggestRecommendations(samples);
    if (analysis.sampleSize < MINIMUM_SAMPLE_SIZE) {
      throw new PublishingError(
        "OPTIMIZATION_INSUFFICIENT_EVIDENCE",
        `Only ${analysis.sampleSize} published post(s) have complete engagement readings; ${MINIMUM_SAMPLE_SIZE} are required before comparing performance.`,
        { sampleSize: analysis.sampleSize, minimumSampleSize: MINIMUM_SAMPLE_SIZE },
      );
    }

    const created: OptimizationRecommendationRecord[] = [];
    const refreshed: OptimizationRecommendationRecord[] = [];
    let skipped = 0;
    const now = this.deps.now();

    for (const draft of analysis.drafts) {
      const existing = await this.deps.repository.findRecommendationByDedupe(
        projectId,
        draft.dedupeKey,
      );
      if (!existing) {
        created.push(
          await this.deps.repository.createRecommendation({
            id: this.deps.newId("reco"),
            projectId,
            createdById: userId,
            category: draft.category,
            dedupeKey: draft.dedupeKey,
            title: draft.title,
            explanation: draft.explanation,
            evidence: draft.evidence,
            confidence: draft.confidence,
            confidenceRationale: draft.confidenceRationale,
            limitations: draft.limitations,
            suggestedAction: draft.suggestedAction,
            proposedChanges: draft.proposedChanges,
            createdAt: now,
            updatedAt: now,
          }),
        );
        continue;
      }

      if (existing.status !== "DISMISSED") {
        skipped += 1;
        continue;
      }

      if (evidenceFingerprint(existing.evidence) === evidenceFingerprint(draft.evidence)) {
        skipped += 1;
        continue;
      }

      const revived = await this.deps.repository.updateRecommendation(
        projectId,
        existing.id,
        {
          updatedAt: now,
          status: "OPEN",
          reviewedById: null,
          reviewedAt: null,
          resultPublicationId: null,
        },
      );
      if (revived) refreshed.push(revived);
    }

    return {
      created,
      refreshed,
      skipped,
      sampleSize: analysis.sampleSize,
      medianEngagement: analysis.medianEngagement,
      minimumSampleSize: MINIMUM_SAMPLE_SIZE,
    };
  }

  /**
   * Accepting produces a new DRAFT cloned from the recommendation's source
   * publication. It never validates, schedules or publishes: those remain
   * separate, explicit steps the human takes afterwards.
   */
  async accept(
    userId: string,
    projectId: string,
    recommendationId: string,
  ): Promise<AcceptResult> {
    await this.deps.authorizeProject(projectId, userId);
    const recommendation = await this.requireOpen(projectId, recommendationId);
    const source = await this.deps.repository.getPublication(
      projectId,
      recommendation.proposedChanges.sourcePublicationId,
    );
    if (!source) {
      throw new PublishingError(
        "OPTIMIZATION_NO_SOURCE",
        "The publication this recommendation was based on no longer exists.",
      );
    }

    const now = this.deps.now();
    const draft = await this.deps.repository.createPublication({
      id: this.deps.newId("pub"),
      projectId,
      createdById: userId,
      connectionId: source.connectionId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceRevision: source.sourceRevision,
      sourceHash: source.sourceHash,
      sourceSnapshot: source.sourceSnapshot,
      title: source.title,
      content: source.content,
      status: "DRAFT",
      idempotencyKey: this.deps.newId("pubidem"),
      recommendationId: recommendation.id,
      originPublicationId: source.id,
      createdAt: now,
      updatedAt: now,
    });

    const accepted = await this.deps.repository.updateRecommendation(
      projectId,
      recommendation.id,
      {
        updatedAt: now,
        status: "ACCEPTED",
        reviewedById: userId,
        reviewedAt: now,
        resultPublicationId: draft.id,
      },
    );
    if (!accepted) throw this.alreadyReviewed();
    return { recommendation: accepted, publication: draft };
  }

  async dismiss(
    userId: string,
    projectId: string,
    recommendationId: string,
  ): Promise<OptimizationRecommendationRecord> {
    await this.deps.authorizeProject(projectId, userId);
    await this.requireOpen(projectId, recommendationId);
    const now = this.deps.now();
    const dismissed = await this.deps.repository.updateRecommendation(
      projectId,
      recommendationId,
      {
        updatedAt: now,
        status: "DISMISSED",
        reviewedById: userId,
        reviewedAt: now,
      },
    );
    if (!dismissed) throw this.alreadyReviewed();
    return dismissed;
  }

  private async requireOpen(
    projectId: string,
    recommendationId: string,
  ): Promise<OptimizationRecommendationRecord> {
    const recommendation = await this.deps.repository.getRecommendation(
      projectId,
      recommendationId,
    );
    if (!recommendation) {
      throw new PublishingError(
        "RECOMMENDATION_NOT_FOUND",
        `Recommendation ${recommendationId} was not found in this project.`,
      );
    }
    if (recommendation.status !== "OPEN") {
      throw this.alreadyReviewed();
    }
    return recommendation;
  }

  private alreadyReviewed(): PublishingError {
    return new PublishingError(
      "OPTIMIZATION_ALREADY_REVIEWED",
      "This recommendation was already reviewed; reload the list.",
    );
  }
}

/**
 * Two evidence sets are the "same" when the measured values behind them are
 * unchanged. Counts moving or the sample changing is a real change and revives
 * a dismissed recommendation; anything else leaves the dismissal alone.
 */
function evidenceFingerprint(evidence: RecommendationEvidence): string {
  return JSON.stringify({
    metricKey: evidence.metricKey,
    observedValue: evidence.observedValue,
    baselineValue: evidence.baselineValue,
    sampleSize: evidence.sampleSize,
    items: evidence.items
      .map((item) => ({
        publicationId: item.publicationId,
        metricKey: item.metricKey,
        value: item.value,
      }))
      .sort((a, b) =>
        `${a.publicationId}:${a.metricKey}`.localeCompare(
          `${b.publicationId}:${b.metricKey}`,
        ),
      ),
  });
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
