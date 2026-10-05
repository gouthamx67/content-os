import type { WritingVariantRecord } from "../domain/types";

export type DocumentHistoryEntry = {
  variantId: string;
  ordinal: number;
  label: string;
  instruction: string | null;
  selected: boolean;
  textSha256: string;
  createdAt: string;
};

/**
 * The ordered edit history of a document.
 *
 * Every variant is kept, including the ones a rewrite superseded, because a
 * rewrite appends rather than overwrites. The history is therefore the honest
 * record of what the document said and when.
 */
export function buildDocumentHistory(
  variants: readonly WritingVariantRecord[],
): DocumentHistoryEntry[] {
  return [...variants]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((variant) => ({
      variantId: variant.id,
      ordinal: variant.ordinal,
      label: variant.label,
      instruction: variant.instruction,
      selected: variant.selected,
      textSha256: variant.textSha256,
      createdAt: variant.createdAt,
    }));
}
