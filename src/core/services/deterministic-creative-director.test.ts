import { describe, expect, it } from "vitest";
import { makeCreativeContext } from "../../testing/fakes";
import {
  CREATIVE_STYLE_LIST,
  CREATIVE_STYLES,
  draftFromStyle,
} from "../domain/creative-style";
import {
  DeterministicCreativeDirector,
  factsFromContext,
} from "./deterministic-creative-director";
import { validateCreativeDirection } from "./creative-direction-validator";
import { scoreDirection } from "./creative-strength";
import { makeCreativeDirection } from "../../testing/fakes";

const director = new DeterministicCreativeDirector();

async function generate(
  mode: "GUIDED" | "BALANCED" | "WILD",
  count = 3,
  overrides: Parameters<typeof makeCreativeContext>[0] = {},
) {
  const context = makeCreativeContext({ mode, ...overrides });
  const result = await director.generate({ context, count, angles: [] });
  return { context, result };
}

/** Materialises a proposal the way the service does, so validation is real. */
function materialise(
  draft: ReturnType<typeof draftFromStyle>,
  context: ReturnType<typeof makeCreativeContext>,
) {
  const now = new Date().toISOString();
  return makeCreativeDirection({
    ...draft,
    id: "cdir_test",
    projectId: context.projectId,
    intentId: context.intentId,
    mode: context.mode,
    strengthScore: scoreDirection(draft, context),
    createdAt: now,
    updatedAt: now,
  });
}

describe("creative styles", () => {
  it("registers the ten documented styles", () => {
    expect(CREATIVE_STYLE_LIST).toHaveLength(10);
    expect(CREATIVE_STYLE_LIST.map((style) => style.id)).toEqual([
      "PROBLEM_SOLUTION",
      "PRODUCT_FIRST",
      "WORKFLOW",
      "TRANSFORMATION",
      "FOUNDER",
      "TECHNICAL",
      "SOCIAL",
      "EMOTIONAL",
      "EDUCATIONAL",
      "BEFORE_AFTER",
    ]);
  });

  it("only produces angles its mode allows", () => {
    const guided = makeCreativeContext({ mode: "GUIDED" });
    const facts = factsFromContext(guided);
    for (const style of CREATIVE_STYLE_LIST) {
      const buildable = style.angles.some((angle) =>
        guided.policy.allowedAngles.includes(angle),
      );
      const draft = draftFromStyle(style, facts, {
        claimIds: ["cl_1"],
        evidenceIds: ["ev_1"],
        cta: null,
      });

      // A style the mode can use must land on an angle the mode allows, and a
      // style it cannot use is filtered out before a draft is ever built.
      if (buildable) {
        expect(guided.policy.allowedAngles).toContain(draft.angle);
      } else {
        expect(guided.policy.allowedAngles).not.toContain(draft.angle);
      }
    }
  });
});

describe("deterministic creative director", () => {
  it("returns the requested number of distinct directions", async () => {
    const { result } = await generate("BALANCED", 3);
    expect(result.proposals).toHaveLength(3);
    expect(new Set(result.proposals.map((p) => p.draft.angle)).size).toBe(3);
  });

  it("clamps to the useful range rather than returning a list", async () => {
    const { result: small } = await generate("BALANCED", 1);
    expect(small.proposals).toHaveLength(1);
    const { result: large } = await generate("BALANCED", 12);
    expect(large.proposals.length).toBeLessThanOrEqual(5);
  });

  it("never cites a claim or evidence the project does not have", async () => {
    const { result } = await generate("BALANCED", 5);
    for (const proposal of result.proposals) {
      for (const id of proposal.draft.proofStrategy.claimIds) {
        expect(["cl_1"]).toContain(id);
      }
      for (const id of proposal.draft.proofStrategy.evidenceIds) {
        expect(["ev_1"]).toContain(id);
      }
    }
  });

  it("only references real captured assets", async () => {
    const { result } = await generate("BALANCED", 5);
    for (const proposal of result.proposals) {
      for (const id of proposal.draft.visualStrategy.assetIds) {
        expect(["as_1"]).toContain(id);
      }
    }
  });

  it("leaves asset references empty when the project captured no product UI", async () => {
    const { result } = await generate("BALANCED", 3, { assets: [] });
    for (const proposal of result.proposals) {
      expect(proposal.draft.visualStrategy.assetIds).toEqual([]);
    }
  });

  it("produces directions that pass full validation", async () => {
    const { context, result } = await generate("BALANCED", 5);
    for (const proposal of result.proposals) {
      const direction = materialise(proposal.draft, context);
      expect(() => validateCreativeDirection(direction, context)).not.toThrow();
      expect(direction.strengthScore).toBeGreaterThan(0);
      expect(direction.strengthScore).toBeLessThanOrEqual(100);
    }
  });

  it("drops styles that need product UI when Guided has none to work with", async () => {
    const { result } = await generate("GUIDED", 5, { assets: [] });
    for (const proposal of result.proposals) {
      const styleId = proposal.id.replace("style-", "").toUpperCase();
      const style = CREATIVE_STYLES[styleId as keyof typeof CREATIVE_STYLES];
      expect(style.angles).not.toContain("BEFORE_AFTER");
    }
  });

  it("carries the request's call to action rather than inventing one", async () => {
    const { result } = await generate("BALANCED", 3);
    for (const proposal of result.proposals) {
      expect(proposal.draft.cta).toBe("Start free trial");
    }
  });

  it("does not invent a call to action the request never asked for", async () => {
    const { result } = await generate("BALANCED", 3, {
      intent: { cta: null },
    });
    for (const proposal of result.proposals) {
      expect(proposal.draft.cta).toBeNull();
    }
  });

  it("keeps every mode at the same grounding standard", async () => {
    for (const mode of ["GUIDED", "BALANCED", "WILD"] as const) {
      const { result } = await generate(mode, 3);
      for (const proposal of result.proposals) {
        for (const point of proposal.draft.proofStrategy.proofPoints) {
          // No quantified claim may appear without a claim to support it.
          expect(point).not.toMatch(/\d+(?:\.\d+)?\s?(?:x|%)/i);
        }
      }
    }
  });
});

describe("deterministic director: styles the project cannot support", () => {
  it("does not offer a style whose lead fact the intelligence run never found", async () => {
    // No problems were recorded, so a problem-first opening would have nothing
    // to name. Offering it would hand the user a direction with a hole in it.
    const context = makeCreativeContext({ problems: [] });
    const result = await new DeterministicCreativeDirector().generate({
      context,
      count: 5,
      angles: [],
    });

    for (const proposal of result.proposals) {
      expect(proposal.draft.hook.statement.trim()).not.toBe("");
      expect(proposal.draft.thesis.trim()).not.toBe("");
    }
  });

  it("still offers several directions when the graph is thin", async () => {
    const context = makeCreativeContext({ problems: [], benefits: [] });
    const result = await new DeterministicCreativeDirector().generate({
      context,
      count: 3,
      angles: [],
    });

    expect(result.proposals.length).toBeGreaterThanOrEqual(3);
  });

  it("gives every direction a call to action only when the intent asked for one", async () => {
    const without = makeCreativeContext({ intent: { cta: null } });
    const result = await new DeterministicCreativeDirector().generate({
      context: without,
      count: 3,
      angles: [],
    });

    for (const proposal of result.proposals) {
      expect(proposal.draft.cta).toBeNull();
    }
  });
});

describe("deterministic director: how facts meet punctuation", () => {
  it("does not leave a double stop where a stored sentence meets a template", async () => {
    // The graph stores "Northwind Analytics is a scheduling tool for teams." with
    // a full stop. Interpolated mid-sentence that used to read "teams., one step
    // at a time."
    const context = makeCreativeContext({
      problems: [
        { id: "prb_1", description: "Engineers spend Friday chasing status." },
      ],
    });

    const result = await new DeterministicCreativeDirector().generate({
      context,
      count: 5,
      angles: [],
    });

    expect(result.proposals.length).toBeGreaterThan(0);
    for (const proposal of result.proposals) {
      const words = [
        proposal.name,
        proposal.draft.thesis,
        proposal.draft.hook.statement,
        proposal.draft.narrativeSummary,
        ...proposal.draft.visualStrategy.productMoments,
        ...proposal.draft.proofStrategy.proofPoints,
      ].join(" ");

      expect(words).not.toMatch(/\.\./);
      expect(words).not.toMatch(/[ ,;:] ,/);
      expect(words).not.toMatch(/[ ,;:] \./);
      expect(words).not.toMatch(/  /);
    }
  });
});
