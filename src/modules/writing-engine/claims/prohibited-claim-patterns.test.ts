import { describe, expect, it } from "vitest";
import {
  hasProhibitedClaimPattern,
  matchProhibitedClaim,
} from "./prohibited-claim-patterns";

describe("prohibited claim patterns", () => {
  it("flags superlatives, guarantees and absolutes", () => {
    expect(matchProhibitedClaim("The best scheduling tool")?.id).toBe(
      "superlative_best",
    );
    expect(matchProhibitedClaim("We guarantee results")?.id).toBe("guarantee");
    expect(matchProhibitedClaim("It always works")?.id).toBe("absolute_always");
    expect(matchProhibitedClaim("Never miss a deadline")?.id).toBe(
      "absolute_never",
    );
  });

  it("flags measured claims, multipliers and instant promises", () => {
    expect(hasProhibitedClaimPattern("20% faster than before")).toBe(true);
    expect(hasProhibitedClaimPattern("3x more results")).toBe(true);
    expect(hasProhibitedClaimPattern("Available instantly")).toBe(true);
    expect(hasProhibitedClaimPattern("100% risk free")).toBe(true);
  });

  it("leaves plain descriptive copy alone", () => {
    expect(
      hasProhibitedClaimPattern("Scheduled exports send a status report."),
    ).toBe(false);
  });
});
