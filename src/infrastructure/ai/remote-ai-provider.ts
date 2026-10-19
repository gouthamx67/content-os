import {
  llmEndpointLabel,
  requestChatCompletion,
  type LlmEndpoint,
} from "../../lib/llm-chat";
import type { AIProvider, AIRequest, AIResponse } from "../../core/ports";

/**
 * The real implementation of the `AIProvider` port.
 *
 * Every model-assisted seam in the product — intelligence and brand
 * interpretation, content intent, the creative director, the storyboard
 * planner, the recommendation refiner, the browser planner, the editor's
 * remote proposals — was written against this port and validates whatever
 * comes back with its own strict schema parser. For a long time the only
 * implementation was a mock, so the seams were effectively dormant. This is
 * the provider those seams were designed for: an OpenAI-compatible chat
 * endpoint, a real request, the model's actual text handed to the existing
 * validators. When it fails, it throws, and the service falls back to the
 * deterministic path — never to a fabricated answer.
 *
 * Configuration precedence mirrors localization: `CONTENT_OS_AI_*` names the
 * seam's own endpoint, and the `WRITING_LLM_*` names are reused when the seam
 * has none, so a deployment that already points at a model for writing gets
 * model-assisted interpretation with no extra configuration.
 */

export type RemoteAiConfig = {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
};

function configFrom(
  baseUrl: string | undefined,
  model: string | undefined,
  apiKey: string | undefined,
  timeoutMs: string | undefined,
): RemoteAiConfig | null {
  const url = baseUrl?.trim();
  const name = model?.trim();
  if (!url || !name) return null;
  const timeoutRaw = Number.parseInt(timeoutMs ?? "", 10);
  return {
    baseUrl: url.replace(/\/+$/, ""),
    apiKey: apiKey?.trim() ?? null,
    model: name,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 30_000,
  };
}

export function remoteAiConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): RemoteAiConfig | null {
  return configFrom(
    env["CONTENT_OS_AI_BASE_URL"] ?? env["WRITING_LLM_BASE_URL"],
    env["CONTENT_OS_AI_MODEL"] ?? env["WRITING_LLM_MODEL"],
    env["CONTENT_OS_AI_API_KEY"] ?? env["WRITING_LLM_API_KEY"],
    env["CONTENT_OS_AI_TIMEOUT_MS"] ?? env["WRITING_LLM_TIMEOUT_MS"],
  );
}

const MAX_AI_FALLBACKS = 3;

function fallbackConfigAt(
  env: Record<string, string | undefined>,
  index: number,
): RemoteAiConfig | null {
  const suffix = index === 1 ? "" : `_${index}`;
  return configFrom(
    env[`CONTENT_OS_AI_FALLBACK${suffix}_BASE_URL`] ??
      env[`WRITING_LLM_FALLBACK${suffix}_BASE_URL`],
    env[`CONTENT_OS_AI_FALLBACK${suffix}_MODEL`] ??
      env[`WRITING_LLM_FALLBACK${suffix}_MODEL`],
    env[`CONTENT_OS_AI_FALLBACK${suffix}_API_KEY`] ??
      env[`WRITING_LLM_FALLBACK${suffix}_API_KEY`],
    env[`CONTENT_OS_AI_FALLBACK${suffix}_TIMEOUT_MS`] ??
      env[`WRITING_LLM_FALLBACK${suffix}_TIMEOUT_MS`],
  );
}

/** The ordered fallback list the container hands to the provider factory. */
export function remoteAiFallbackChainFromEnv(
  env: Record<string, string | undefined> = process.env,
): RemoteAiConfig[] {
  const chain: RemoteAiConfig[] = [];
  for (let index = 1; index <= MAX_AI_FALLBACKS; index += 1) {
    const config = fallbackConfigAt(env, index);
    if (config) chain.push(config);
  }
  return chain;
}

function toEndpoint(config: RemoteAiConfig): LlmEndpoint {
  return {
    label: llmEndpointLabel(config.baseUrl),
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
  };
}

export function createRemoteAiProvider(
  config: RemoteAiConfig,
  fallbacks: readonly RemoteAiConfig[] = [],
): AIProvider {
  const endpoints = [toEndpoint(config), ...fallbacks.map(toEndpoint)];

  return {
    async generate(request: AIRequest): Promise<AIResponse> {
      const completion = await requestChatCompletion(endpoints, request.messages, {
        temperature: request.temperature,
        ...(request.model ? { model: request.model } : {}),
      });

      return {
        text: completion.content,
        model: completion.model,
        ...(completion.usage ? { usage: completion.usage } : {}),
      };
    },
  };
}
