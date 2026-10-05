import type {
  WritingDocumentRecord,
  WritingVariantRecord,
} from "../domain/types";

export type WritingOutput = {
  documentId: string;
  projectId: string;
  title: string;
  blockType: string;
  objective: string;
  tone: string;
  length: string;
  text: string;
  contentSha256: string;
  variantId: string | null;
  version: number;
};

/**
 * The export shape of a document.
 *
 * It carries the selected text plus the hashes a downstream engine needs to
 * prove it rendered the same bytes; it deliberately does not carry the context
 * snapshot, which belongs to the engine rather than the output.
 */
export function toWritingOutput(
  document: WritingDocumentRecord,
  selected: WritingVariantRecord | null,
): WritingOutput {
  return {
    documentId: document.id,
    projectId: document.projectId,
    title: document.title,
    blockType: document.blockType,
    objective: document.objective,
    tone: document.tone,
    length: document.length,
    text: selected?.text ?? document.content,
    contentSha256: selected?.textSha256 ?? document.contentSha256,
    variantId: selected?.id ?? document.selectedVariantId,
    version: document.version,
  };
}
