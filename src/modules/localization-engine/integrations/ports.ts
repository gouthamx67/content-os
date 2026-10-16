import type { GlossaryEntry } from "../domain/glossary";
import type {
  LocalizationSegment,
  LocalizationSegmentKind,
  LocalizationSourceType,
  LocalizationStrategy,
} from "../domain/types";

/**
 * A source field, before it becomes a segment.
 *
 * `path` is the stable locator the adapter promises never changes for the same
 * field, so a segment id survives a re-extraction.
 */
export type SourceSegmentDraft = {
  path: string;
  kind: LocalizationSegmentKind;
  sourceText: string;
  metadata?: Record<string, string>;
};

export type ExtractedSource = {
  sourceRevision: string;
  sourceLocale: string;
  drafts: SourceSegmentDraft[];
};

/**
 * One adapter per upstream checkpoint.
 *
 * The adapter owns the read: it resolves the source through the owning module's
 * repository, so a source id from another project resolves to nothing and the
 * localization engine never reaches into another module's tables.
 */
export type LocalizationSourceAdapter = {
  readonly sourceType: LocalizationSourceType;
  extract(input: {
    projectId: string;
    sourceId: string;
    sourceLocale: string;
  }): Promise<ExtractedSource | null>;
};

export type LocalizationProviderRequest = {
  strategy: LocalizationStrategy;
  sourceLocale: string;
  targetLocale: string;
  segments: readonly LocalizationSegment[];
  glossary: readonly GlossaryEntry[];
};

export type LocalizationProviderResult = {
  provider: string;
  providerModel: string | null;
  segments: readonly { segmentId: string; targetText: string }[];
};

/**
 * The translation boundary. A provider localizes segments and nothing else; it
 * cannot reach storage, the database or another project, and its output is
 * re-validated before it is ever shown.
 */
export type LocalizationProvider = {
  readonly name: string;
  localize(
    request: LocalizationProviderRequest,
  ): Promise<LocalizationProviderResult>;
};

export class LocalizationProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalizationProviderUnavailableError";
  }
}
