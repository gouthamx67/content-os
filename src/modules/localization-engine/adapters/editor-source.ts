import type { EditorRepository } from "../../../core/ports/editor-repository";
import type { EditorSnapshot } from "../../editor-engine/domain/types";
import type {
  ExtractedSource,
  LocalizationSourceAdapter,
  SourceSegmentDraft,
} from "../integrations/ports";

/**
 * CP20 editor documents.
 *
 * The head revision's snapshot is the source of truth; text nodes become
 * segments keyed by node id, so a moved or restyled node does not change its
 * segment and a re-typed node does. The revision number is the source revision.
 */
export class EditorSourceAdapter implements LocalizationSourceAdapter {
  readonly sourceType = "EDITOR_DOCUMENT" as const;

  constructor(private readonly editor: EditorRepository) {}

  async extract(input: {
    projectId: string;
    sourceId: string;
    sourceLocale: string;
  }): Promise<ExtractedSource | null> {
    const document = await this.editor.getDocument(input.projectId, input.sourceId);
    if (!document) return null;

    const [head] = await this.editor.listRevisions({
      documentId: document.id,
      limit: 1,
      offset: 0,
    });

    if (!head) {
      return { sourceRevision: "v0", sourceLocale: input.sourceLocale, drafts: [] };
    }

    const snapshot = parseSnapshot(head.snapshot);
    if (!snapshot) {
      return { sourceRevision: "v0", sourceLocale: input.sourceLocale, drafts: [] };
    }

    const drafts: SourceSegmentDraft[] = [];
    for (const node of snapshot.nodes) {
      if (node.type !== "TEXT") continue;
      const value = node.text?.value?.trim();
      if (!value) continue;
      drafts.push({
        path: `editor:${document.id}:node:${node.id}`,
        kind: "CAPTION",
        sourceText: node.text?.value ?? "",
        metadata: { nodeName: node.name },
      });
    }

    return {
      sourceRevision: `r${head.revisionNumber}`,
      sourceLocale: input.sourceLocale,
      drafts,
    };
  }
}

function parseSnapshot(serialized: string): EditorSnapshot | null {
  try {
    const parsed = JSON.parse(serialized) as EditorSnapshot;
    if (!parsed || !Array.isArray(parsed.nodes)) return null;
    return parsed;
  } catch {
    return null;
  }
}
