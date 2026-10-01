import type { ContentOpportunity } from "../domain/content-opportunity";
import type { RecommendationContext } from "../domain/recommendation-context";
import { getContentType } from "../domain/content-type";
import { getPlatform } from "../domain/platform";

/**
 * Selecting a recommendation must produce a real CP09 Content Intent, resolved
 * by CP09's own parser and resolver. This module's only job is to phrase the
 * opportunity as a request CP09 can read deterministically — it deliberately does
 * not set contentTypeId, platforms or subjects itself, because doing so would
 * mean CP12 second-guessing the resolver that CP09 already owns.
 *
 * Phrasing is therefore chosen from vocabulary CP09's parser recognises
 * ("demo", "carousel", "explainer", "launch video", "LinkedIn post", "X post",
 * "Product Hunt", "launch campaign"), and the subject is named in the
 * "<label> workflow" / "<label> feature" form its subject rules expect, so
 * CP09 links the mention to the real entity id rather than storing free text.
 */

export type IntentDraft = {
  /** Phrased for CP09's parser. */
  request: string;
};

export function buildIntentDraft(
  opportunity: ContentOpportunity,
  context: RecommendationContext,
): IntentDraft {
  const platform = getPlatform(opportunity.platform);
  const platformName = platform?.name ?? opportunity.platform;

  const phrasing = phraseByContentType(opportunity.contentTypeId);
  const subjectPhrase = subjectPhraseFor(opportunity, context);
  const audience = context.audienceSignals[0]?.segment;

  const parts = [
    subjectPhrase
      ? `${phrasing} ${subjectPhrase}`
      : phrasing,
    audience ? `for ${audience}` : null,
    `on ${platformName}`,
  ].filter((part): part is string => Boolean(part));

  const duration = recommendedDuration(opportunity.contentTypeId);
  if (duration) parts.push(`${duration} seconds.`);

  return { request: parts.join(" ").trim() };
}

/**
 * A phrase CP09's parser maps to the content type. Falls back to the content
 * type's own name, which the parser recognises for the main cases.
 */
function phraseByContentType(contentTypeId: string): string {
  switch (contentTypeId) {
    case "video.product_demo":
      return "Product demo";
    case "video.launch":
      return "Launch video";
    case "video.explainer":
      return "Explainer";
    case "video.social":
      return "Social video";
    case "video.ad":
      return "Video ad";
    case "image.carousel":
      return "Carousel";
    case "image.ad":
      return "Ad creative";
    case "image.thumbnail":
      return "Thumbnail";
    case "text.linkedin":
      return "LinkedIn post";
    case "text.x":
      return "X post";
    case "text.product_hunt":
      return "Product Hunt listing";
    case "campaign.launch":
      return "Launch campaign";
    default:
      return getContentType(contentTypeId)?.name ?? "Content";
  }
}

/**
 * Phrases the subject so CP09's subject rules recognise the entity type and can
 * resolve the label to an id. Order matters: the most specific type that can
 * describe this opportunity is used, so a workflow is never reduced to a
 * feature mention.
 */
function subjectPhraseFor(
  opportunity: ContentOpportunity,
  context: RecommendationContext,
): string | null {
  const label = opportunity.subjectLabel.trim();
  if (!label) return null;

  switch (opportunity.subjectType) {
    case "PRODUCT":
      // CP09 resolves a generic product mention to the project's product.
      return opportunity.subjectId === null ? "the product" : `the ${label}`;
    case "FEATURE":
      return `the ${label} feature`;
    case "WORKFLOW":
      return `the ${label} workflow`;
    case "PROBLEM":
      return `the ${label} problem`;
    case "BENEFIT":
      return `the ${label} benefit`;
    case "CLAIM":
      // A claim is grounded in its text; CP09 matches claim mentions by text.
      return `the ${label} claim`;
    default:
      return context.product ? "the product" : null;
  }
}

/** Only for types whose CP09 definition supports duration. */
function recommendedDuration(contentTypeId: string): number | null {
  const definition = getContentType(contentTypeId);
  if (!definition?.supportsDuration) return null;
  return 30;
}
