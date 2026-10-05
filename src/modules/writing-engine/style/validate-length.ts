import { getBlockRule } from "../domain/block-rules";
import type { WritingBlockType, WritingLength } from "../domain/types";
import { countWords, wordBudget } from "./length";

/**
 * Checks a variant against the word/character window for its block type.
 *
 * The issues are stable codes rather than prose so a caller can branch on them.
 */
export function validateVariantLength(
  blockType: WritingBlockType,
  length: WritingLength,
  text: string,
): string[] {
  const budget = wordBudget(blockType, length);
  const words = countWords(text);
  const issues: string[] = [];

  if (words < budget.minWords) {
    issues.push(`too_short:${words}<${budget.minWords}`);
  }
  if (words > budget.maxWords) {
    issues.push(`too_long:${words}>${budget.maxWords}`);
  }
  if (text.length > budget.maxChars) {
    issues.push(`too_many_chars:${text.length}>${budget.maxChars}`);
  }

  return issues;
}

export function isWithinBudget(
  blockType: WritingBlockType,
  length: WritingLength,
  text: string,
): boolean {
  return validateVariantLength(blockType, length, text).length === 0;
}

export { getBlockRule };
