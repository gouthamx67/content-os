import type { ContentOpportunity } from "../../core/domain/content-opportunity";
import type {
  DeterministicRecommendationProvider,
  RecommendOptions,
} from "../../core/ports/content-recommendation-provider";
import type { RecommendationContext } from "../../core/domain/recommendation-context";
import { generateOpportunities } from "../../core/services/deterministic-content-recommender";
import { diversifyByChannel } from "../../core/services/recommendation-diversity";

/**
 * Wraps the pure recommender as the provider the service depends on.
 *
 * Generating a superset and then diversifying is what keeps the served list
 * channel-diverse: a project that only ever got video before is shown the best
 * item from each channel it can use, rather than its entire budget of demos.
 */
export class DeterministicContentRecommenderProvider
  implements DeterministicRecommendationProvider
{
  readonly kind = "DETERMINISTIC" as const;
  readonly name = "deterministic-content-recommender";

  async recommend(
    context: RecommendationContext,
    options: RecommendOptions,
  ): Promise<ContentOpportunity[]> {
    const superset = generateOpportunities({
      context,
      maximum: options.maximum * 2,
      now: options.now,
    });
    const { selected } = diversifyByChannel(superset, options.maximum);
    return selected;
  }
}