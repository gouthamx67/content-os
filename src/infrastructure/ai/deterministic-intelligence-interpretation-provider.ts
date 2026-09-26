import { IntelligenceError } from "../../core/domain/intelligence";
import type {
  IntelligenceInterpretationProvider,
  IntelligenceInterpretationRequest,
  IntelligenceInterpretationResult,
} from "../../core/ports/intelligence-provider";
import { interpretIntelligenceText } from "./interpret-intelligence-text";

export const DETERMINISTIC_INTELLIGENCE_MODEL = "deterministic-intelligence-v1";

/**
 * Returns raw model text, or an `Error` to simulate a provider failure. Throwing
 * a non-`IntelligenceError` exercises the unexpected-failure path.
 */
export type DeterministicIntelligenceResponder = (
  request: IntelligenceInterpretationRequest,
) => string | Error | Promise<string | Error>;

/**
 * Test-only interpretation provider. It never performs inference, but it goes
 * through the exact same JSON parsing and domain validation as the real AI
 * adapter, so tests exercise the production validation path.
 */
export class DeterministicIntelligenceInterpretationProvider implements IntelligenceInterpretationProvider {
  readonly id = "deterministic-interpretation";

  constructor(
    private readonly responder: DeterministicIntelligenceResponder | string,
    private readonly model: string = DETERMINISTIC_INTELLIGENCE_MODEL,
  ) {}

  async interpret(
    request: IntelligenceInterpretationRequest,
  ): Promise<IntelligenceInterpretationResult> {
    const raw =
      typeof this.responder === "string" ? this.responder : await this.responder(request);

    if (raw instanceof Error) {
      if (raw instanceof IntelligenceError) throw raw;
      throw new IntelligenceError("INTELLIGENCE_AI_UNAVAILABLE", raw.message);
    }

    return interpretIntelligenceText(raw, request, {
      provider: this.id,
      model: this.model,
    });
  }
}
