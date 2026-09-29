import { parseContentIntentInterpretation } from "../../core/domain/content-intent-ai-validation";
import type { AIProvider } from "../../core/ports/ai-provider";
import type {
  ContentIntentInterpretation,
  ContentIntentInterpretationProvider,
  ContentIntentInterpretationRequest,
} from "../../core/ports/content-intent-interpreter";
import {
  buildContentIntentPrompt,
  CONTENT_INTENT_SYSTEM_PROMPT,
  extractIntentJsonObject,
} from "./interpret-content-intent-text";

export class AiContentIntentInterpreter
  implements ContentIntentInterpretationProvider
{
  readonly id = "ai-content-intent";

  constructor(
    private readonly ai: AIProvider,
    private readonly options: { defaultModel?: string; temperature?: number } = {},
  ) {}

  async interpret(
    request: ContentIntentInterpretationRequest,
  ): Promise<ContentIntentInterpretation> {
    const response = await this.ai.generate({
      model: request.model ?? this.options.defaultModel,
      temperature: this.options.temperature ?? 0,
      messages: [
        { role: "system", content: CONTENT_INTENT_SYSTEM_PROMPT },
        { role: "user", content: buildContentIntentPrompt(request) },
      ],
      metadata: { purpose: "content-intent", projectId: request.projectId },
    });

    return this.parse(response.text, {
      provider: this.id,
      model: response.model,
    });
  }

  /**
   * A provider may not hand the service a draft that skipped validation, so
   * every implementation funnels through the same parser.
   */
  parse(
    text: string,
    identity: { provider: string; model: string },
  ): ContentIntentInterpretation {
    const parsed = parseContentIntentInterpretation(
      extractIntentJsonObject(text),
    );
    return { ...parsed, provider: identity.provider, model: identity.model };
  }
}
