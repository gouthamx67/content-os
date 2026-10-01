import type { AIProvider } from "../../core/ports/ai-provider";
import {
  RecommendationError,
  type ContentOpportunity,
} from "../../core/domain/content-opportunity";
import type {
  RefinementRecommendationProvider,
} from "../../core/ports/content-recommendation-provider";
import type { RecommendationContext } from "../../core/domain/recommendation-context";
import { parseRecommendationRefinement } from "../../core/domain/recommendation-refinement-validation";
import {
  buildRecommendationRefinementPrompt,
  RECOMMENDATION_REFINEMENT_SYSTEM_PROMPT,
  extractRecommendationJsonObject,
} from "./interpret-recommendation-refinement-text";

/**
 * Optional model pass over the deterministic recommendations.
 *
 * The model is given the grounded candidates and may only reorder them and
 * reword the advisory text. It is never asked for a new opportunity, because a
 * new opportunity is the one thing a model cannot do safely here: it would have
 * to invent the grounding. Whatever it returns is therefore merged back onto the
 * deterministic candidates by their stable key, and anything that fails to parse,
 * refers to an unknown key, or changes the size of the set is discarded by the
 * service.
 *
 * Merging is a spread of the untouched candidate with three text fields replaced.
 * That is what keeps the server-owned state intact: the evidence, the subject,
 * the score, the status, the project and the stable key all come from the
 * deterministic pass and are not rewritable, because a reworded title must not be
 * able to move the grounding underneath it.
 *
 * The stable key is the handle rather than the row id because these candidates
 * were just generated and have no rows yet — their ids are still empty. Keying on
 * the id would collapse the whole batch onto a single entry and make refinement
 * silently drop everything.
 */
export class AiContentRecommendationRefiner
  implements RefinementRecommendationProvider
{
  readonly kind = "AI_REFINEMENT" as const;
  readonly name = "ai-content-recommendation-refiner";

  constructor(
    private readonly ai: AIProvider,
    private readonly options: { defaultModel?: string; temperature?: number } = {},
  ) {}

  async refine(
    context: RecommendationContext,
    current: readonly ContentOpportunity[],
  ): Promise<ContentOpportunity[]> {
    if (current.length === 0) return [];

    const response = await this.ai.generate({
      model: this.options.defaultModel,
      temperature: this.options.temperature ?? 0,
      messages: [
        { role: "system", content: RECOMMENDATION_REFINEMENT_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildRecommendationRefinementPrompt(context, current),
        },
      ],
      metadata: { purpose: "content-recommendation-refinement" },
    });

    const rewrites = parseRecommendationRefinement(
      extractRecommendationJsonObject(response.text),
    );

    // The model's contribution is text, so it is applied by looking each rewrite
    // up against the deterministic candidate it claims to refine. A key that is
    // not present simply does not match, and the size check then fails the whole
    // batch rather than letting a partial rewrite through.
    const byKey = new Map(current.map((opportunity) => [opportunity.key, opportunity]));
    return rewrites.map((rewrite) => {
      const base = byKey.get(rewrite.key);
      if (!base) {
        throw new RecommendationError(
          "RECOMMENDATION_INVALID_INPUT",
          `Refinement refers to unknown recommendation ${rewrite.key}`,
        );
      }
      return {
        ...base,
        title: rewrite.title ?? base.title,
        rationale: rewrite.rationale ?? base.rationale,
        reasons: rewrite.reasons ?? base.reasons,
      };
    });
  }
}