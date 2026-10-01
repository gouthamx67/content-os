import { recommendableContentTypeIds } from "../domain/opportunity-registry";
import { getContentType } from "../domain/content-type";
import type { RecommendationContext } from "../domain/recommendation-context";
import type { ContentHistory } from "./content-history-analyzer";

/**
 * "Gap" only means something relative to something else, so a gap here is always
 * stated as the pair that forms it: the content type the project has never used,
 * and the platform or channel it would open up.
 *
 * The list of content types comes from the CP09 registry rather than a local
 * list, so a type added there becomes recommendable here without a second edit.
 */

export type ContentGap = {
  contentTypeId: string;
  channel: string;
  /** 0-100. High when nothing in the project touches this at all. */
  score: number;
  reason: string;
};

export function detectContentGaps(
  context: RecommendationContext,
  history: ContentHistory,
): ContentGap[] {
  const gaps: ContentGap[] = [];

  for (const contentTypeId of recommendableContentTypeIds()) {
    if (history.coveredContentTypes.includes(contentTypeId)) continue;

    const definition = getContentType(contentTypeId);
    if (!definition) continue;

    // Only suggest a channel the project has some standing in. Recommending a
    // video format to a project that has never produced video is not a gap, it
    // is a guess about ambition.
    const platformIsAvailable =
      context.availablePlatforms.length > 0
        ? definition.supportedPlatforms.some((platform) =>
            context.availablePlatforms.includes(platform),
          )
        : true;

    // A channel the project has never used is precisely what a gap is, so it is
    // not treated as a reason to skip. Whether the platform is one it can
    // publish to is a capability question and is still enforced.
    if (!platformIsAvailable) continue;

    gaps.push({
      contentTypeId,
      channel: definition.channel,
      score: context.existingContent.length === 0 ? 100 : 80,
      reason:
        context.existingContent.length === 0
          ? "This project has no published content yet, so every format is open."
          : `Nothing in this project has used ${definition.name} yet.`,
    });
  }

  return gaps.sort((left, right) => right.score - left.score);
}

/** Platforms the project has never published to, among the ones it could. */
export function detectPlatformGaps(context: RecommendationContext): string[] {
  if (context.availablePlatforms.length === 0) return [];
  const used = new Set(
    context.existingContent.flatMap((content) => content.platformIds),
  );
  return context.availablePlatforms.filter((platform) => !used.has(platform));
}
