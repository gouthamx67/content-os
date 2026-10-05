import type { RewriteInstruction, WritingContext } from "../domain/types";
import { clampToBudget } from "../style/block-length";
import { countWords, wordBudget } from "../style/length";
import { stripHype } from "../style/tone";

const FILLER =
  /\b(very|really|just|actually|basically|simply|literally|quite|truly)\b/gi;
const SIMPLIFICATIONS: ReadonlyArray<[RegExp, string]> = [
  [/\butili[sz]e\b/gi, "use"],
  [/\bin order to\b/gi, "to"],
  [/\bat this point in time\b/gi, "now"],
  [/\ba number of\b/gi, "several"],
  [/\bprior to\b/gi, "before"],
  [/\bsubsequent to\b/gi, "after"],
];
const CONTRACTIONS: ReadonlyArray<[RegExp, string]> = [
  [/\bdo not\b/gi, "don't"],
  [/\bcannot\b/gi, "can't"],
  [/\bit is\b/gi, "it's"],
  [/\bwe are\b/gi, "we're"],
  [/\byou are\b/gi, "you're"],
  [/\bthat is\b/gi, "that's"],
];

function sentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]*/g)?.map((part) => part.trim()).filter(Boolean) ?? [text];
}

function shorten(text: string): string {
  const parts = sentences(text);
  if (parts.length <= 1) {
    const words = text.split(/\s+/);
    return words.slice(0, Math.max(1, Math.ceil(words.length * 0.6))).join(" ");
  }
  return parts.slice(0, Math.max(1, Math.ceil(parts.length * 0.6))).join(" ");
}

function simplify(text: string): string {
  let value = text.replace(FILLER, "");
  for (const [pattern, replacement] of SIMPLIFICATIONS) {
    value = value.replace(pattern, replacement);
  }
  return value.replace(/\s{2,}/g, " ").trim();
}

function makeDirect(text: string): string {
  const value = text.replace(/^(introducing|presenting|say hello to)\s+/i, "");
  return value.replace(/\bwe('| a)?re (excited|thrilled|proud) to\b/gi, "we").replace(/\s{2,}/g, " ").trim();
}

function conversational(text: string): string {
  let value = text;
  for (const [pattern, replacement] of CONTRACTIONS) {
    value = value.replace(pattern, replacement);
  }
  return value.replace(/\s{2,}/g, " ").trim();
}

/**
 * Applies a rewrite instruction deterministically and re-clamps to the block's
 * budget. It never invents a new claim: it reshapes existing sentences, so the
 * rewritten copy grounds against the same facts the original did.
 */
export function rewriteCopy(
  text: string,
  instruction: RewriteInstruction,
  context: WritingContext,
): string {
  const original = text.trim();
  let value = original;

  switch (instruction) {
    case "SHORTEN":
      value = shorten(original);
      break;
    case "SIMPLIFY":
      value = simplify(original);
      break;
    case "MAKE_MORE_DIRECT":
      value = makeDirect(original);
      break;
    case "MAKE_MORE_CONVERSATIONAL":
      value = conversational(original);
      break;
    case "REMOVE_HYPE":
      value = stripHype(original);
      break;
  }

  const budget = wordBudget(context.blockType, context.length);
  const clamped = clampToBudget(value, budget.maxWords, budget.maxChars).trim();
  return countWords(clamped) > 0 ? clamped : original;
}
