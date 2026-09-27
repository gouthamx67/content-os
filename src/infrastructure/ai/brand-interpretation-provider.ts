import type { AIProvider } from "../../core/ports/ai-provider";
import type {
  BrandInterpretationProvider,
  BrandInterpretationRequest,
  BrandInterpretationResult,
} from "../../core/ports/brand-interpretation-provider";
import type { BrandTextField } from "../../core/domain/brand";
import { parseBrandInterpretation } from "../../core/domain/brand-interpretation-validation";
import {
  BRAND_SYSTEM_PROMPT,
  buildBrandPrompt,
  extractJsonObject,
} from "./interpret-brand-text";

export class AiBrandInterpretationProvider implements BrandInterpretationProvider {
  readonly id = "ai-brand-interpretation";

  constructor(
    private readonly ai: AIProvider,
    private readonly options: { defaultModel?: string; temperature?: number } = {},
  ) {}

  async interpret(
    request: BrandInterpretationRequest,
  ): Promise<BrandInterpretationResult> {
    const response = await this.ai.generate({
      model: request.model ?? this.options.defaultModel,
      temperature: this.options.temperature ?? 0,
      messages: [
        { role: "system", content: BRAND_SYSTEM_PROMPT },
        { role: "user", content: buildBrandPrompt(request) },
      ],
      metadata: { purpose: "brand-interpretation", projectId: request.projectId },
    });

    return this.parse(response.text, request, {
      provider: this.id,
      model: response.model,
    });
  }

  /**
   * A provider may not hand the service a draft that skipped validation, so
   * every implementation of this method funnels through the same parser.
   */
  parse(
    text: string,
    request: BrandInterpretationRequest,
    identity: { provider: string; model: string },
  ): BrandInterpretationResult {
    const parsed = extractJsonObject(text);
    const alreadyDetermined = new Set<BrandTextField>(request.deterministicFields);
    const context = {
      allowedEvidenceKeys: new Set(request.evidence.map((item) => item.key)),
      alreadyDetermined,
    };
    const draft = parseBrandInterpretation(parsed, context);
    return { provider: identity.provider, model: identity.model, ...draft };
  }
}
