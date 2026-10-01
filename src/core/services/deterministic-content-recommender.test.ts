import { describe, expect, it } from "vitest";
import type { RecommendationContext } from "../domain/recommendation-context";
import { createCandidates, generateOpportunities } from "./deterministic-content-recommender";
import { ContentRecommendationValidator } from "./content-recommendation-validator";
import { analyzeContentHistory } from "./content-history-analyzer";
import { detectContentGaps, detectPlatformGaps } from "./content-gap-detector";
import { diversifyByChannel } from "./recommendation-diversity";

const NOW = "2026-01-01T00:00:00.000Z";

function baseContext(overrides: Partial<RecommendationContext> = {}): RecommendationContext {
  return {
    projectId: "proj-1",
    product: {
      name: "Content OS",
      description: "Plans content from product intelligence.",
      confidence: 90,
      category: "SaaS",
      valueProposition: "Ship content grounded in real product data.",
      sourceIds: ["src-product"],
      evidenceIds: [],
    },
    brand: null,
    features: [],
    workflows: [],
    problems: [],
    benefits: [],
    claims: [],
    assets: [],
    audienceSignals: [],
    existingContent: [],
    channelsUsed: [],
    availablePlatforms: ["youtube", "linkedin", "instagram", "tiktok", "x", "website"],
    platformPriority: {},
    ...overrides,
  };
}

const feature = (id: string, name: string, overrides: Partial<RecommendationContext["features"][number]> = {}) => ({
  id,
  name,
  description: null,
  category: "ANALYTICS",
  importance: "PRIMARY",
  confidence: 90,
  sourceIds: [`src-${id}`],
  evidenceIds: [`ev-${id}`],
  ...overrides,
});

describe("createCandidates", () => {
  it("produces nothing for a project with no intelligence at all", () => {
    expect(createCandidates(baseContext({ product: null }))).toEqual([]);
  });

  it("recommends per feature instead of collapsing onto the first", () => {
    const context = baseContext({
      features: [feature("analytics", "Analytics"), feature("integrations", "Integrations")],
    });

    const candidates = createCandidates(context);
    const demoSubjects = new Set(
      candidates
        .filter((candidate) => candidate.template.contentTypeId === "video.product_demo")
        .map((candidate) => candidate.subjectId),
    );

    expect(demoSubjects.size).toBeGreaterThan(1);
    expect(demoSubjects).toContain("analytics");
    expect(demoSubjects).toContain("integrations");
  });

  it("never grounds an opportunity in an unverified or contradicted claim", () => {
    // Guards the rule for every template, present and future: only a SUPPORTED
    // claim may become a recommendation.
    const context = baseContext({
      features: [feature("analytics", "Analytics")],
      claims: [
        {
          id: "claim-ok",
          text: "Content OS generates drafts from product intelligence.",
          claimType: "CAPABILITY",
          verification: "SUPPORTED",
          confidence: 90,
          sourceIds: [],
          evidenceIds: ["ev-1"],
        },
        {
          id: "claim-weak",
          text: "Content OS doubles engagement.",
          claimType: "PERFORMANCE",
          verification: "UNVERIFIED",
          confidence: 60,
          sourceIds: [],
          evidenceIds: [],
        },
        {
          id: "claim-bad",
          text: "Content OS is the fastest tool available.",
          claimType: "PERFORMANCE",
          verification: "CONTRADICTED",
          confidence: 60,
          sourceIds: [],
          evidenceIds: ["ev-3"],
        },
      ],
    });

    const subjects = createCandidates(context)
      .filter((candidate) => candidate.subjectType === "CLAIM")
      .map((candidate) => candidate.subjectId);

    expect(subjects).not.toContain("claim-weak");
    expect(subjects).not.toContain("claim-bad");
  });

  it("skips a template whose platforms the project cannot use", () => {
    const context = baseContext({
      features: [feature("analytics", "Analytics")],
      availablePlatforms: ["email"],
    });

    expect(createCandidates(context)).toEqual([]);
  });

  it("reports missing evidence as a gap rather than hiding the recommendation", () => {
    const context = baseContext({
      features: [feature("new-thing", "New Thing", { sourceIds: [], evidenceIds: [] })],
    });

    const candidates = createCandidates(context);
    const first = candidates.find((candidate) => candidate.subjectId === "new-thing");

    expect(first).toBeDefined();
    expect(first?.missingInputs.join(" ")).toContain("Evidence");
  });

  it("does not produce the same identity twice", () => {
    const context = baseContext({
      features: [feature("analytics", "Analytics")],
      product: {
        name: "Content OS",
        description: null,
        confidence: 90,
        category: null,
        valueProposition: null,
        sourceIds: [],
        evidenceIds: [],
      },
    });

    const identities = createCandidates(context).map(
      (candidate) =>
        `${candidate.template.contentTypeId}|${candidate.subjectId}|${candidate.platform}`,
    );

    expect(new Set(identities).size).toBe(identities.length);
  });

  it("is deterministic for the same context", () => {
    const context = baseContext({
      features: [feature("analytics", "Analytics"), feature("exports", "Exports")],
      workflows: [
        { id: "wf-1", name: "Launch Workflow", description: null, steps: ["a"], featureIds: ["analytics"], confidence: 90, sourceIds: [], evidenceIds: ["ev-1"] },
      ],
      problems: [
        { id: "pr-1", name: "Repetitive briefs", description: null, confidence: 90, sourceIds: [], evidenceIds: ["ev-2"] },
      ],
      availablePlatforms: ["youtube", "linkedin", "instagram", "x"],
    });

    expect(createCandidates(context)).toEqual(createCandidates(context));
  });
});

describe("generateOpportunities", () => {
  it("passes its own validator", () => {
    const context = baseContext({
      features: [feature("analytics", "Analytics"), feature("exports", "Exports")],
      workflows: [
        { id: "wf-1", name: "Launch Workflow", description: null, steps: ["a", "b"], featureIds: ["analytics"], confidence: 90, sourceIds: [], evidenceIds: ["ev-1"] },
      ],
      problems: [
        { id: "pr-1", name: "Repetitive briefs", description: null, confidence: 90, sourceIds: [], evidenceIds: ["ev-2"] },
      ],
      benefits: [
        { id: "bn-1", name: "Less repetitive work", description: null, confidence: 80, sourceIds: [], evidenceIds: ["ev-3"] },
      ],
    });

    const opportunities = generateOpportunities({ context, now: NOW });
    const result = new ContentRecommendationValidator().validate(opportunities, context);

    expect(result.issues).toEqual([]);
    expect(opportunities.length).toBeGreaterThan(0);
  });

  it("separates real source documents from the intelligence entity they came from", () => {
    const context = baseContext({ features: [feature("analytics", "Analytics")] });

    const opportunity = generateOpportunities({ context, now: NOW }).find(
      (item) => item.subjectId === "analytics",
    );

    // The feature is grounded by a Source document and a CP06 evidence row. The
    // feature's own id is neither: it is the subject, and putting it in
    // sourceIds would claim a document that does not exist.
    expect(opportunity?.evidence.sourceIds).toEqual(["src-analytics"]);
    expect(opportunity?.evidence.sourceIds).not.toContain("analytics");
    expect(opportunity?.evidence.evidenceIds).toContain("ev-analytics");
  });

  it("gives every opportunity at least one reason to show a user", () => {
    const context = baseContext({ features: [feature("analytics", "Analytics")] });

    for (const opportunity of generateOpportunities({ context, now: NOW })) {
      expect(opportunity.reasons.length).toBeGreaterThan(0);
      expect(opportunity.title.length).toBeGreaterThan(0);
      expect(opportunity.rationale.length).toBeGreaterThan(0);
    }
  });
});

describe("ContentRecommendationValidator", () => {
  const validator = new ContentRecommendationValidator();

  it("rejects an unknown content type", () => {
    const context = baseContext();
    const opportunity = {
      ...generateOpportunities({
        context: baseContext({ features: [feature("a", "A")] }),
        now: NOW,
      })[0]!,
      id: "rec-1",
      contentTypeId: "video.made_up",
    };

    const { issues } = validator.validate([opportunity], context);
    expect(issues.map((issue) => issue.rule)).toContain("UNKNOWN_CONTENT_TYPE");
  });

  it("rejects a subject the project does not have", () => {
    const context = baseContext();
    const template = generateOpportunities({
      context: baseContext({ features: [feature("a", "A")] }),
      now: NOW,
    })[0]!;

    const opportunity = { ...template, id: "rec-1", subjectId: "invented-feature" };
    const { issues } = validator.validate([opportunity], context);

    expect(issues.map((issue) => issue.rule)).toContain("UNGROUNDED_SUBJECT");
  });

  it("rejects an unsupported claim", () => {
    const context = baseContext({
      claims: [
        {
          id: "claim-weak",
          text: "Doubles engagement.",
          claimType: "PERFORMANCE",
          verification: "UNVERIFIED",
          confidence: 60,
          sourceIds: [],
          evidenceIds: [],
        },
      ],
    });

    const opportunity = {
      ...generateOpportunities({
        context: baseContext({ features: [feature("a", "A")] }),
        now: NOW,
      })[0]!,
      id: "rec-1",
      subjectType: "CLAIM" as const,
      subjectId: "claim-weak",
    };

    const { issues } = validator.validate([opportunity], context);
    expect(issues.map((issue) => issue.rule)).toContain("UNSUPPORTED_CLAIM");
  });

  it("rejects a recommendation with no reason", () => {
    const context = baseContext({ features: [feature("a", "A")] });
    const opportunity = {
      ...generateOpportunities({ context, now: NOW })[0]!,
      id: "rec-1",
      reasons: [],
    };

    const { issues } = validator.validate([opportunity], context);
    expect(issues.map((issue) => issue.rule)).toContain("MISSING_REASON");
  });

  it("rejects a platform the content type does not support", () => {
    const context = baseContext({
      product: { name: "Content OS", description: null, confidence: 90, category: null, valueProposition: null , sourceIds: [], evidenceIds: [] },
      availablePlatforms: ["product_hunt", "linkedin"],
    });

    const opportunity = generateOpportunities({ context, now: NOW }).find(
      (item) => item.contentTypeId === "video.product_demo",
    )!;
    opportunity.platform = "product_hunt";

    const { issues } = validator.validate([opportunity], context);
    expect(issues.map((issue) => issue.rule)).toContain("PLATFORM_NOT_SUPPORTED");
  });
});

describe("analyzeContentHistory", () => {
  it("reports which content types and subjects are already covered", () => {
    const context = baseContext({
      existingContent: [
        {
          id: "intent-1",
          contentTypeId: "video.product_demo",
          platformIds: ["linkedin"],
          subjectIds: ["analytics"],
          createdAt: NOW,
        },
      ],
    });

    const history = analyzeContentHistory(context, ["video.product_demo", "image.carousel"]);

    expect(history.coveredContentTypes).toEqual(["video.product_demo"]);
    expect(history.missingContentTypes).toEqual(["image.carousel"]);
    expect(history.isCovered(["analytics"], "video.product_demo")).toBe(true);
    expect(history.isCovered(["analytics"], "image.carousel")).toBe(false);
    expect(history.isCovered(["exports"], "video.product_demo")).toBe(false);
  });
});

describe("detectContentGaps", () => {
  it("suggests a content type the project has never used", () => {
    const context = baseContext({
      channelsUsed: ["VIDEO"],
      existingContent: [
        { id: "i-1", contentTypeId: "video.product_demo", platformIds: ["youtube"], subjectIds: [], createdAt: NOW },
      ],
    });
    const history = analyzeContentHistory(context, []);

    const gaps = detectContentGaps(context, history);
    expect(gaps.map((gap) => gap.contentTypeId)).toContain("image.carousel");
  });

  it("reports platforms the project has not published to", () => {
    const context = baseContext({
      availablePlatforms: ["youtube", "linkedin"],
      existingContent: [
        { id: "i-1", contentTypeId: "video.product_demo", platformIds: ["youtube"], subjectIds: [], createdAt: NOW },
      ],
    });

    expect(detectPlatformGaps(context)).toEqual(["linkedin"]);
  });
});

describe("diversifyByChannel", () => {
  it("prefers channel variety over pure rank", () => {
    const ranked = [
      { channel: "VIDEO" as const, priorityScore: 90 },
      { channel: "VIDEO" as const, priorityScore: 89 },
      { channel: "IMAGE" as const, priorityScore: 60 },
    ];

    const { selected } = diversifyByChannel(ranked, 2);

    expect(selected.map((item) => item.channel)).toEqual(["VIDEO", "IMAGE"]);
  });

  it("keeps quality when a channel is much better", () => {
    const ranked = [
      { channel: "VIDEO" as const, priorityScore: 95 },
      { channel: "VIDEO" as const, priorityScore: 94 },
      { channel: "TEXT" as const, priorityScore: 30 },
    ];

    const { selected } = diversifyByChannel(ranked, 3);

    expect(selected.map((item) => item.channel)).toEqual(["VIDEO", "VIDEO", "TEXT"]);
  });

  it("never returns more than requested", () => {
    const ranked = Array.from({ length: 20 }, (_, index) => ({
      channel: "VIDEO" as const,
      priorityScore: 100 - index,
    }));

    expect(diversifyByChannel(ranked, 5).selected).toHaveLength(5);
  });
});

describe("product grounding is never overstated or understated", () => {
  it("counts a cited product as grounded instead of asserting it has no evidence", () => {
    const cited = generateOpportunities({
      context: baseContext(),
      now: NOW,
    }).filter((o) => o.subjectType === "PRODUCT");

    expect(cited.length).toBeGreaterThan(0);
    for (const opportunity of cited) {
      expect(opportunity.evidence.sourceIds).toContain("src-product");
      // The reason must not claim the product is uncited while its source is
      // attached: a user reading both would rightly distrust the panel.
      expect(opportunity.reasons.join(" ")).not.toMatch(
        /asserted without supporting evidence/i,
      );
      expect(opportunity.reasons.join(" ")).toMatch(/backed by \d+ grounding record/i);
    }
  });

  it("still says so when the product genuinely has no provenance", () => {
    const uncited = generateOpportunities({
      context: baseContext({
        product: {
          name: "Content OS",
          description: null,
          confidence: 90,
          category: null,
          valueProposition: null,
          sourceIds: [],
          evidenceIds: [],
        },
      }),
      now: NOW,
    }).filter((o) => o.subjectType === "PRODUCT");

    expect(uncited.length).toBeGreaterThan(0);
    expect(uncited[0].reasons.join(" ")).toMatch(
      /asserted without supporting evidence/i,
    );
  });
});
