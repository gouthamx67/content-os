import { describe, expect, it } from "vitest";
import { factsSupporting, groundClaim, significantTokens } from "./grounding-validator";
import { makeContext, productContext } from "../__tests__/fixtures";

describe("significantTokens", () => {
  it("drops punctuation and stopwords but keeps meaning", () => {
    expect(significantTokens("The scheduled exports send a report.")).toEqual([
      "scheduled",
      "exports",
      "send",
      "report",
    ]);
  });
});

describe("groundClaim", () => {
  it("grounds a statement the project records, with a real source id", () => {
    const context = makeContext();
    const verdict = groundClaim(
      "Scheduled exports send a status report on a fixed schedule",
      context,
    );
    expect(verdict.status).toBe("GROUNDED");
    expect(verdict.sourceIds).toEqual(["source_1"]);
  });

  it("rejects a number the project does not record", () => {
    const product = productContext({
      features: [],
      problems: [],
      workflows: [],
      claims: [],
      audienceSignals: [],
      benefits: [
        {
          id: "benefit_1",
          name: "Fewer status meetings",
          description: "Scheduled exports save time every week",
          sourceIds: ["source_2"],
        },
      ],
    });
    const context = makeContext({ product });
    const verdict = groundClaim(
      "Scheduled exports save 10 hours every week",
      context,
    );
    expect(verdict.status).toBe("UNSUPPORTED");
    expect(verdict.reasoning).toMatch(/number/);
  });

  it("rejects a prohibited shape the project does not back", () => {
    const verdict = groundClaim("The best scheduling tool available", makeContext());
    expect(verdict.status).toBe("UNSUPPORTED");
    expect(verdict.reasoning).toMatch(/prohibited/);
  });

  it("rejects a statement no fact supports", () => {
    const verdict = groundClaim(
      "Astronauts rely on this tool on the moon",
      makeContext(),
    );
    expect(verdict.status).toBe("UNSUPPORTED");
    expect(verdict.reasoning).toMatch(/no project fact/);
  });

  it("returns REVIEW when a supporting fact has no resolvable source", () => {
    const product = productContext({
      features: [],
      problems: [],
      workflows: [],
      claims: [],
      audienceSignals: [],
      benefits: [
        {
          id: "benefit_1",
          name: "Fewer status meetings",
          description: "Quarterly business reviews stay aligned without extra meetings",
          sourceIds: [],
        },
      ],
    });
    const context = makeContext({ product });
    const verdict = groundClaim(
      "Quarterly business reviews stay aligned without extra meetings",
      context,
    );
    expect(verdict.status).toBe("REVIEW");
    expect(verdict.sourceIds).toEqual([]);
  });

  it("treats an empty claim as unsupported", () => {
    expect(groundClaim("   ", makeContext()).status).toBe("UNSUPPORTED");
  });

  it("finds the facts behind a claim", () => {
    const supporting = factsSupporting(
      "Scheduled exports send a status report on a fixed schedule",
      makeContext(),
    );
    expect(supporting.map((fact) => fact.entityId)).toContain("feature_1");
  });
});
