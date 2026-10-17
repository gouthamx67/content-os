import { describe, expect, it } from "vitest";
import {
  MINIMUM_SAMPLE_SIZE,
  confidenceForSampleSize,
  deriveEngagement,
  nextWindowOccurrence,
  suggestRecommendations,
  type CompareMetricReading,
  type PublicationMetricsSample,
} from "../domain/metrics";

function reading(
  metricKey: string,
  value: number,
  at = "2026-10-17T13:00:00.000Z",
): CompareMetricReading {
  return {
    metricKey,
    value,
    snapshotId: `${metricKey}-${value}-${at}`,
    collectedAt: at,
  };
}

function sample(
  id: string,
  publishedAt: string,
  favourites: number,
  reblogs: number,
  replies: number,
): PublicationMetricsSample {
  return {
    publicationId: id,
    publishedAt,
    readings: [
      reading("favourites", favourites),
      reading("reblogs", reblogs),
      reading("replies", replies),
    ],
  };
}

describe("engagement math", () => {
  it("sums the three provider counts when all were collected", () => {
    const engagement = deriveEngagement([
      reading("favourites", 3, "2026-10-17T13:00:00.000Z"),
      reading("reblogs", 2, "2026-10-17T13:00:05.000Z"),
      reading("replies", 1, "2026-10-17T13:00:02.000Z"),
    ]);
    expect(engagement?.value).toBe(6);
    expect(engagement?.collectedAt).toBe("2026-10-17T13:00:05.000Z");
  });

  it("returns null when a constituent metric is missing, never a partial sum", () => {
    expect(
      deriveEngagement([reading("favourites", 3), reading("reblogs", 2)]),
    ).toBeNull();
    expect(deriveEngagement([])).toBeNull();
  });
});

describe("suggestRecommendations", () => {
  it("returns nothing below the minimum sample size", () => {
    const result = suggestRecommendations([
      sample("p1", "2026-10-10T14:00:00.000Z", 5, 0, 0),
      sample("p2", "2026-10-11T14:00:00.000Z", 1, 0, 0),
    ]);
    expect(result.drafts).toEqual([]);
    expect(result.sampleSize).toBe(2);
    expect(MINIMUM_SAMPLE_SIZE).toBe(3);
  });

  it("flags a clear outlier with measured, linkable evidence", () => {
    const result = suggestRecommendations([
      sample("p1", "2026-10-10T14:00:00.000Z", 1, 0, 0),
      sample("p2", "2026-10-11T15:00:00.000Z", 1, 0, 1),
      sample("p3", "2026-10-12T16:00:00.000Z", 2, 0, 0),
      sample("p4", "2026-10-13T17:00:00.000Z", 12, 2, 1),
    ]);
    const outlier = result.drafts.find(
      (draft) => draft.category === "PERFORMANCE_OUTLIER",
    );
    expect(outlier).toBeDefined();
    expect(outlier?.dedupeKey).toBe("outlier:engagement:p4");
    expect(outlier?.evidence.observedValue).toBe(15);
    expect(outlier?.evidence.sampleSize).toBe(4);
    expect(outlier?.evidence.items.length).toBeGreaterThan(0);
    expect(outlier?.confidence).toBe("LOW");
    expect(outlier?.limitations).toContain("No causal claim is made");
  });

  it("flags a timing window only when two posts share a 2-hour bucket", () => {
    const result = suggestRecommendations([
      sample("p1", "2026-10-10T02:00:00.000Z", 1, 0, 0),
      sample("p2", "2026-10-11T03:00:00.000Z", 1, 0, 0),
      sample("p3", "2026-10-12T14:00:00.000Z", 6, 2, 0),
      sample("p4", "2026-10-13T15:30:00.000Z", 5, 2, 1),
    ]);
    const timing = result.drafts.find(
      (draft) => draft.category === "TIMING_WINDOW",
    );
    expect(timing).toBeDefined();
    expect(timing?.dedupeKey).toBe("timing:utc-14");
    expect(timing?.proposedChanges.suggestedWindowStartHourUtc).toBe(14);
    expect(timing?.proposedChanges.suggestedWindowEndHourUtc).toBe(16);
  });

  it("does not flag a window when the mean is below 1.5x the median", () => {
    const result = suggestRecommendations([
      sample("p1", "2026-10-10T14:00:00.000Z", 4, 0, 0),
      sample("p2", "2026-10-11T15:00:00.000Z", 4, 0, 0),
      sample("p3", "2026-10-12T20:00:00.000Z", 5, 0, 0),
    ]);
    expect(
      result.drafts.find((draft) => draft.category === "TIMING_WINDOW"),
    ).toBeUndefined();
  });

  it("bands confidence by sample size", () => {
    expect(confidenceForSampleSize(3)).toBe("LOW");
    expect(confidenceForSampleSize(5)).toBe("MEDIUM");
    expect(confidenceForSampleSize(9)).toBe("HIGH");
  });

  it("computes the next occurrence of a UTC window strictly in the future", () => {
    const now = "2026-10-17T14:30:00.000Z";
    const next = nextWindowOccurrence(14, now);
    expect(next).toBe("2026-10-18T14:00:00.000Z");
    const later = nextWindowOccurrence(20, now);
    expect(later).toBe("2026-10-17T20:00:00.000Z");
  });
});
