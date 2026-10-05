import { getBlockRule } from "../domain/block-rules";
import type { WritingBlockType, WritingLength } from "../domain/types";

export type WordBudget = {
  minWords: number;
  maxWords: number;
  maxChars: number;
};

/** The word window a block type is allowed to occupy at a given length. */
export function wordBudget(
  blockType: WritingBlockType,
  length: WritingLength,
): WordBudget {
  const rule = getBlockRule(blockType);
  return {
    minWords: rule.minWords,
    maxWords: rule.maxWords[length],
    maxChars: rule.maxChars,
  };
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
