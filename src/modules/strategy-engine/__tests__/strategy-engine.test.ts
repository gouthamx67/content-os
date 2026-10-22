import { describe, expect, it } from "vitest";
import type { RecommendationContext } from "../../../core/domain/recommendation-context";
import type { OptimizationRecommendationRecord } from "../../publishing-engine/domain/types";
import { buildSocialStrategy, type StrategyPerformanceInput } from "../strategy-engine";

const NOW = "2026-10-22T12:00:00.000Z";

function feature(
  id: string,
  name: string,
  overrides: Partial<RecommendationContext["features"][number]> = {},
) {
  return {
    id,
    name,
    description: `${name} does the work in the real interface.`,
    category: "AUTOMATION",
    importance: "PRIMARY",
    confidence: 85,
    sourceIds: [`src-${id}`],
    evidenceIds: [`ev-${id}`],
    ...overrides,
  };
}

function context(
  overrides: Partial<RecommendationContext> = {},
): RecommendationContext {
  return {
    projectId: "proj-1",
    product: {
      name: "Content OS",
      description: "Turns a product link into finished launch content.",
      confidence: 90,
      category: "SaaS",
      valueProposition: "Ship a campaign from one input instead of a blank page.",
      sourceIds: ["src-product"],
      evidenceIds: ["ev-product"],
    },
    brand: null,
    features: [
      feature("formats", "Multi-format output"),
      feature("intelligence", "Product intelligence"),
    ],
    workflows: [
      {
        id: "wf-1",
        name: "Link-to-launch workflow",
        description: null,
        steps: ["Add a link", "Review the plan", "Approve the render"],
        featureIds: ["formats"],
        confidence: 80,
        sourceIds: ["src-wf"],
        evidenceIds: ["ev-wf"],
      },
    ],
    problems: [
      {
        id: "pr-1",
        name: "The blank page",
        description: null,
        confidence: 85,
        sourceIds: ["src-pr"],
        evidenceIds: ["ev-pr"],
      },
    ],
    benefits: [
      {
        id: "bn-1",
        name: "A finished campaign",
        description: null,
        confidence: 80,
        sourceIds: ["src-bn"],
        evidenceIds: ["ev-bn"],
      },
    ],
    claims: [
      {
        id: "cl-1",
        text: "Content OS generates a campaign from one product link.",
        claimType: "CAPABILITY",
        verification: "SUPPORTED",
        confidence: 90,
        sourceIds: ["src-cl"],
        evidenceIds: ["ev-cl"],
      },
      {
        id: "cl-2",
        text: "Content OS doubles reach overnight.",
        claimType: "PERFORMANCE",
        verification: "UNVERIFIED",
        confidence: 40,
        sourceIds: [],
        evidenceIds: [],
      },
    ],
    assets: [],
    audienceSignals: [
      {
        id: "au-1",
        segment: "founders and product teams",
        description: "Small teams that ship without a marketing department.",
        confidence: 80,
      },
    ],
    existingContent: [],
    channelsUsed: [],
    availablePlatforms: ["linkedin", "x", "instagram"],
    platformPriority: { linkedin: 70 },
    ...overrides,
  };
}

function performance(
  overrides: Partial<StrategyPerformanceInput> = {},
): StrategyPerformanceInput {
  return {
    publishedCount: 0,
    measuredCount: 0,
    timingRecommendations: [],
    ...overrides,
  };
}

function timingRecommendation(): OptimizationRecommendationRecord {
  return {
    id: "reco-1",
    projectId: "proj-1",
    createdById: "user-1",
    category: "TIMING_WINDOW",
    dedupeKey: "timing:utc-09",
    title: "Posts in 09:00-11:00 UTC outperform the median",
    explanation:
      "Two posts in this window average more engagement than the project median.",
    evidence: {
      comparison: "2 measured posts average 9 vs median 3",
      metricKey: "engagement",
      observedValue: 9,
      baselineValue: 3,
      baselineLabel: "median engagement across 4 posts",
      sampleSize: 4,
      items: [],
    },
    confidence: "MEDIUM",
    confidenceRationale: "MEDIUM confidence: 5-7 comparable posts.",
    limitations: "Observational comparison, not a controlled experiment.",
    suggestedAction: "Keep testing the window.",
    proposedChanges: {
      sourcePublicationId: "pub-1",
      suggestedWindowStartHourUtc: 9,
      suggestedWindowEndHourUtc: 11,
      note: "Test the window.",
    },
    status: "OPEN",
    reviewedById: null,
    reviewedAt: null,
    resultPublicationId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("buildSocialStrategy", () => {
  it("refuses to invent an audience and labels the result as a hypothesis", () => {
    const strategy = buildSocialStrategy({
      context: context({ audienceSignals: [] }),
      performance: performance(),
      now: NOW,
    });

    expect(strategy.thesis.headline).toBe("Narrow before you scale");
    expect(strategy.audience.evidenceLevel).toBe("HYPOTHESIS");
    expect(strategy.audience.missing).toContain("A named audience segment");
    expect(strategy.timing.status).toBe("EXPERIMENT");
    expect(strategy.confidence).toBe("HYPOTHESIS");
  });

  it("uses measured timing recommendations instead of generic posting advice", () => {
    const strategy = buildSocialStrategy({
      context: context(),
      performance: performance({
        publishedCount: 5,
        measuredCount: 5,
        timingRecommendations: [timingRecommendation()],
      }),
      now: NOW,
    });

    expect(strategy.timing.status).toBe("MEASURED");
    expect(strategy.timing.evidenceLevel).toBe("MEASURED");
    expect(strategy.timing.windows[0]?.label).toBe("09:00-11:00 UTC");
    expect(strategy.confidence).toBe("MEASURED");
  });

  it("never lets an unsupported claim into the strategy", () => {
    const strategy = buildSocialStrategy({
      context: context(),
      performance: performance(),
      now: NOW,
    });

    expect(JSON.stringify(strategy)).not.toContain("doubles reach overnight");
    expect(strategy.sourceSummary.supportedClaims).toBe(1);
    expect(strategy.guardrails.some((guardrail) => guardrail.title === "Claims under quarantine")).toBe(true);
  });

  it("rotates subjects and angles instead of repeating one pattern", () => {
    const strategy = buildSocialStrategy({
      context: context(),
      performance: performance(),
      now: NOW,
    });

    expect(strategy.contentSystem.plays.length).toBeGreaterThanOrEqual(3);
    const identities = strategy.contentSystem.plays.map(
      (play) => `${play.subjectLabel}|${play.angle}`,
    );
    expect(new Set(identities).size).toBe(identities.length);
    expect(new Set(strategy.contentSystem.plays.map((play) => play.subjectLabel)).size).toBeGreaterThan(1);
  });

  it("marks explicit project platforms as grounded and inferred platforms as hypotheses", () => {
    const grounded = buildSocialStrategy({
      context: context(),
      performance: performance(),
      now: NOW,
    });
    expect(grounded.platforms.every((platform) => platform.evidenceLevel === "GROUNDED")).toBe(true);

    const inferred = buildSocialStrategy({
      context: context({
        availablePlatforms: [],
        platformPriority: {},
      }),
      performance: performance(),
      now: NOW,
    });
    expect(inferred.platforms.length).toBeGreaterThan(0);
    expect(inferred.platforms.every((platform) => platform.evidenceLevel === "HYPOTHESIS")).toBe(true);
    expect(inferred.platforms[0]?.why).toContain("starting hypothesis");
  });

  it("does not manufacture advice for an empty project", () => {
    const strategy = buildSocialStrategy({
      context: context({
        product: null,
        features: [],
        workflows: [],
        problems: [],
        benefits: [],
        claims: [],
        audienceSignals: [],
        availablePlatforms: [],
        platformPriority: {},
      }),
      performance: performance(),
      now: NOW,
    });

    expect(strategy.thesis.headline).toBe("Do not make content for a product you cannot describe");
    expect(strategy.platforms).toEqual([]);
    expect(strategy.contentSystem.plays).toEqual([]);
    expect(strategy.confidence).toBe("HYPOTHESIS");
  });

  it("blocks performance claims when no readings exist", () => {
    const strategy = buildSocialStrategy({
      context: context(),
      performance: performance(),
      now: NOW,
    });

    expect(strategy.measurement.readiness).toBe("NEEDS_DATA");
    expect(strategy.guardrails.some((guardrail) => guardrail.title === "No performance promises")).toBe(true);
  });

  it("deduplicates repeated subject labels instead of repeating one idea", () => {
    const strategy = buildSocialStrategy({
      context: context({
        features: [
          feature("f-1", "One-click publish"),
          feature("f-2", "One-click publish"),
          feature("f-3", "One-click publish"),
        ],
        problems: [],
        benefits: [],
        workflows: [],
        claims: [],
        audienceSignals: [],
        availablePlatforms: ["linkedin", "x"],
        platformPriority: {},
      }),
      performance: performance(),
      now: NOW,
    });

    expect(strategy.contentSystem.plays.length).toBeLessThanOrEqual(4);
    expect(
      new Set(strategy.contentSystem.plays.map((play) => play.subjectLabel)).size,
    ).toBeGreaterThan(1);
  });

  it("does not treat document headings as product features", () => {
    const strategy = buildSocialStrategy({
      context: context({
        features: [
          feature("f-1", "What it does"),
          feature("f-2", "Workflow"),
          feature("f-3", "Proof"),
        ],
        problems: [],
        benefits: [],
        workflows: [],
        claims: [],
      }),
      performance: performance(),
      now: NOW,
    });

    expect(strategy.contentSystem.plays.every((play) => play.subjectType !== "feature")).toBe(true);
    expect(strategy.missingInputs).toContain(
      "A specific product feature (the extracted labels are section headings)",
    );
  });

  it("is deterministic for the same project data", () => {
    const input = {
      context: context(),
      performance: performance(),
      now: NOW,
    };
    expect(buildSocialStrategy(input)).toEqual(buildSocialStrategy(input));
  });
});
