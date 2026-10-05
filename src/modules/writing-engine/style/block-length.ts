import { countWords } from "./length";

/**
 * Trims a draft to a word/character budget without cutting mid-word.
 *
 * Sentences are dropped from the end first; only if the first sentence alone is
 * still over budget is it truncated as a last resort. The goal is that an
 * over-long draft degrades to something readable rather than a fragment.
 */
export function clampToBudget(
  text: string,
  maxWords: number,
  maxChars: number,
): string {
  let value = text.trim();

  if (value.length > maxChars) {
    const sentences = value.match(/[^.!?]+[.!?]*/g) ?? [value];
    let kept = "";
    for (const sentence of sentences) {
      const candidate = `${kept}${sentence}`.trim();
      if (candidate.length > maxChars) break;
      kept = candidate;
    }
    value = (kept || value.slice(0, maxChars)).trim();
  }

  if (countWords(value) > maxWords) {
    const words = value.split(/\s+/);
    value = words.slice(0, maxWords).join(" ");
    const lastStop = Math.max(
      value.lastIndexOf("."),
      value.lastIndexOf("!"),
      value.lastIndexOf("?"),
    );
    if (lastStop > 0) value = value.slice(0, lastStop + 1);
    value = value.trim();
  }

  return value;
}
