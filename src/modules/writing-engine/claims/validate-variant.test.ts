import { describe, expect, it } from "vitest";
import { validateVariant } from "./validate-variant";
import { makeContext, productContext } from "../__tests__/fixtures";

describe("validateVariant", () => {
  it("accepts grounded copy", () => {
    const result = validateVariant(
      "Scheduled exports send a status report on a fixed schedule.",
      makeContext(),
    );
    expect(result.accepted).toBe(true);
    expect(result.claims[0]?.status).toBe("GROUNDED");
  });

  it("rejects copy that uses a brand-forbidden term", () => {
    const result = validateVariant(
      "A revolutionary scheduling tool.",
      makeContext(),
    );
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/brand_prohibited_term/);
  });

  it("rejects copy containing an unsupported claim", () => {
    const result = validateVariant("The best scheduling tool available.", makeContext());
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/unsupported_claim/);
  });

  it("keeps a REVIEW claim without rejecting the variant", () => {
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
    const result = validateVariant(
      "Quarterly business reviews stay aligned without extra meetings.",
      makeContext({ product }),
    );
    expect(result.accepted).toBe(true);
    expect(result.claims[0]?.status).toBe("REVIEW");
  });
});
