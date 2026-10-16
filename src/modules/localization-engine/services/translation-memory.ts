import { sha256Hex } from "../serialization/canonical";

/**
 * Whitespace is not meaning. Collapsing runs of whitespace and trimming before
 * hashing means a re-indented source still hits its existing translation, while
 * any real wording change misses and is retranslated.
 */
export function normalizeSourceText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function translationMemoryKey(text: string): string {
  return sha256Hex(normalizeSourceText(text));
}
