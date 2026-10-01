import type {
  RecommendationContext,
  RecommendationExistingContent,
} from "../domain/recommendation-context";

/**
 * History exists to answer one question: what has this project already tried?
 * Without it the engine re-suggests the first feature forever, and "gap" means
 * nothing because there is no baseline to compare against.
 *
 * Everything here is derived from records that already exist — CP09 intents and
 * CP11 storyboards — rather than from a new tracking table, so content created
 * outside CP12 still counts.
 */

export type ContentHistory = {
  /** Content types with at least one existing item. */
  coveredContentTypes: string[];

  /** Content types the project has never touched. */
  missingContentTypes: string[];

  /** How many existing items mention each subject id. */
  subjectCounts: Map<string, number>;

  /** Existing items for a subject, most recent first. */
  contentBySubject: Map<string, RecommendationExistingContent[]>;

  /**
   * True when existing content already covers this subject, content type and
   * platform. This is the single definition of "already covered" in CP12: the
   * recommender's ranking, the `isProgress` flag the API serves and any future
   * caller all read coverage from here rather than each deriving their own.
   *
   * Platform participates because the stable opportunity key treats subject +
   * type + platform as one identity — publishing the same demo twice on LinkedIn
   * is not new coverage, but publishing it on LinkedIn and then YouTube is. An
   * existing item that recorded no platform carries no platform constraint and
   * so covers the subject regardless of where the new one would go.
   */
  isCovered(
    subjectIds: readonly string[],
    contentTypeId: string,
    platform?: string,
  ): boolean;
};

/**
 * Whether an existing item counts as having covered a platform. Recorded
 * platforms are an explicit list; an empty list means the record never
 * committed to a destination, so it is not evidence against any particular one.
 */
function platformMatches(
  existingPlatformIds: readonly string[],
  platform: string | undefined,
): boolean {
  if (platform === undefined) return true;
  if (existingPlatformIds.length === 0) return true;
  return existingPlatformIds.includes(platform);
}

export function analyzeContentHistory(
  context: RecommendationContext,
  knownContentTypeIds: readonly string[],
): ContentHistory {
  const subjectCounts = new Map<string, number>();
  const contentBySubject = new Map<string, RecommendationExistingContent[]>();

  for (const content of context.existingContent) {
    for (const subjectId of content.subjectIds) {
      subjectCounts.set(subjectId, (subjectCounts.get(subjectId) ?? 0) + 1);

      const bucket = contentBySubject.get(subjectId);
      if (bucket) {
        bucket.push(content);
      } else {
        contentBySubject.set(subjectId, [content]);
      }
    }
  }

  for (const bucket of contentBySubject.values()) {
    bucket.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  const used = new Set(
    context.existingContent.map((content) => content.contentTypeId),
  );

  return {
    coveredContentTypes: [...used],
    missingContentTypes: knownContentTypeIds.filter((id) => !used.has(id)),
    subjectCounts,
    contentBySubject,

    isCovered(subjectIds, contentTypeId, platform) {
      if (!used.has(contentTypeId)) return false;

      return subjectIds.some((subjectId) =>
        (contentBySubject.get(subjectId) ?? []).some(
          (content) =>
            content.contentTypeId === contentTypeId &&
            platformMatches(content.platformIds, platform),
        ),
      );
    },
  };
}

/**
 * How many times a subject has been covered. Used to damp repeated suggestions
 * without ever suppressing the first one.
 */
export function timesCovered(
  history: ContentHistory,
  subjectId: string | null,
): number {
  if (!subjectId) return 0;
  return history.subjectCounts.get(subjectId) ?? 0;
}
