import type {
  RecommendationConfidence,
  RecommendationEvidence,
  RecommendationEvidenceItem,
} from "./types";

/**
 * Metric definitions and the deterministic comparison math behind CP23
 * optimization.
 *
 * Everything here operates on readings that were actually stored in
 * `analytics_snapshot`. Nothing estimates, interpolates or back-fills: when
 * the evidence is thin the analyzer says so instead of producing a
 * recommendation.
 */

export type MetricDefinition = {
  key: string;
  unit: string;
  definition: string;
};

export const ENGAGEMENT_METRIC_KEY = "engagement";

export const PROVIDER_METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    key: "favourites",
    unit: "count",
    definition:
      "Times the provider reported the post as favourited. Lifetime total at collection time.",
  },
  {
    key: "reblogs",
    unit: "count",
    definition:
      "Times the post was boosted/reblogged. Lifetime total at collection time.",
  },
  {
    key: "replies",
    unit: "count",
    definition:
      "Replies the provider reports on the post. Lifetime total at collection time.",
  },
];

export const ENGAGEMENT_DEFINITION =
  "engagement = favourites + reblogs + replies (sum of provider-reported lifetime counts)";

export type CompareMetricReading = {
  metricKey: string;
  value: number;
  snapshotId: string;
  collectedAt: string;
};

export type PublicationMetricsSample = {
  publicationId: string;
  publishedAt: string;
  readings: CompareMetricReading[];
};

export type ComparisonPoint = {
  publicationId: string;
  publishedAt: string;
  value: number;
  readings: CompareMetricReading[];
};

export type RecommendationDraft = {
  category: "PERFORMANCE_OUTLIER" | "TIMING_WINDOW";
  dedupeKey: string;
  title: string;
  explanation: string;
  evidence: RecommendationEvidence;
  confidence: RecommendationConfidence;
  confidenceRationale: string;
  limitations: string;
  suggestedAction: string;
  proposedChanges: {
    sourcePublicationId: string;
    suggestedWindowStartHourUtc: number | null;
    suggestedWindowEndHourUtc: number | null;
    note: string;
  };
};

export const MINIMUM_SAMPLE_SIZE = 3;
export const OUTLIER_RATIO = 2;
export const OUTLIER_ABSOLUTE_GAP = 3;
export const TIMING_RATIO = 1.5;

const LIMITATIONS =
  "Observational comparison of this project's own posts, not a controlled experiment. Counts are lifetime totals as reported by the provider at collection time and may keep changing afterwards. No causal claim is made.";

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function confidenceForSampleSize(sampleSize: number): RecommendationConfidence {
  if (sampleSize >= 8) return "HIGH";
  if (sampleSize >= 5) return "MEDIUM";
  return "LOW";
}

export function confidenceRationaleFor(sampleSize: number): string {
  const confidence = confidenceForSampleSize(sampleSize);
  const bands: Record<RecommendationConfidence, string> = {
    LOW: "3-4 comparable posts; treat as an early signal",
    MEDIUM: "5-7 comparable posts; the pattern is repeated but unproven",
    HIGH: "8 or more comparable posts; the pattern is stable in this data set",
  };
  return `${confidence} confidence: ${bands[confidence]}.`;
}

/**
 * Sum of the three provider counts. Returns null unless every constituent
 * metric was actually collected — a missing metric must make the comparison
 * unavailable, never a smaller sum pretending to be complete.
 */
export function deriveEngagement(
  readings: readonly CompareMetricReading[],
): { value: number; collectedAt: string; readings: CompareMetricReading[] } | null {
  const byKey = new Map(readings.map((reading) => [reading.metricKey, reading]));
  const constituents: CompareMetricReading[] = [];
  for (const definition of PROVIDER_METRIC_DEFINITIONS) {
    const reading = byKey.get(definition.key);
    if (!reading) return null;
    constituents.push(reading);
  }
  const value = constituents.reduce((sum, reading) => sum + reading.value, 0);
  const collectedAt = constituents
    .map((reading) => reading.collectedAt)
    .sort()
    .at(-1)!;
  return { value, collectedAt, readings: constituents };
}

export function toComparisonPoint(
  sample: PublicationMetricsSample,
): ComparisonPoint | null {
  const engagement = deriveEngagement(sample.readings);
  if (!engagement) return null;
  return {
    publicationId: sample.publicationId,
    publishedAt: sample.publishedAt,
    value: engagement.value,
    readings: engagement.readings,
  };
}

function sampleItems(points: readonly ComparisonPoint[]): RecommendationEvidenceItem[] {
  return points.map((point) => ({
    publicationId: point.publicationId,
    snapshotId: null,
    metricKey: ENGAGEMENT_METRIC_KEY,
    value: point.value,
    collectedAt: point.readings.map((reading) => reading.collectedAt).sort().at(-1)!,
  }));
}

function constituentItems(point: ComparisonPoint): RecommendationEvidenceItem[] {
  return point.readings.map((reading) => ({
    publicationId: point.publicationId,
    snapshotId: reading.snapshotId,
    metricKey: reading.metricKey,
    value: reading.value,
    collectedAt: reading.collectedAt,
  }));
}

/**
 * The deterministic analyzer. Returns recommendation drafts for the current
 * sample; callers persist them idempotently by `dedupeKey`.
 */
export function suggestRecommendations(
  samples: readonly PublicationMetricsSample[],
): { drafts: RecommendationDraft[]; sampleSize: number; medianEngagement: number } {
  const points = samples
    .map(toComparisonPoint)
    .filter((point): point is ComparisonPoint => point !== null);

  if (points.length < MINIMUM_SAMPLE_SIZE) {
    return { drafts: [], sampleSize: points.length, medianEngagement: median(points.map((p) => p.value)) };
  }

  const values = points.map((point) => point.value);
  const medianValue = median(values);
  const sampleSize = points.length;
  const confidence = confidenceForSampleSize(sampleSize);
  const confidenceRationale = confidenceRationaleFor(sampleSize);
  const drafts: RecommendationDraft[] = [];

  const outlier = [...points].sort((a, b) => b.value - a.value)[0]!;
  if (
    outlier.value >= medianValue * OUTLIER_RATIO &&
    outlier.value - medianValue >= OUTLIER_ABSOLUTE_GAP &&
    medianValue >= 0
  ) {
    const evidence: RecommendationEvidence = {
      comparison: `engagement observed ${outlier.value} vs project median ${medianValue} across ${sampleSize} posts; ${ENGAGEMENT_DEFINITION}`,
      metricKey: ENGAGEMENT_METRIC_KEY,
      observedValue: outlier.value,
      baselineValue: medianValue,
      baselineLabel: `median engagement across ${sampleSize} posts`,
      sampleSize,
      items: [...constituentItems(outlier), ...sampleItems(points.filter((p) => p.publicationId !== outlier.publicationId))],
    };
    drafts.push({
      category: "PERFORMANCE_OUTLIER",
      dedupeKey: `outlier:${ENGAGEMENT_METRIC_KEY}:${outlier.publicationId}`,
      title: `Post with ${outlier.value} engagement beats the project median of ${medianValue}`,
      explanation: `One published post received ${outlier.value} combined engagements (favourites + reblogs + replies), at least ${OUTLIER_RATIO}x the median of ${medianValue} across this project's ${sampleSize} measured posts. The measured facts are listed; why it outperformed is a hypothesis, not a fact.`,
      evidence,
      confidence,
      confidenceRationale,
      limitations: LIMITATIONS,
      suggestedAction:
        "Create a draft based on this post's source and review what to reuse before validating and publishing it.",
      proposedChanges: {
        sourcePublicationId: outlier.publicationId,
        suggestedWindowStartHourUtc: null,
        suggestedWindowEndHourUtc: null,
        note: "Draft cloned from the strongest measured post for a human review pass.",
      },
    });
  }

  const buckets = new Map<number, ComparisonPoint[]>();
  for (const point of points) {
    const hour = new Date(point.publishedAt).getUTCHours();
    const bucket = Math.floor(hour / 2) * 2;
    const list = buckets.get(bucket) ?? [];
    list.push(point);
    buckets.set(bucket, list);
  }

  let bestBucket: { start: number; points: ComparisonPoint[]; meanValue: number } | null =
    null;
  for (const [start, bucketPoints] of buckets) {
    if (bucketPoints.length < 2) continue;
    const bucketMean = mean(bucketPoints.map((point) => point.value));
    if (
      bucketMean >= medianValue * TIMING_RATIO &&
      (bestBucket === null || bucketMean > bestBucket.meanValue)
    ) {
      bestBucket = { start, points: bucketPoints, meanValue: bucketMean };
    }
  }

  if (bestBucket && medianValue >= 0) {
    const top = [...bestBucket.points].sort((a, b) => b.value - a.value)[0]!;
    const end = Math.min(bestBucket.start + 2, 24);
    const evidence: RecommendationEvidence = {
      comparison: `posts published in the ${String(bestBucket.start).padStart(2, "0")}:00-${String(end).padStart(2, "0")}:00 UTC window average ${bestBucket.meanValue} engagement vs project median ${medianValue} across ${sampleSize} posts; ${ENGAGEMENT_DEFINITION}`,
      metricKey: ENGAGEMENT_METRIC_KEY,
      observedValue: bestBucket.meanValue,
      baselineValue: medianValue,
      baselineLabel: `median engagement across ${sampleSize} posts`,
      sampleSize,
      items: sampleItems(bestBucket.points),
    };
    drafts.push({
      category: "TIMING_WINDOW",
      dedupeKey: `timing:utc-${String(bestBucket.start).padStart(2, "0")}`,
      title: `Posts in ${String(bestBucket.start).padStart(2, "0")}:00-${String(end).padStart(2, "0")} UTC outperform the median`,
      explanation: `${bestBucket.points.length} posts published in this two-hour window average ${bestBucket.meanValue} engagement against a project median of ${medianValue} across ${sampleSize} measured posts. The window is a measured pattern in this data set; the cause is unknown and may be audience timezone, content mix or chance.`,
      evidence,
      confidence: bestBucket.points.length < MINIMUM_SAMPLE_SIZE ? "LOW" : confidence,
      confidenceRationale:
        bestBucket.points.length < MINIMUM_SAMPLE_SIZE
          ? `LOW confidence: only ${bestBucket.points.length} posts fall in this window; treat it as a hypothesis to test.`
          : confidenceRationale,
      limitations: LIMITATIONS,
      suggestedAction:
        "Create a draft cloned from the strongest post in the window with a schedule hint inside it, then review before publishing.",
      proposedChanges: {
        sourcePublicationId: top.publicationId,
        suggestedWindowStartHourUtc: bestBucket.start,
        suggestedWindowEndHourUtc: end,
        note: `Draft carries a UTC scheduling hint for ${String(bestBucket.start).padStart(2, "0")}:00-${String(end).padStart(2, "0")}; scheduling stays an explicit validated step.`,
      },
    });
  }

  return { drafts, sampleSize, medianEngagement: medianValue };
}

/**
 * The next occurrence of a UTC hour window, used to pre-fill a draft's
 * schedule hint. Drafts are still DRAFT: this never schedules or publishes.
 */
export function nextWindowOccurrence(
  startHourUtc: number,
  nowIso: string,
  minimumLeadMs = 30 * 60_000,
): string {
  const now = new Date(nowIso);
  const candidate = new Date(now);
  candidate.setUTCMinutes(0, 0, 0);
  candidate.setUTCHours(startHourUtc);
  if (candidate.getTime() <= now.getTime() + minimumLeadMs) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate.toISOString();
}
