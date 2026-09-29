/**
 * A content intent is the answer to "what did the user ask for", and nothing
 * else. It carries the requested asset, its measurable constraints, the
 * project context it was resolved against, and an honest record of what is
 * still missing. It deliberately holds no hook, no story structure and no
 * visual treatment: those are Creative Director decisions (CP10), and an intent
 * that pre-empts them would make the request unreviewable.
 */

import type { ContentChannel, ContentTypeDefinition } from "./content-type";

export type { ContentChannel };

export const INTENT_RESOLUTION_MODES = [
  "EXPLICIT",
  "INFERRED",
  "PARTIAL",
  "NEEDS_CLARIFICATION",
] as const;
export type IntentResolutionMode = (typeof INTENT_RESOLUTION_MODES)[number];

export const INTENT_STATUSES = [
  "DRAFT",
  "RESOLVED",
  "NEEDS_CLARIFICATION",
  "BLOCKED",
] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export const INTENT_CONFIDENCE_LEVELS = [
  "HIGH",
  "MEDIUM",
  "LOW",
] as const;
export type IntentConfidence = (typeof INTENT_CONFIDENCE_LEVELS)[number];

export const ASPECT_RATIOS = [
  "16:9",
  "9:16",
  "1:1",
  "4:5",
  "4:3",
  "CUSTOM",
] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** The ratios a request may name, excluding the `CUSTOM` escape hatch. */
export const NAMED_ASPECT_RATIOS = ASPECT_RATIOS.filter(
  (ratio) => ratio !== "CUSTOM",
) as readonly Exclude<AspectRatio, "CUSTOM">[];

export function isAspectRatio(value: unknown): value is AspectRatio {
  return (
    typeof value === "string" &&
    (ASPECT_RATIOS as readonly string[]).includes(value)
  );
}

export const INTENT_CONSTRAINT_KEYS = [
  "contentType",
  "duration",
  "aspectRatio",
  "language",
  "tone",
  "style",
  "platform",
  "quantity",
  "cta",
  "audience",
  "custom",
] as const;
export type ContentIntentConstraintKey =
  (typeof INTENT_CONSTRAINT_KEYS)[number];

/**
 * Where a constraint came from. `AI` is its own source because an inferred
 * value must never be laundered into `USER`: a later checkpoint reading the
 * constraints has to be able to tell what the user actually said from what the
 * system guessed. `SYSTEM` is reserved for deterministic defaults.
 */
export const INTENT_CONSTRAINT_SOURCES = [
  "USER",
  "PROJECT",
  "BRAND",
  "AI",
  "SYSTEM",
] as const;
export type ContentIntentConstraintSource =
  (typeof INTENT_CONSTRAINT_SOURCES)[number];

export type ContentIntentConstraint = {
  key: ContentIntentConstraintKey;
  value: string;
  source: ContentIntentConstraintSource;
};

export const INTENT_SUBJECT_TYPES = [
  "PRODUCT",
  "FEATURE",
  "WORKFLOW",
  "PROBLEM",
  "BENEFIT",
  "CLAIM",
  "ASSET",
] as const;
export type IntentSubjectType = (typeof INTENT_SUBJECT_TYPES)[number];

/**
 * A subject is a reference into the product intelligence graph, never a copy
 * of it. The id is an existing entity id, so a later job can re-read what the
 * subject meant at the time the intent was resolved.
 */
export type IntentSubject = {
  type: IntentSubjectType;
  id: string;
};

export const CLARIFIABLE_FIELDS = [
  "contentType",
  "platform",
  "duration",
  "audience",
  "language",
  "quantity",
] as const;
export type ClarifiableField = (typeof CLARIFIABLE_FIELDS)[number];

export type IntentClarificationOption = {
  value: string;
  label: string;
};

/**
 * One question, asked only when the answer changes what gets produced.
 * Options are offered as an unordered menu of possibilities, never as a ranked
 * recommendation: recommending an asset is Checkpoint 12's job.
 */
export type IntentClarification = {
  field: ClarifiableField;
  question: string;
  options?: IntentClarificationOption[];
};

export type ContentIntent = {
  id: string;
  projectId: string;

  rawRequest: string;

  channel: ContentChannel;

  contentTypeId: string;

  purpose?: string;

  platforms: string[];

  subjects: IntentSubject[];

  audience?: string;

  language?: string;

  tone?: string;

  style?: string;

  durationSeconds?: number;

  quantity: number;

  aspectRatio?: AspectRatio;

  customAspectRatio?: {
    width: number;
    height: number;
  };

  cta?: string;

  constraints: ContentIntentConstraint[];

  resolutionMode: IntentResolutionMode;

  status: IntentStatus;

  confidence: IntentConfidence;

  unresolvedFields: string[];

  /**
   * Why this intent reads the way it does: a default that was applied, a value
   * that was inferred, a brand signal CP09 could not use. Shown in the editor
   * next to the field it explains, so nothing is silently decided.
   */
  notes: string[];

  sourceIds: string[];

  brandVersion?: number;

  intelligenceSnapshotVersion?: number;

  createdAt: string;
  updatedAt: string;
};

export const CONTENT_INTENT_ERROR_CODES = [
  "INTENT_INVALID_INPUT",
  "INTENT_REQUEST_EMPTY",
  "INTENT_NOT_FOUND",
  "INTENT_FORBIDDEN",
  "INTENT_SCOPE_VIOLATION",
  "INTENT_VALIDATION_FAILED",
  "INTENT_CONFLICT",
  "INTENT_AI_INVALID_OUTPUT",
  "INTENT_AI_UNAVAILABLE",
] as const;
export type ContentIntentErrorCode =
  (typeof CONTENT_INTENT_ERROR_CODES)[number];

export class ContentIntentError extends Error {
  override readonly name = "ContentIntentError";

  /**
   * Validation issues ride along with the error so an API caller receives the
   * specific codes (`CONTENT_TYPE_DOES_NOT_SUPPORT_DURATION`) instead of one
   * opaque "invalid intent".
   */
  readonly issues: readonly string[];

  constructor(
    readonly code: ContentIntentErrorCode,
    message: string,
    issues: readonly string[] = [],
  ) {
    super(message);
    this.issues = [...issues];
  }
}

/**
 * Languages are normalised to codes at parse time so a later localisation step
 * (CP22) can match on a stable value instead of a display name. Full language
 * support is out of scope here; this is only the vocabulary CP09 recognises.
 */
export const INTENT_LANGUAGES: ReadonlyArray<{
  code: string;
  label: string;
}> = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
];

export function isIntentLanguage(value: string): boolean {
  return INTENT_LANGUAGES.some(
    (language) =>
      language.code === value.toLowerCase() ||
      language.label.toLowerCase() === value.toLowerCase(),
  );
}

export function intentLanguageCode(value: string): string | null {
  const needle = value.trim().toLowerCase();
  const match = INTENT_LANGUAGES.find(
    (language) =>
      language.code === needle ||
      language.label.toLowerCase() === needle,
  );
  return match?.code ?? null;
}

export function contentIntentConstraint(
  key: ContentIntentConstraintKey,
  value: string,
  source: ContentIntentConstraintSource,
): ContentIntentConstraint {
  return { key, value, source };
}

/**
 * The shape a later checkpoint receives. Everything CP10 needs to plan is here
 * and nothing about *how* to make it is.
 */
export function toContentJobBrief(intent: ContentIntent): {
  contentTypeId: string;
  platforms: string[];
  durationSeconds: number | undefined;
  quantity: number;
  aspectRatio: AspectRatio | undefined;
  tone: string | undefined;
  style: string | undefined;
  language: string | undefined;
  audience: string | undefined;
  cta: string | undefined;
  subjects: IntentSubject[];
  brandVersion: number | undefined;
  intelligenceSnapshotVersion: number | undefined;
} {
  return {
    contentTypeId: intent.contentTypeId,
    platforms: [...intent.platforms],
    durationSeconds: intent.durationSeconds,
    quantity: intent.quantity,
    aspectRatio: intent.aspectRatio,
    tone: intent.tone,
    style: intent.style,
    language: intent.language,
    audience: intent.audience,
    cta: intent.cta,
    subjects: intent.subjects.map((subject) => ({ ...subject })),
    brandVersion: intent.brandVersion,
    intelligenceSnapshotVersion: intent.intelligenceSnapshotVersion,
  };
}

export type { ContentTypeDefinition };
