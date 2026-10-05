import { describe, expect, it } from "vitest";
import {
  extractClaimCandidates,
  isClaimCandidate,
} from "./validate-claim";
import { makeContext } from "../__tests__/fixtures";

describe("isClaimCandidate", () => {
  const context = makeContext();

  it("ignores a short descriptive line", () => {
    expect(isClaimCandidate("Hello friend", context)).toBe(false);
  });

  it("treats a number as a claim", () => {
    expect(isClaimCandidate("It saves 10 hours", context)).toBe(true);
  });

  it("treats a prohibited shape as a claim", () => {
    expect(isClaimCandidate("The best choice", context)).toBe(true);
  });

  it("treats a claim trigger as a claim", () => {
    expect(isClaimCandidate("This reduces effort", context)).toBe(true);
  });

  it("treats a line that echoes a project fact as a claim", () => {
    expect(
      isClaimCandidate(
        "Scheduled exports send a status report on a fixed schedule",
        context,
      ),
    ).toBe(true);
  });
});

describe("extractClaimCandidates", () => {
  it("splits, filters and de-duplicates sentences", () => {
    const context = makeContext();
    const claims = extractClaimCandidates(
      [
        "Scheduled exports send a status report on a fixed schedule.",
        "A plain flourish with no facts.",
        "Scheduled exports send a status report on a fixed schedule.",
      ].join("\n"),
      context,
    );
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatch(/Scheduled exports send a status report/);
  });
});
