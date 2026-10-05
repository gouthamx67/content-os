import { describe, expect, it } from "vitest";
import { rewriteCopy } from "./rewrite-copy";
import { countWords } from "../style/length";
import { makeContext } from "../__tests__/fixtures";

const context = makeContext({ blockType: "BODY", length: "LONG" });

describe("rewriteCopy", () => {
  it("shortens without inventing content", () => {
    const original =
      "First sentence about scheduled exports. Second sentence about reporting. Third sentence about alignment.";
    const rewritten = rewriteCopy(original, "SHORTEN", context);
    expect(countWords(rewritten)).toBeLessThan(countWords(original));
  });

  it("simplifies inflated phrasing", () => {
    const rewritten = rewriteCopy(
      "We utilize a very really just simple approach in order to deliver status.",
      "SIMPLIFY",
      context,
    );
    expect(rewritten).toContain("use");
    expect(rewritten.toLowerCase()).not.toContain("utilize");
    expect(rewritten.toLowerCase()).not.toContain("very");
  });

  it("makes copy more direct", () => {
    const rewritten = rewriteCopy(
      "Introducing our scheduling tool.",
      "MAKE_MORE_DIRECT",
      context,
    );
    expect(rewritten.toLowerCase()).not.toContain("introducing");
  });

  it("makes copy more conversational", () => {
    const rewritten = rewriteCopy(
      "We do not require setup and it is ready.",
      "MAKE_MORE_CONVERSATIONAL",
      context,
    );
    expect(rewritten).toContain("don't");
    expect(rewritten).toContain("it's");
  });

  it("removes hype regardless of the instruction", () => {
    const rewritten = rewriteCopy(
      "A revolutionary and game-changing platform.",
      "REMOVE_HYPE",
      context,
    );
    expect(rewritten.toLowerCase()).not.toContain("revolutionary");
    expect(rewritten.toLowerCase()).not.toContain("game-changing");
  });

  it("never returns empty copy for non-empty input", () => {
    const rewritten = rewriteCopy("Scheduled exports help.", "SHORTEN", context);
    expect(rewritten.trim().length).toBeGreaterThan(0);
  });
});
