import {
  llmEndpointLabel,
  requestChatCompletion,
  type LlmEndpoint,
} from "../../../lib/llm-chat";
import { LocalizationError } from "../errors";
import { parseProviderOutput } from "../domain/schema";
import type {
  LocalizationProvider,
  LocalizationProviderRequest,
  LocalizationProviderResult,
} from "../integrations/ports";

export const REMOTE_LLM_PROVIDER = "remote-llm";

export type LocalizationLlmConfig = {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
};

/**
 * Reads remote translation settings from the environment.
 *
 * The `LOCALIZATION_LLM_*` variables are preferred; when they are absent the
 * `WRITING_LLM_*` variables are reused, so a deployment that already points at
 * an OpenAI-compatible model for writing can enable translation with no extra
 * configuration. A base URL and a model are the minimum: without both, the
 * registry is never given a remote provider and a `remote-llm` request fails
 * loudly instead of silently degrading to the rules provider.
 */
export function localizationLlmConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): LocalizationLlmConfig | null {
  const baseUrl = (
    env["LOCALIZATION_LLM_BASE_URL"] ?? env["WRITING_LLM_BASE_URL"]
  )?.trim();
  const model = (
    env["LOCALIZATION_LLM_MODEL"] ?? env["WRITING_LLM_MODEL"]
  )?.trim();
  if (!baseUrl || !model) return null;

  const timeoutRaw = Number.parseInt(
    env["LOCALIZATION_LLM_TIMEOUT_MS"] ?? env["WRITING_LLM_TIMEOUT_MS"] ?? "",
    10,
  );

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey:
      (env["LOCALIZATION_LLM_API_KEY"] ?? env["WRITING_LLM_API_KEY"])?.trim() ??
      null,
    model,
    timeoutMs:
      Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 45_000,
  };
}

/**
 * Fallback endpoints, mirroring the primary's precedence: a localization
 * fallback wins over the writing fallback, so a deployment that already names
 * a Groq/NVIDIA/OpenRouter chain for writing gets it for translation too. Slot
 * 1 uses the original unnumbered names; later slots add `_2_`, `_3_`.
 */
const MAX_LOCALIZATION_LLM_FALLBACKS = 3;

function fallbackConfigAt(
  env: Record<string, string | undefined>,
  index: number,
): LocalizationLlmConfig | null {
  const suffix = index === 1 ? "" : `_${index}`;
  const baseUrl = (
    env[`LOCALIZATION_LLM_FALLBACK${suffix}_BASE_URL`] ??
    env[`WRITING_LLM_FALLBACK${suffix}_BASE_URL`]
  )?.trim();
  const model = (
    env[`LOCALIZATION_LLM_FALLBACK${suffix}_MODEL`] ??
    env[`WRITING_LLM_FALLBACK${suffix}_MODEL`]
  )?.trim();
  if (!baseUrl || !model) return null;

  const timeoutRaw = Number.parseInt(
    env[`LOCALIZATION_LLM_FALLBACK${suffix}_TIMEOUT_MS`] ??
      env[`WRITING_LLM_FALLBACK${suffix}_TIMEOUT_MS`] ??
      "",
    10,
  );

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey:
      (
        env[`LOCALIZATION_LLM_FALLBACK${suffix}_API_KEY`] ??
        env[`WRITING_LLM_FALLBACK${suffix}_API_KEY`]
      )?.trim() ?? null,
    model,
    timeoutMs:
      Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 45_000,
  };
}

/** The first fallback endpoint, for callers that want exactly one. */
export function localizationLlmFallbackFromEnv(
  env: Record<string, string | undefined> = process.env,
): LocalizationLlmConfig | null {
  return fallbackConfigAt(env, 1);
}

/** The ordered fallback list the container hands to the provider factory. */
export function localizationLlmFallbackChainFromEnv(
  env: Record<string, string | undefined> = process.env,
): LocalizationLlmConfig[] {
  const chain: LocalizationLlmConfig[] = [];
  for (let index = 1; index <= MAX_LOCALIZATION_LLM_FALLBACKS; index += 1) {
    const config = fallbackConfigAt(env, index);
    if (config) chain.push(config);
  }
  return chain;
}

function toEndpoint(config: LocalizationLlmConfig): LlmEndpoint {
  return {
    label: llmEndpointLabel(config.baseUrl),
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
  };
}

function glossaryBlock(request: LocalizationProviderRequest): string {
  const lines = request.glossary
    .map((entry) =>
      entry.doNotTranslate
        ? `- do not translate: ${entry.term}`
        : `- ${entry.term} => ${entry.translation}`,
    )
    .slice(0, 100);
  return lines.length > 0 ? lines.join("\n") : "(none)";
}

function segmentBlock(request: LocalizationProviderRequest): string {
  return request.segments
    .map(
      (segment) =>
        JSON.stringify({ segmentId: segment.id, sourceText: segment.sourceText }),
    )
    .join("\n");
}

function buildPrompt(request: LocalizationProviderRequest): string {
  const verb =
    request.strategy === "TRANSCREATE"
      ? "Transcreate (adapt idiom, tone and cultural references, not a literal rendering)"
      : "Translate (a faithful rendering that reads naturally in the target language)";
  return [
    `${verb} each segment from ${request.sourceLocale} to ${request.targetLocale}.`,
    "Keep every placeholder token exactly as written (for example {brand} or %s); never translate the text inside a placeholder.",
    "Honor the glossary: render a pinned term with its target form and leave a 'do not translate' term verbatim.",
    "Do not add, drop, merge or reorder segments. Translate only the text.",
    "Glossary:",
    glossaryBlock(request),
    "Segments (one JSON object per line):",
    segmentBlock(request),
    'Return strict JSON: {"segments": [{"segmentId": "...", "targetText": "..."}]}.',
  ].join("\n");
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        // fall through to the structured error below
      }
    }
    throw new LocalizationError(
      "LOCALIZATION_PROVIDER_INVALID_OUTPUT",
      "The remote provider did not return JSON",
    );
  }
}

function parseSegments(payload: unknown): { segmentId: string; targetText: string }[] {
  const raw =
    Array.isArray(payload) ? payload : (payload as { segments?: unknown })?.segments;
  return parseProviderOutput(raw).map((segment) => ({
    segmentId: segment.segmentId,
    targetText: segment.targetText,
  }));
}

/**
 * Real machine translation through the project's OpenAI-compatible endpoint.
 *
 * The provider owns the model call and nothing else: it cannot reach storage,
 * the database or another project. Its output is parsed into the same
 * `{ segmentId, targetText }` shape the rules provider returns, so the service
 * validates it, re-applies pinned terms and asks for approval exactly as before.
 * A transport failure is `LOCALIZATION_PROVIDER_UNAVAILABLE`; unparseable or
 * incomplete output is `LOCALIZATION_PROVIDER_INVALID_OUTPUT`.
 */
export function createRemoteLlmLocalizationProvider(
  config: LocalizationLlmConfig,
  fallbacks: readonly LocalizationLlmConfig[] = [],
): LocalizationProvider {
  const endpoints = [toEndpoint(config), ...fallbacks.map(toEndpoint)];

  return {
    name: REMOTE_LLM_PROVIDER,

    async localize(
      request: LocalizationProviderRequest,
    ): Promise<LocalizationProviderResult> {
      let completion;
      try {
        completion = await requestChatCompletion(
          endpoints,
          [
            {
              role: "system",
              content:
                "You are a professional translator. You translate the text given to you, you preserve placeholders and pinned terminology, and you return only the requested JSON.",
            },
            { role: "user", content: buildPrompt(request) },
          ],
          { temperature: request.strategy === "TRANSCREATE" ? 0.4 : 0.1 },
        );
      } catch (error) {
        throw new LocalizationError(
          "LOCALIZATION_PROVIDER_UNAVAILABLE",
          `The remote provider request failed: ${(error as Error).message}`,
        );
      }

      return {
        provider: REMOTE_LLM_PROVIDER,
        providerModel: completion.model,
        segments: parseSegments(extractJson(completion.content)),
      };
    },
  };
}
