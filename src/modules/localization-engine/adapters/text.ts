/**
 * Splits a block of text into addressable paragraphs.
 *
 * A blank line separates paragraphs; a single newline is kept inside one. The
 * split is deterministic, so the same source always yields the same segment
 * paths and hashes, and editing one paragraph changes only that segment.
 */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}
