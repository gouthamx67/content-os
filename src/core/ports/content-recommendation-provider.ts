import type { ContentOpportunity } from "../domain/content-opportunity";
import type { RecommendationContext } from "../domain/recommendation-context";

/**
 * Providers are a discriminated union rather than one interface with two
 * optional methods, so calling the wrong one is a type error instead of a
 * runtime `undefined`.
 *
 * `DETERMINISTIC` derives opportunities from the context alone and must always
 * be present. `AI_REFINEMENT` may only reorder and reword what the deterministic
 * pass produced: it is given the grounded candidates and returns a set of the
 * same size, or its output is discarded. Neither kind may introduce a new
 * opportunity, because that is the only route by which an ungrounded claim could
 * enter.
 */

export type RecommendOptions = {
  maximum: number;
  now: string;
};

export type DeterministicRecommendationProvider = {
  readonly kind: "DETERMINISTIC";
  readonly name: string;
  recommend(
    context: RecommendationContext,
    options: RecommendOptions,
  ): Promise<ContentOpportunity[]>;
};

export type RefinementRecommendationProvider = {
  readonly kind: "AI_REFINEMENT";
  readonly name: string;
  refine(
    context: RecommendationContext,
    current: readonly ContentOpportunity[],
  ): Promise<ContentOpportunity[]>;
};

export type ContentRecommendationProvider =
  | DeterministicRecommendationProvider
  | RefinementRecommendationProvider;
