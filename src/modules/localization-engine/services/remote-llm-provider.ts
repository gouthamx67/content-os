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

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
};

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
): LocalizationProvider {
  return {
    name: REMOTE_LLM_PROVIDER,

    async localize(
      request: LocalizationProviderRequest,
    ): Promise<LocalizationProviderResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);

      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(config.apiKey
              ? { authorization: `Bearer ${config.apiKey}` }
              : {}),
          },
          body: JSON.stringify({
            model: config.model,
            temperature: request.strategy === "TRANSCREATE" ? 0.4 : 0.1,
            messages: [
              {
                role: "system",
                content:
                  "You are a professional translator. You translate the text given to you, you preserve placeholders and pinned terminology, and you return only the requested JSON.",
              },
              { role: "user", content: buildPrompt(request) },
            ],
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new LocalizationError(
          "LOCALIZATION_PROVIDER_UNAVAILABLE",
          `The remote provider request failed: ${(error as Error).message}`,
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new LocalizationError(
          "LOCALIZATION_PROVIDER_UNAVAILABLE",
          `The remote provider returned ${response.status}`,
        );
      }

      const payload = (await response
        .json()
        .catch(() => null)) as ChatCompletionResponse | null;
      const content = payload?.choices?.[0]?.message?.content ?? "";

      return {
        provider: REMOTE_LLM_PROVIDER,
        providerModel: payload?.model ?? config.model,
        segments: parseSegments(extractJson(content)),
      };
    },
  };
}
