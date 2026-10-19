import type { AIProvider } from "../../core/ports";

/**
 * The `AIProvider` implementation used when no model endpoint is configured.
 *
 * It exists so the boundary is explicit and honest: a call that needs a model
 * fails with a clear, actionable error instead of being answered by a canned
 * response. It is the same treatment `remote-image-provider` gives image
 * generation — the hole admits it is a hole rather than pretending.
 */
export function createUnconfiguredAIProvider(): AIProvider {
  return {
    async generate(): Promise<never> {
      throw new Error(
        "AI provider is not configured — set CONTENT_OS_AI_BASE_URL/CONTENT_OS_AI_MODEL (or WRITING_LLM_BASE_URL/WRITING_LLM_MODEL) to enable model-backed features",
      );
    },
  };
}
