import type { AIProvider } from "../../core/ports/ai-provider";
import type {
  IntelligenceInterpretationProvider,
  IntelligenceInterpretationRequest,
  IntelligenceInterpretationResult,
} from "../../core/ports/intelligence-provider";
import {
  INTELLIGENCE_SYSTEM_PROMPT,
  buildUserPrompt,
  interpretIntelligenceText,
} from "./interpret-intelligence-text";

export class AiIntelligenceInterpretationProvider implements IntelligenceInterpretationProvider {
  readonly id = "ai-interpretation";

  constructor(
    private readonly ai: AIProvider,
    private readonly options: { defaultModel?: string; temperature?: number } = {},
  ) {}

  async interpret(
    request: IntelligenceInterpretationRequest,
  ): Promise<IntelligenceInterpretationResult> {
    const response = await this.ai.generate({
      model: request.model ?? this.options.defaultModel,
      temperature: this.options.temperature ?? 0,
      messages: [
        { role: "system", content: INTELLIGENCE_SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(request) },
      ],
      metadata: { purpose: "intelligence-interpretation", projectId: request.projectId },
    });

    return interpretIntelligenceText(response.text, request, {
      provider: this.id,
      model: response.model,
    });
  }
}
