import { LocalizationError } from "../errors";
import { createSegment } from "../domain/segment";
import type {
  LocalizationSegment,
  LocalizationSourceType,
} from "../domain/types";
import { localizationHash } from "../serialization/canonical";
import type {
  LocalizationSourceAdapter,
  SourceSegmentDraft,
} from "../integrations/ports";

export type ExtractionResult = {
  sourceRevision: string;
  sourceLocale: string;
  sourceHash: string;
  segments: LocalizationSegment[];
};

/**
 * Turns an upstream artifact into segments, through the adapter that owns its
 * checkpoint.
 *
 * The hash is computed over the drafts in path order, so two extractions of the
 * same source agree byte for byte and a hash change always means the text
 * changed — never that the read order did.
 */
export class SourceExtractor {
  private readonly byType: Map<
    LocalizationSourceType,
    LocalizationSourceAdapter
  >;

  constructor(adapters: readonly LocalizationSourceAdapter[]) {
    this.byType = new Map(
      adapters.map((adapter) => [adapter.sourceType, adapter]),
    );
  }

  async extract(input: {
    projectId: string;
    sourceType: LocalizationSourceType;
    sourceId: string;
    sourceLocale: string;
  }): Promise<ExtractionResult> {
    const adapter = this.byType.get(input.sourceType);
    if (!adapter) {
      throw new LocalizationError(
        "SOURCE_NOT_FOUND",
        `No adapter is registered for source type ${input.sourceType}`,
        { sourceType: input.sourceType },
      );
    }

    const source = await adapter.extract({
      projectId: input.projectId,
      sourceId: input.sourceId,
      sourceLocale: input.sourceLocale,
    });

    if (!source) {
      throw new LocalizationError(
        "SOURCE_NOT_FOUND",
        "The source does not exist in this project",
        { sourceType: input.sourceType, sourceId: input.sourceId },
      );
    }

    return {
      sourceRevision: source.sourceRevision,
      sourceLocale: source.sourceLocale,
      sourceHash: hashDrafts(source.drafts),
      segments: source.drafts.map((draft) => createSegment(draft)),
    };
  }
}

export function hashDrafts(drafts: readonly SourceSegmentDraft[]): string {
  const normalized = [...drafts]
    .map((draft) => ({
      path: draft.path,
      kind: draft.kind,
      sourceText: draft.sourceText,
    }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  return localizationHash(normalized);
}
