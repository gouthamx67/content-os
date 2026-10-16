/**
 * The localization engine's canonical vocabulary.
 *
 * Everything here is deliberately narrow: a job points at one source revision in
 * one locale, and it produces a new, traceable set of segments — never a rewrite
 * of the source. A locale is stored canonical (`pt-BR`, not `pt-br`), and its
 * direction is configured, never guessed from the language name.
 */

export const LOCALIZATION_STRATEGIES = ["TRANSLATE", "TRANSCREATE"] as const;
export type LocalizationStrategy = (typeof LOCALIZATION_STRATEGIES)[number];

/**
 * Which upstream checkpoint a job localizes.
 *
 * The adapter that owns each type resolves the source through the owning
 * module's repository, so the localization engine never reads another module's
 * tables directly.
 */
export const LOCALIZATION_SOURCE_TYPES = [
  "WRITING_DOCUMENT",
  "EDITOR_DOCUMENT",
  "ADAPTATION_JOB",
  "CAMPAIGN",
] as const;
export type LocalizationSourceType = (typeof LOCALIZATION_SOURCE_TYPES)[number];

export const LOCALIZATION_STATUSES = [
  "DRAFT",
  "READY_TO_LOCALIZE",
  "PROCESSING",
  "NEEDS_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "APPLIED",
  "STALE",
  "FAILED",
] as const;
export type LocalizationStatus = (typeof LOCALIZATION_STATUSES)[number];

/**
 * What a segment is, in source terms. The kind is carried through localization
 * unchanged so a reviewer can tell a CTA from legal copy.
 */
export const LOCALIZATION_SEGMENT_KINDS = [
  "HEADLINE",
  "BODY",
  "CTA",
  "CAPTION",
  "SUBTITLE",
  "ALT_TEXT",
  "LEGAL",
  "BUTTON",
  "METADATA",
] as const;
export type LocalizationSegmentKind =
  (typeof LOCALIZATION_SEGMENT_KINDS)[number];

export const TEXT_DIRECTIONS = ["LTR", "RTL"] as const;
export type TextDirection = (typeof TEXT_DIRECTIONS)[number];

export const LOCALIZATION_SOURCE_LOCALES = ["en"] as const;

/**
 * One addressable unit of text.
 *
 * `path` is a stable locator inside the source (for example
 * `deliverable:<id>:title`), so a localized segment can always be traced back to
 * the exact field it came from, even after ids are remapped.
 */
export type LocalizationSegment = {
  id: string;
  kind: LocalizationSegmentKind;
  path: string;
  sourceText: string;
  targetText: string | null;
  /** Placeholder tokens found in the source, e.g. `{brand}` or `%s`. */
  placeholders: string[];
  /** Terms the glossary pinned, as `source -> target`. */
  glossary: Record<string, string>;
  metadata: Record<string, string>;
};

export type LocalizationRequest = {
  sourceType: LocalizationSourceType;
  sourceId: string;
  sourceLocale: string;
  targetLocale: string;
  strategy: LocalizationStrategy;
};

export type LocalizationFindingSeverity = "INFO" | "WARNING" | "ERROR";

/**
 * A concrete, addressable problem. Readiness is never a boolean without reasons:
 * every refusal names a code, a severity and (when it applies) the segment it
 * concerns.
 */
export type LocalizationFinding = {
  code: string;
  severity: LocalizationFindingSeverity;
  segmentId: string | null;
  message: string;
};

export type LocalizationReadiness = {
  ready: boolean;
  findings: LocalizationFinding[];
};

export type ProjectLocaleRecord = {
  id: string;
  projectId: string;
  locale: string;
  label: string;
  direction: TextDirection;
  isSource: boolean;
  isTarget: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

export type LocaleGlossaryRecord = {
  id: string;
  projectId: string;
  sourceLocale: string;
  targetLocale: string;
  term: string;
  translation: string;
  doNotTranslate: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

export type TranslationMemoryRecord = {
  id: string;
  projectId: string;
  sourceLocale: string;
  targetLocale: string;
  sourceHash: string;
  sourceText: string;
  targetText: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

export type LocalizationJobRecord = {
  id: string;
  projectId: string;
  sourceType: LocalizationSourceType;
  sourceId: string;
  sourceRevision: string;
  sourceHash: string;
  sourceLocale: string;
  targetLocale: string;
  strategy: LocalizationStrategy;
  status: LocalizationStatus;
  provider: string | null;
  headRevisionNumber: number;
  approvalRevisionNumber: number | null;
  approvedById: string | null;
  approvedAt: string | null;
  appliedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

export type LocalizationRevisionRecord = {
  id: string;
  jobId: string;
  revisionNumber: number;
  kind: LocalizationRevisionKind;
  snapshot: LocalizationSnapshot;
  snapshotHash: string;
  createdById: string;
  createdAt: string;
};

export const LOCALIZATION_REVISION_KINDS = [
  "CREATE",
  "SEGMENT_EDITED",
  "PROCESSED",
  "VALIDATED",
  "SUBMITTED",
  "CHANGES_REQUESTED",
  "APPROVED",
  "APPLIED",
  "MARKED_STALE",
  "FAILED",
] as const;
export type LocalizationRevisionKind =
  (typeof LOCALIZATION_REVISION_KINDS)[number];

/**
 * The immutable body of a revision.
 *
 * A revision stores the whole segment list plus the facts a reviewer acts on:
 * where the source came from, which provider produced the target, and the
 * findings validation reported. Approving a revision approves exactly these
 * bytes and nothing later.
 */
export type LocalizationSnapshot = {
  request: LocalizationRequest;
  sourceRevision: string;
  sourceHash: string;
  provider: string | null;
  providerModel: string | null;
  segments: LocalizationSegment[];
  findings: LocalizationFinding[];
  readiness: LocalizationReadiness;
};

export type LocalizationProvenance = {
  provider: string;
  providerModel: string | null;
  strategy: LocalizationStrategy;
  sourceType: LocalizationSourceType;
  sourceId: string;
  sourceRevision: string;
  sourceHash: string;
  sourceLocale: string;
  targetLocale: string;
  generatedAt: string;
};
