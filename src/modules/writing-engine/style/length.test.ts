import { describe, expect, it } from "vitest";
import { countWords, wordBudget } from "./length";
import { clampToBudget } from "./block-length";

describe("word budgets", () => {
  it("scales with length", () => {
    const short = wordBudget("HEADLINE", "SHORT");
    const long = wordBudget("HEADLINE", "LONG");
    expect(short.maxWords).toBeLessThan(long.maxWords);
    expect(short.minWords).toBe(long.minWords);
  });

  it("counts words without counting whitespace", () => {
    expect(countWords("  one two   three  ")).toBe(3);
    expect(countWords("   ")).toBe(0);
  });
});

describe("clampToBudget", () => {
  it("drops trailing sentences that exceed the character cap", () => {
    const text = "First sentence here. Second sentence here. Third sentence here.";
    const clamped = clampToBudget(text, 100, 25);
    expect(clamped.length).toBeLessThanOrEqual(25);
    expect(clamped).toBe("First sentence here.");
  });

  it("truncates to the word cap without cutting mid-word", () => {
    const clamped = clampToBudget("one two three four five six seven", 3, 500);
    expect(clamped).toBe("one two three");
  });
});
