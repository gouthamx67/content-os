import { describe, expect, it } from "vitest";
import { AiContentRecommendationRefiner } from "./content-recommendation-interpreter";
import { RecommendationError, type ContentOpportunity } from "../../core/domain/content-opportunity";
import type { AIProvider } from "../../core/ports/ai-provider";
import type { RecommendationContext } from "../../core/domain/recommendation-context";

function candidate(overrides: Partial<ContentOpportunity> = {}): ContentOpportunity {
  return {
    id: "",
    key: "image.carousel|WORKFLOW|id:workflow-1|linkedin",
    projectId: "project-1",
    templateId: "workflow_carousel",
    contentTypeId: "image.carousel",
    channel: "IMAGE",
    platform: "linkedin",
    subjectType: "WORKFLOW",
    subjectId: "workflow-1",
    subjectLabel: "Onboarding",
    title: "Carousel about Onboarding",
    rationale: "Your onboarding workflow has no visual yet.",
    reasons: ["No carousel covers Onboarding"],
    missingInputs: [],
    priorityScore: 0.71,
    evidence: { sourceIds: ["src-1"], evidenceIds: ["ev-1"], entityIds: ["workflow-1"] },
    status: "ACTIVE",
    selectedIntentId: null,
    dismissedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const context = {
  projectId: "project-1",
  product: {
    name: "Northwind Analytics",
    description: null,
    confidence: 80,
    category: null,
    valueProposition: "One place for regulated content",
  },
  brand: null,
  features: [],
  workflows: [{ id: "workflow-1", name: "Onboarding", description: null }],
  problems: [],
  benefits: [],
  claims: [],
  assets: [],
  audienceSignals: [],
  existingContent: [],
  availablePlatforms: ["linkedin"],
  platformPriority: {},
} as unknown as RecommendationContext;

/** A provider that returns canned text, so the refiner's parsing is the subject. */
function providerReturning(text: string): AIProvider {
  return {
    async generate() {
      return { text, model: "test-model" };
    },
  } as unknown as AIProvider;
}

describe("AI recommendation refinement", () => {
  it("applies a reword to the same grounded item", async () => {
    const refiner = new AiContentRecommendationRefiner(
      providerReturning(
        JSON.stringify([
          {
            key: "image.carousel|WORKFLOW|id:workflow-1|linkedin",
            title: "How Onboarding works, step by step",
            rationale: "Onboarding is your most-used workflow and has no visual yet.",
            reasons: ["Most-used workflow", "No carousel covers it"],
          },
        ]),
      ),
    );

    const refined = await refiner.refine(context, [candidate()]);

    expect(refined).toHaveLength(1);
    expect(refined[0].title).toBe("How Onboarding works, step by step");
    expect(refined[0].reasons).toEqual(["Most-used workflow", "No carousel covers it"]);
  });

  /**
   * The reword is the model's only licence. Everything that decided the item was
   * grounded — the score, the subject, the evidence, the channel — has to come
   * back untouched, or a clear sentence would be covering a moved claim.
   */
  it("cannot move the grounding of an item it rewords", async () => {
    const refiner = new AiContentRecommendationRefiner(
      providerReturning(
        JSON.stringify([{ key: "image.carousel|WORKFLOW|id:workflow-1|linkedin", title: "Sharper", rationale: "Because X" }]),
      ),
    );

    const refined = await refiner.refine(context, [candidate()]);

    expect(refined[0]).toMatchObject({
      priorityScore: 0.71,
      subjectType: "WORKFLOW",
      subjectId: "workflow-1",
      evidence: {
        sourceIds: ["src-1"],
        evidenceIds: ["ev-1"],
        entityIds: ["workflow-1"],
      },
      channel: "IMAGE",
      platform: "linkedin",
      contentTypeId: "image.carousel",
      key: "image.carousel|WORKFLOW|id:workflow-1|linkedin",
      id: "",
    });
  });

  it("keeps the deterministic wording for fields the model omitted", async () => {
    const refiner = new AiContentRecommendationRefiner(
      providerReturning(JSON.stringify([{ key: "image.carousel|WORKFLOW|id:workflow-1|linkedin", title: "Sharper" }])),
    );

    const refined = await refiner.refine(context, [candidate()]);

    expect(refined[0].title).toBe("Sharper");
    expect(refined[0].rationale).toBe(
      "Your onboarding workflow has no visual yet.",
    );
    expect(refined[0].reasons).toEqual(["No carousel covers Onboarding"]);
  });

  it("reorders by returning the items in a new order", async () => {
    const refiner = new AiContentRecommendationRefiner(
      providerReturning(
        JSON.stringify([
          { key: "image.carousel|WORKFLOW|id:workflow-2|linkedin", title: "Second first" },
          { key: "image.carousel|WORKFLOW|id:workflow-1|linkedin", title: "First second" },
        ]),
      ),
    );

    const refined = await refiner.refine(context, [
      candidate(),
      candidate({ key: "image.carousel|WORKFLOW|id:workflow-2|linkedin", subjectId: "workflow-2" }),
    ]);

    expect(refined.map((item) => item.key)).toEqual([
      "image.carousel|WORKFLOW|id:workflow-2|linkedin",
      "image.carousel|WORKFLOW|id:workflow-1|linkedin",
    ]);
  });

  it("refuses a key that was not a candidate, so a batch cannot smuggle one in", async () => {
    const refiner = new AiContentRecommendationRefiner(
      providerReturning(
        JSON.stringify([{ key: "made.up|WORKFLOW|id:nope|linkedin", title: "A brand new idea" }]),
      ),
    );

    await expect(refiner.refine(context, [candidate()])).rejects.toThrowError(
      RecommendationError,
    );
  });

  it("refuses a batch that tries to reword a grounding field", async () => {
    const refiner = new AiContentRecommendationRefiner(
      providerReturning(
        JSON.stringify([{ key: "image.carousel|WORKFLOW|id:workflow-1|linkedin", subjectType: "CLAIM", subjectId: "claim-9" }]),
      ),
    );

    await expect(refiner.refine(context, [candidate()])).rejects.toThrowError(
      /may not change "subjectType"/,
    );
  });

  it("reads JSON out of a fenced block or surrounding prose", async () => {
    const fenced = new AiContentRecommendationRefiner(
      providerReturning(
        'Here you go:\n```json\n[{"key":"image.carousel|WORKFLOW|id:workflow-1|linkedin","title":"From a fence"}]\n```\nHope that helps.',
      ),
    );

    const refined = await fenced.refine(context, [candidate()]);
    expect(refined[0].title).toBe("From a fence");
  });

  /**
   * The regression this exists to prevent.
   *
   * Candidates are refined before they are persisted, so every one of them still
   * has an empty row id. Addressing them by id collapses the whole batch onto a
   * single entry: the model returns N rewrites, all but one match nothing, and
   * refinement silently drops the rest — or worse, applies one item's reword to
   * another. The stable key is what makes a pre-persistence batch addressable,
   * so two candidates that share an empty id must still refine independently.
   */
  it("refines a whole batch of candidates that share an empty row id", async () => {
    const refiner = new AiContentRecommendationRefiner(
      providerReturning(
        JSON.stringify([
          { key: "image.carousel|WORKFLOW|id:workflow-1|linkedin", title: "First, sharpened" },
          { key: "image.carousel|WORKFLOW|id:workflow-2|linkedin", title: "Second, sharpened" },
        ]),
      ),
    );

    const refined = await refiner.refine(context, [
      candidate(),
      candidate({ subjectId: "workflow-2", key: "image.carousel|WORKFLOW|id:workflow-2|linkedin" }),
    ]);

    // Both candidates carry id: "", so an id-keyed lookup could only ever return
    // one of them.
    expect(refined.map((item) => item.id)).toEqual(["", ""]);
    expect(refined.map((item) => item.title)).toEqual([
      "First, sharpened",
      "Second, sharpened",
    ]);
    // Each rewrite landed on the candidate that key identifies, not on the other.
    expect(refined.map((item) => item.subjectId)).toEqual(["workflow-1", "workflow-2"]);
  });

  it("refuses output with no list in it at all", async () => {
    const refiner = new AiContentRecommendationRefiner(
      providerReturning("I think you should make more videos about analytics."),
    );

    await expect(refiner.refine(context, [candidate()])).rejects.toThrowError(
      RecommendationError,
    );
  });

  it("does not call the model when there is nothing to refine", async () => {
    let called = false;
    const refiner = new AiContentRecommendationRefiner({
      async generate() {
        called = true;
        return { text: "[]", model: "test-model" };
      },
    } as unknown as AIProvider);

    expect(await refiner.refine(context, [])).toEqual([]);
    expect(called).toBe(false);
  });
});