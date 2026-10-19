import {
  llmEndpointLabel,
  requestChatCompletion,
  type LlmEndpoint,
} from "../../../lib/llm-chat";
import { WritingError } from "../errors";
import type { WritingCandidate } from "../domain/types";
import type {
  WritingProviderRequest,
  WritingProviderResult,
  WritingTextProvider,
} from "./provider";

export type RemoteLlmConfig = {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
};

/**
 * Reads remote LLM settings from the environment. Returns null when the minimum
 * needed to talk to a model — a base URL and a model name — is not present, which
 * is what lets the registry honestly refuse a `REMOTE_LLM` request.
 */
export function remoteLlmConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): RemoteLlmConfig | null {
  const baseUrl = env["WRITING_LLM_BASE_URL"]?.trim();
  const model = env["WRITING_LLM_MODEL"]?.trim();
  if (!baseUrl || !model) return null;
  const timeoutRaw = Number.parseInt(env["WRITING_LLM_TIMEOUT_MS"] ?? "", 10);
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey: env["WRITING_LLM_API_KEY"]?.trim() ?? null,
    model,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 30_000,
  };
}

/**
 * Fallback endpoints, in order. A deployment that names fallbacks (for
 * example OpenAI primary, Groq then NVIDIA then OpenRouter behind it) gets one
 * bounded failover attempt per endpoint when a failure is one a different
 * endpoint could plausibly fix — unreachable, rate limited, expired
 * credentials — which is what keeps a single expired key from taking writing
 * offline. Slot 1 uses the original unnumbered names; later slots add `_2_`,
 * `_3_`. The transport caps the whole chain (see `MAX_ENDPOINTS`).
 */
const MAX_WRITING_LLM_FALLBACKS = 3;

function fallbackConfigAt(
  env: Record<string, string | undefined>,
  index: number,
): RemoteLlmConfig | null {
  const suffix = index === 1 ? "" : `_${index}`;
  const baseUrl = env[`WRITING_LLM_FALLBACK${suffix}_BASE_URL`]?.trim();
  const model = env[`WRITING_LLM_FALLBACK${suffix}_MODEL`]?.trim();
  if (!baseUrl || !model) return null;
  const timeoutRaw = Number.parseInt(
    env[`WRITING_LLM_FALLBACK${suffix}_TIMEOUT_MS`] ?? "",
    10,
  );
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey: env[`WRITING_LLM_FALLBACK${suffix}_API_KEY`]?.trim() ?? null,
    model,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 30_000,
  };
}

/** The first fallback endpoint, for callers that want exactly one. */
export function remoteLlmFallbackFromEnv(
  env: Record<string, string | undefined> = process.env,
): RemoteLlmConfig | null {
  return fallbackConfigAt(env, 1);
}

/** The ordered fallback list the container hands to the provider factory. */
export function remoteLlmFallbackChainFromEnv(
  env: Record<string, string | undefined> = process.env,
): RemoteLlmConfig[] {
  const chain: RemoteLlmConfig[] = [];
  for (let index = 1; index <= MAX_WRITING_LLM_FALLBACKS; index += 1) {
    const config = fallbackConfigAt(env, index);
    if (config) chain.push(config);
  }
  return chain;
}

function toEndpoint(config: RemoteLlmConfig): LlmEndpoint {
  return {
    label: llmEndpointLabel(config.baseUrl),
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
  };
}

function groundingBlock(request: WritingProviderRequest): string {
  const lines = request.context.facts
    .slice(0, 40)
    .map((fact) => `- [${fact.entityKind}] ${fact.text}`);
  return lines.length > 0
    ? lines.join("\n")
    : "(no project facts were recorded; write nothing that states a fact)";
}

function buildPrompt(request: WritingProviderRequest): string {
  const { context } = request;
  return [
    `Write ${request.variantCount} candidate(s) of ${context.blockType} copy.`,
    `Tone: ${context.tone}. Length: ${context.length}. Objective: ${context.objective}.`,
    context.audience ? `Audience: ${context.audience}.` : "",
    context.language ? `Language: ${context.language}.` : "",
    `User request: ${context.userRequest}`,
    "Use only the project facts below. Do not invent prices, guarantees, testimonials, statistics or capabilities.",
    "Project facts:",
    groundingBlock(request),
    `Return strict JSON: {"variants": ["...", "..."]}.`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * The explicit remote boundary. It is only constructed when `remoteLlmConfigFromEnv`
 * found a base URL and a model, so its mere existence means the engine is allowed
 * to spend an external call. A network or parse failure raises rather than
 * returning fabricated copy. The optional fallback endpoint is used only for
 * retryable transport failures (see the shared transport for the exact list).
 */
export function createRemoteLlmProvider(
  config: RemoteLlmConfig,
  fallbacks: readonly RemoteLlmConfig[] = [],
): WritingTextProvider {
  const endpoints = [toEndpoint(config), ...fallbacks.map(toEndpoint)];

  return {
    id: "REMOTE_LLM",

    async generate(request: WritingProviderRequest): Promise<WritingProviderResult> {
      let completion;
      try {
        completion = await requestChatCompletion(
          endpoints,
          [
            {
              role: "system",
              content:
                "You are a grounded marketing copywriter. You only state what the provided project facts support.",
            },
            { role: "user", content: buildPrompt(request) },
          ],
          { temperature: 0.7 },
        );
      } catch (error) {
        throw new WritingError(
          "WRITING_GENERATION_FAILED",
          `Remote provider request failed: ${(error as Error).message}`,
          502,
        );
      }

      const candidates = parseVariants(completion.content, request.variantCount);

      return {
        candidates,
        providerModel: completion.model,
        providerVersion: "remote-llm",
      };
    },
  };
}

/**
 * Models wrap JSON in markdown fences or a sentence of preamble more often
 * than they should, so the first JSON object or array in the response is read
 * the same way the localization parser reads its segments. A response with
 * nothing parseable is still an error, not an empty variant list.
 */
function extractVariantsJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(body);
  } catch {
    // fall through to the bracket scan
  }

  const objectStart = body.indexOf("{");
  const objectEnd = body.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    try {
      return JSON.parse(body.slice(objectStart, objectEnd + 1));
    } catch {
      // fall through to the structured error below
    }
  }

  throw new WritingError(
    "WRITING_GENERATION_FAILED",
    "Remote provider did not return JSON",
    502,
  );
}

function parseVariants(content: string, limit: number): WritingCandidate[] {
  const parsed = extractVariantsJson(content);

  const variants =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { variants?: unknown }).variants)
      ? ((parsed as { variants: unknown[] }).variants)
      : [];

  const candidates: WritingCandidate[] = [];
  for (const entry of variants) {
    if (typeof entry !== "string") continue;
    const text = entry.trim();
    if (!text) continue;
    candidates.push({ label: `V${candidates.length + 1}`, text, instruction: null });
    if (candidates.length >= limit) break;
  }

  if (candidates.length === 0) {
    throw new WritingError(
      "WRITING_GENERATION_FAILED",
      "Remote provider returned no usable variants",
      502,
    );
  }

  return candidates;
}
