import type { WritingRepository } from "../../../core/ports/writing-repository";
import type {
  ExtractedSource,
  LocalizationSourceAdapter,
  SourceSegmentDraft,
} from "../integrations/ports";
import { splitParagraphs } from "./text";

/**
 * CP18 writing documents.
 *
 * The title becomes a HEADLINE and the body is split into BODY paragraphs. The
 * document's revision number is the source revision, so a later version of the
 * same document is a different source and marks any existing job stale.
 */
export class WritingSourceAdapter implements LocalizationSourceAdapter {
  readonly sourceType = "WRITING_DOCUMENT" as const;

  constructor(private readonly writing: WritingRepository) {}

  async extract(input: {
    projectId: string;
    sourceId: string;
    sourceLocale: string;
  }): Promise<ExtractedSource | null> {
    const document = await this.writing.getDocument(
      input.projectId,
      input.sourceId,
    );
    if (!document) return null;

    const drafts: SourceSegmentDraft[] = [];
    if (document.title.trim().length > 0) {
      drafts.push({
        path: `writing:${document.id}:title`,
        kind: "HEADLINE",
        sourceText: document.title,
        metadata: { blockType: document.blockType },
      });
    }

    splitParagraphs(document.content).forEach((paragraph, index) => {
      drafts.push({
        path: `writing:${document.id}:body:${index}`,
        kind: "BODY",
        sourceText: paragraph,
      });
    });

    return {
      sourceRevision: `v${document.version}`,
      sourceLocale: input.sourceLocale,
      drafts,
    };
  }
}
