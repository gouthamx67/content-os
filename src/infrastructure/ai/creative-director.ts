/**
 * The AI creative director. It exists to be useful when a model is available and
 * invisible when one is not: if the provider fails, throws, or returns something
 * that does not survive validation, this director raises and the service falls
 * back to the deterministic one rather than storing a weaker answer.
 */

import type { AIProvider } from "../../core/ports/ai-provider";
import type {
  CreativeDirector,
  CreativeDirectorRequest,
  CreativeDirectorResult,
  CreativeDirectionProposal,
} from "../../core/ports/creative-director";
import {
  parseCreativeDraft,
  CreativeValidationFailure,
} from "../../core/services/creative-direction-validator";
import {
  buildCreativePrompt,
  creativeSystemPrompt,
  extractCreativeJson,
} from "./creative-director-prompt";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class AiCreativeDirector implements CreativeDirector {
  readonly id = "ai-creative-director";

  constructor(
    private readonly ai: AIProvider,
    private readonly options: { defaultModel?: string; temperature?: number } = {},
  ) {}

  async generate(
    request: CreativeDirectorRequest,
  ): Promise<CreativeDirectorResult> {
    const response = await this.ai.generate({
      model: this.options.defaultModel,
      temperature:
        this.options.temperature ??
        (request.context.mode === "WILD" ? 0.9 : 0.6),
      messages: [
        { role: "system", content: creativeSystemPrompt(request.context.mode) },
        { role: "user", content: buildCreativePrompt(request.context, request.count) },
      ],
      metadata: {
        purpose: "creative-direction",
        projectId: request.context.projectId,
        intentId: request.context.intentId,
        mode: request.context.mode,
      },
    });

    const proposals = this.parse(response.text, request);

    return {
      provider: this.id,
      model: response.model,
      proposals,
    };
  }

  /**
   * Every provider funnels through this, so no implementation can hand the
   * service a direction that skipped the shared parser and its context checks.
   */
  parse(text: string, request: CreativeDirectorRequest): CreativeDirectionProposal[] {
    let parsed: unknown;
    try {
      parsed = extractCreativeJson(text);
    } catch (error) {
      // A response that held no JSON is a validation failure, not a crash: the
      // service reports it as the reason it fell back rather than as a bug.
      throw new CreativeValidationFailure([
        {
          code: "CREATIVE_INVALID_OUTPUT",
          message: error instanceof Error ? error.message : "Unreadable response",
        },
      ]);
    }
    const list = isRecord(parsed) && Array.isArray(parsed.directions)
      ? parsed.directions
      : Array.isArray(parsed)
        ? parsed
        : null;

    if (!list || list.length === 0) {
      throw new CreativeValidationFailure([
        {
          code: "CREATIVE_INVALID_OUTPUT",
          message: "Creative director response held no directions",
        },
      ]);
    }

    const proposals: CreativeDirectionProposal[] = [];

    list.slice(0, request.count + 2).forEach((entry, index) => {
      if (!isRecord(entry)) {
        throw new CreativeValidationFailure([
          {
            code: "CREATIVE_INVALID_OUTPUT",
            message: `Direction ${index + 1} was not an object`,
          },
        ]);
      }

      // `id` and `description` label the proposal rather than describe the
      // direction, so they are read here and kept out of the draft the strict
      // parser checks. A proposal is a wrapper; a draft is the thing itself.
      const { id: proposedId, description, ...draftFields } = entry;

      const draft = parseCreativeDraft(draftFields, request.context);

      proposals.push({
        id:
          typeof proposedId === "string" && proposedId.trim()
            ? proposedId.trim()
            : `ai-${index + 1}`,
        name: String(draft.name),
        description:
          typeof description === "string" ? description : String(draft.rationale),
        draft,
      });
    });

    return proposals;
  }
}
