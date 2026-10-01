import { describe, expect, it } from "vitest";
import { parseRecommendationRefinement } from "./recommendation-refinement-validation";
import { RecommendationError } from "./content-opportunity";

describe("recommendation refinement validation", () => {
  it("reads a reworded item and trims its text", () => {
    const parsed = parseRecommendationRefinement([
      { key: " a ", title: "  Sharper title  ", rationale: " Because of X " },
    ]);

    expect(parsed).toEqual([
      { key: "a", title: "Sharper title", rationale: "Because of X", reasons: undefined },
    ]);
  });

  it("omits fields the model left out rather than inventing empty ones", () => {
    const parsed = parseRecommendationRefinement([{ key: "a" }]);

    expect(parsed).toEqual([
      { key: "a", title: undefined, rationale: undefined, reasons: undefined },
    ]);
  });

  it("accepts a wrapped list as well as a bare array", () => {
    expect(parseRecommendationRefinement({ recommendations: [{ key: "a" }] })).toHaveLength(1);
  });

  /**
   * The service compares sizes to detect an item that appeared or vanished. A
   * list that quietly lost one entry would still pass the grounding validator
   * while dropping a recommendation the user was owed, so a duplicate key is
   * refused here rather than deduplicated.
   */
  it("refuses a list that names the same item twice", () => {
    expect(() =>
      parseRecommendationRefinement([{ key: "a" }, { key: "a" }]),
    ).toThrowError(RecommendationError);
  });

  it("refuses a non-array payload", () => {
    expect(() => parseRecommendationRefinement("better")).toThrowError(
      /must be an array of rewrites/,
    );
  });

  it("refuses an entry with no key", () => {
    expect(() => parseRecommendationRefinement([{ title: "x" }])).toThrowError(
      /non-empty key/,
    );
  });

  /**
   * A refinement that moves the score or the evidence would be choosing a
   * different item, not a clearer wording of the same one. Those fields are
   * refused by name so the model is told exactly which knob is off-limits.
   */
  it("refuses a rewrite that tries to change a grounding field", () => {
    expect(() =>
      parseRecommendationRefinement([
        { key: "a", title: "x", priorityScore: 99 },
      ]),
    ).toThrowError(/may not change "priorityScore"/);

    expect(() =>
      parseRecommendationRefinement([
        { key: "a", subjectType: "CLAIM", subjectId: "made-up" },
      ]),
    ).toThrowError(/may not change "subjectType"/);

    expect(() =>
      parseRecommendationRefinement([
        { key: "a", evidenceIds: ["invented-evidence"] },
      ]),
    ).toThrowError(/may not change "evidenceIds"/);
  });

  it("refuses empty text where the model supplied something", () => {
    expect(() => parseRecommendationRefinement([{ key: "a", title: "   " }])).toThrowError(
      /title must not be empty/,
    );
  });

  it("refuses an empty reasons list, which would leave an unexplained item", () => {
    expect(() =>
      parseRecommendationRefinement([{ key: "a", reasons: [] }]),
    ).toThrowError(/must not be empty when provided/);
  });

  it("refuses reasons that are not strings", () => {
    expect(() =>
      parseRecommendationRefinement([{ key: "a", reasons: [{ text: "why" }] }]),
    ).toThrowError(/array of strings/);
  });

  it("refuses text long enough to be a hallucinated essay", () => {
    expect(() =>
      parseRecommendationRefinement([{ key: "a", title: "x".repeat(201) }]),
    ).toThrowError(/longer than 200 characters/);

    expect(() =>
      parseRecommendationRefinement([{ key: "a", rationale: "x".repeat(601) }]),
    ).toThrowError(/longer than 600 characters/);
  });

  it("refuses a reason list long enough to be noise", () => {
    expect(() =>
      parseRecommendationRefinement([
        { key: "a", reasons: Array.from({ length: 9 }, (_, index) => `why ${index}`) },
      ]),
    ).toThrowError(/at most 8 entries/);
  });

  it("refuses a nested array entry", () => {
    expect(() => parseRecommendationRefinement([[{ key: "a" }]])).toThrowError(
      /must be an object/,
    );
  });
});