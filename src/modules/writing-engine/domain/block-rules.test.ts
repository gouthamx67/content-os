import { describe, expect, it } from "vitest";
import {
  BLOCK_RULES,
  blockSupportsCta,
  getBlockRule,
  isWritingBlockType,
  isWritingLength,
  isWritingTone,
} from "./block-rules";
import { WRITING_BLOCK_TYPES } from "./types";

describe("block rules", () => {
  it("defines a rule for every block type", () => {
    for (const blockType of WRITING_BLOCK_TYPES) {
      expect(BLOCK_RULES[blockType]).toBeTruthy();
      expect(getBlockRule(blockType).label.length).toBeGreaterThan(0);
    }
  });

  it("only lets CTA-bearing blocks claim to support a CTA", () => {
    expect(blockSupportsCta("CTA")).toBe(true);
    expect(blockSupportsCta("BODY")).toBe(true);
    expect(blockSupportsCta("HEADLINE")).toBe(false);
  });

  it("guards the closed unions", () => {
    expect(isWritingBlockType("HEADLINE")).toBe(true);
    expect(isWritingBlockType("TITLE")).toBe(false);
    expect(isWritingTone("BOLD")).toBe(true);
    expect(isWritingTone("shouty")).toBe(false);
    expect(isWritingLength("SHORT")).toBe(true);
    expect(isWritingLength("TINY")).toBe(false);
  });
});
