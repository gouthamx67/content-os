import { describe, expect, it } from "vitest";
import {
  makeCreativeContext,
  makeCreativeDirection,
} from "../../testing/fakes";
import {
  CreativeValidationFailure,
  parseCreativeDraft,
  validateCreativeDirection,
} from "./creative-direction-validator";

function codesFrom(run: () => unknown): string[] {
  try {
    run();
    return [];
  } catch (error) {
    if (error instanceof CreativeValidationFailure) {
      return error.issues.map((issue) => issue.code);
    }
    throw error;
  }
}

/**
 * Asserts which rule codes a rejection carries, and reports the codes that were
 * actually produced. A missing code fails with what the validator said instead
 * of a formatted array.
 */
function expectCodes(run: () => unknown, ...expected: string[]): string[] {
  const codes = codesFrom(run);
  for (const code of expected) {
    if (!codes.includes(code)) {
      throw new Error(
        `Expected a rejection carrying ${code}, but it carried: ${
          codes.length === 0 ? "(no issues)" : codes.join(", ")
        }`,
      );
    }
  }
  return codes;
}

function expectAccepted(run: () => unknown): void {
  const codes = codesFrom(run);
  if (codes.length > 0) {
    throw new Error(`Expected no rejection, but got: ${codes.join(", ")}`);
  }
}

describe("creative direction validation", () => {
  it("accepts a direction built from the project's own material", () => {
    const context = makeCreativeContext();
    const direction = makeCreativeDirection();
    expect(validateCreativeDirection(direction, context)).toBe(direction);
  });

  it("treats an absent call to action as a decision, not a gap", () => {
    const context = makeCreativeContext();

    // cta is nullable in the domain: not every direction ends in an ask.
    expectAccepted(() =>
      validateCreativeDirection(makeCreativeDirection({ cta: null }), context),
    );
  });

  it("rejects a call to action that is present but blank", () => {
    const context = makeCreativeContext();
    expectCodes(
      () => validateCreativeDirection(makeCreativeDirection({ cta: "   " }), context),
      "CREATIVE_FIELD_MISSING",
    );
  });

  it("rejects a claim the intelligence graph never recorded", () => {
    const context = makeCreativeContext();
    const direction = makeCreativeDirection({
      proofStrategy: {
        claimIds: ["cl_invented"],
        evidenceIds: ["ev_1"],
        proofPoints: ["Show the queued export"],
      },
    });
    expectCodes(
      () => validateCreativeDirection(direction, context),
      "CREATIVE_UNKNOWN_CLAIM",
    );
  });

  it("rejects an asset the project does not have", () => {
    const context = makeCreativeContext();
    const direction = makeCreativeDirection({
      visualStrategy: {
        approach: "The real schedule screen",
        rationale: "Because the real screen proves it",
        productMoments: ["The export queue"],
        assetIds: ["as_invented"],
      },
    });
    expectCodes(
      () => validateCreativeDirection(direction, context),
      "CREATIVE_UNKNOWN_ASSET",
    );
  });

  it("rejects evidence that does not exist", () => {
    const context = makeCreativeContext();
    const direction = makeCreativeDirection({
      proofStrategy: {
        claimIds: ["cl_1"],
        evidenceIds: ["ev_invented"],
        proofPoints: ["Show the queued export"],
      },
    });
    expectCodes(
      () => validateCreativeDirection(direction, context),
      "CREATIVE_UNKNOWN_EVIDENCE",
    );
  });

  it("rejects a claim the graph marked unverified", () => {
    const context = makeCreativeContext({
      claims: [
        {
          id: "cl_1",
          text: "Exports run on a schedule",
          verification: "UNVERIFIED",
          evidenceIds: [],
        },
      ],
      evidence: [
        {
          id: "ev_1",
          kind: "SOURCE_FRAGMENT",
          locator: "README",
          snippet: "",
          claimIds: ["cl_1"],
        },
      ],
    });
    expectCodes(
      () => validateCreativeDirection(makeCreativeDirection(), context),
      "CREATIVE_CLAIM_UNVERIFIED",
    );
  });

  it("rejects a quantified claim no supported claim backs", () => {
    const context = makeCreativeContext();
    const direction = makeCreativeDirection({
      thesis: "Scheduled exports are 10x faster than manual reporting",
    });
    expectCodes(
      () => validateCreativeDirection(direction, context),
      "CREATIVE_UNSUPPORTED_QUANTIFIED_CLAIM",
    );
  });

  it("allows a number that a cited claim actually states", () => {
    const context = makeCreativeContext({
      claims: [
        {
          id: "cl_1",
          text: "Teams report 10x faster with scheduled exports",
          verification: "SUPPORTED",
          evidenceIds: ["ev_1"],
        },
      ],
    });
    const direction = makeCreativeDirection({
      thesis: "Teams report 10x faster with scheduled exports",
    });
    expectAccepted(() => validateCreativeDirection(direction, context));
  });

  it("rejects evidence cited next to a claim it does not support", () => {
    const context = makeCreativeContext({
      claims: [
        {
          id: "cl_2",
          text: "Another claim",
          verification: "SUPPORTED",
          evidenceIds: ["ev_9"],
        },
      ],
      evidence: [
        {
          id: "ev_1",
          kind: "SOURCE_FRAGMENT",
          locator: "README",
          snippet: "",
          claimIds: ["cl_1"],
        },
        {
          id: "ev_9",
          kind: "URL_SECTION",
          locator: "https://example.com",
          snippet: "",
          claimIds: ["cl_2"],
        },
      ],
    });
    const direction = makeCreativeDirection({
      proofStrategy: {
        claimIds: ["cl_1"],
        evidenceIds: ["ev_9"],
        proofPoints: ["Show the queued export"],
      },
    });
    expectCodes(
      () => validateCreativeDirection(direction, context),
      "CREATIVE_EVIDENCE_MISMATCH",
    );
  });

  it("rejects a direction written for a different mode than the one requested", () => {
    const context = makeCreativeContext({ mode: "BALANCED" });
    const direction = makeCreativeDirection({ mode: "WILD" });
    expectCodes(
      () => validateCreativeDirection(direction, context),
      "CREATIVE_MODE_MISMATCH",
    );
  });

  it("refuses an experimental opening in Guided mode", () => {
    const context = makeCreativeContext({ mode: "GUIDED" });
    const direction = makeCreativeDirection({
      mode: "GUIDED",
      hook: {
        statement: "Imagine if your status update sent itself",
        mechanism: "Open on a metaphor",
        emotionalTrigger: "Delight",
      },
    });
    expectCodes(
      () => validateCreativeDirection(direction, context),
      "CREATIVE_MODE_CONFLICT",
    );
  });

  it("allows the same opening in Wild mode", () => {
    const context = makeCreativeContext({ mode: "WILD" });
    const direction = makeCreativeDirection({
      mode: "WILD",
      hook: {
        statement: "Imagine if your status update sent itself",
        mechanism: "Open on a metaphor",
        emotionalTrigger: "Delight",
      },
    });
    expectAccepted(() => validateCreativeDirection(direction, context));
  });

  it("refuses a conceptual visual in Guided mode", () => {
    const context = makeCreativeContext({ mode: "GUIDED" });
    const direction = makeCreativeDirection({
      mode: "GUIDED",
      visualStrategy: {
        approach: "A stylised illustration standing in for the interface",
        rationale: "It feels more human",
        productMoments: ["The report arriving as a bird"],
        assetIds: [],
      },
    });
    expectCodes(
      () => validateCreativeDirection(direction, context),
      "CREATIVE_MODE_REQUIRES_PRODUCT_UI",
    );
  });

  it("refuses Guided work that never shows the product", () => {
    const context = makeCreativeContext({ mode: "GUIDED" });
    const direction = makeCreativeDirection({
      mode: "GUIDED",
      visualStrategy: {
        approach: "Close-ups of a desk and a coffee cup",
        rationale: "The mood carries it",
        productMoments: [],
        assetIds: [],
      },
    });
    expectCodes(
      () => validateCreativeDirection(direction, context),
      "CREATIVE_MODE_REQUIRES_PRODUCT_UI",
    );
  });

  it("refuses an angle the mode does not consider", () => {
    const context = makeCreativeContext({ mode: "GUIDED" });
    const direction = makeCreativeDirection({
      mode: "GUIDED",
      angle: "EMOTIONAL",
    });
    expectCodes(
      () => validateCreativeDirection(direction, context),
      "CREATIVE_MODE_CONFLICT",
    );
  });

  it("rejects a score outside 1-100", () => {
    const context = makeCreativeContext();
    expectCodes(
      () =>
        validateCreativeDirection(
          makeCreativeDirection({ strengthScore: 0 }),
          context,
        ),
      "CREATIVE_INVALID_SCORE",
    );
    expectCodes(
      () =>
        validateCreativeDirection(
          makeCreativeDirection({ strengthScore: 101 }),
          context,
        ),
      "CREATIVE_INVALID_SCORE",
    );
  });

  it("rejects a direction belonging to another project or request", () => {
    const context = makeCreativeContext();
    expectCodes(
      () =>
        validateCreativeDirection(
          makeCreativeDirection({ projectId: "prj_other" }),
          context,
        ),
      "CREATIVE_SCOPE_VIOLATION",
    );
    expectCodes(
      () =>
        validateCreativeDirection(
          makeCreativeDirection({ intentId: "int_other" }),
          context,
        ),
      "CREATIVE_SCOPE_VIOLATION",
    );
  });

  it("rejects an empty required field rather than storing a blank", () => {
    const context = makeCreativeContext();
    const direction = makeCreativeDirection({ thesis: "   " });
    expectCodes(
      () => validateCreativeDirection(direction, context),
      "CREATIVE_FIELD_MISSING",
    );
  });

  it("rejects a hook that is a paragraph", () => {
    const context = makeCreativeContext();
    const direction = makeCreativeDirection({
      hook: {
        statement: Array.from({ length: 40 }, () => "word").join(" "),
        mechanism: "Open on the problem",
        emotionalTrigger: "Recognition",
      },
    });
    expectCodes(
      () => validateCreativeDirection(direction, context),
      "CREATIVE_HOOK_TOO_LONG",
    );
  });
});

describe("provider output parsing", () => {
  const context = makeCreativeContext();

  const valid = {
    name: "The problem, then the way out",
    angle: "PROBLEM_SOLUTION",
    thesis: "The chase eats a morning and scheduling removes it",
    hook: {
      statement: "Chasing status eats a morning",
      mechanism: "Open on a real moment",
      emotionalTrigger: "Recognition",
    },
    audienceAngle: "For engineering leads",
    emotionalAngle: "Relief",
    narrativeSummary: "The problem, then the fix, then the proof",
    visualStrategy: {
      approach: "The real schedule screen",
      rationale: "The real screen is the proof",
      productMoments: ["The export queue"],
      assetIds: ["as_1"],
    },
    proofStrategy: {
      claimIds: ["cl_1"],
      evidenceIds: ["ev_1"],
      proofPoints: ["Show the queued export"],
    },
    voiceDirection: "Plain and direct",
    musicDirection: "Low and sustained",
    soundDirection: "Interface sound",
    cta: "Start free trial",
    rationale: "It uses what the project recorded",
  };

  it("accepts a well-formed direction", () => {
    const draft = parseCreativeDraft(valid, context);
    expect(draft.angle).toBe("PROBLEM_SOLUTION");
    expect(draft.proofStrategy.claimIds).toEqual(["cl_1"]);
  });

  it("refuses a field the domain does not have", () => {
    expectCodes(
      () => parseCreativeDraft({ ...valid, scenes: ["a beat"] }, context),
      "CREATIVE_INVALID_OUTPUT",
    );
  });

  it("refuses an unknown angle", () => {
    expectCodes(
      () => parseCreativeDraft({ ...valid, angle: "VIBE_CHECK" }, context),
      "CREATIVE_UNKNOWN_ANGLE",
    );
  });

  it("refuses an asset id outside the project", () => {
    expectCodes(
      () =>
        parseCreativeDraft(
          {
            ...valid,
            visualStrategy: { ...valid.visualStrategy, assetIds: ["as_fake"] },
          },
          context,
        ),
      "CREATIVE_UNKNOWN_ASSET",
    );
  });

  it("refuses an angle the mode does not consider", () => {
    const guided = makeCreativeContext({ mode: "GUIDED" });
    expectCodes(
      () => parseCreativeDraft({ ...valid, angle: "EMOTIONAL" }, guided),
      "CREATIVE_MODE_CONFLICT",
    );
  });

  it("refuses a list where a string belongs", () => {
    expectCodes(
      () =>
        parseCreativeDraft(
          {
            ...valid,
            visualStrategy: {
              ...valid.visualStrategy,
              productMoments: "just one",
            },
          },
          context,
        ),
      "CREATIVE_FIELD_MISSING",
    );
  });

  it("refuses a direction with no proof at all", () => {
    expectCodes(
      () =>
        parseCreativeDraft(
          { ...valid, proofStrategy: { ...valid.proofStrategy, proofPoints: [] } },
          context,
        ),
      "CREATIVE_LIST_TOO_SHORT",
    );
  });

  it("accepts a null call to action when none was requested", () => {
    const draft = parseCreativeDraft({ ...valid, cta: null }, context);
    expect(draft.cta).toBeNull();
  });
});
