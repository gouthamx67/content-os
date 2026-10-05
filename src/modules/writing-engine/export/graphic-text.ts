import type { WritingDocumentRecord } from "../domain/types";

/**
 * The text a graphic should render for a writing document.
 *
 * Short blocks become the graphic's headline; longer blocks are cut to their
 * first sentence so a body paragraph never overflows a card. This is a shaping
 * rule, not a rewriting one: the words are unchanged.
 */
export function graphicTextFor(document: WritingDocumentRecord): string {
  const text = document.content.trim();
  if (!text) return "";

  if (document.blockType === "HEADLINE" || document.blockType === "SUBHEAD") {
    return text;
  }

  const firstSentence = text.match(/[^.!?]+[.!?]?/)?.[0]?.trim();
  return firstSentence && firstSentence.length > 0 ? firstSentence : text;
}
