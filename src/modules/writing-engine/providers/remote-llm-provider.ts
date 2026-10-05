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
  env: NodeJS.ProcessEnv = process.env,
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

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
};

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
 * returning fabricated copy.
 */
export function createRemoteLlmProvider(
  config: RemoteLlmConfig,
): WritingTextProvider {
  return {
    id: "REMOTE_LLM",

    async generate(request: WritingProviderRequest): Promise<WritingProviderResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);

      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0.7,
            messages: [
              {
                role: "system",
                content:
                  "You are a grounded marketing copywriter. You only state what the provided project facts support.",
              },
              { role: "user", content: buildPrompt(request) },
            ],
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new WritingError(
          "WRITING_GENERATION_FAILED",
          `Remote provider request failed: ${(error as Error).message}`,
          502,
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new WritingError(
          "WRITING_GENERATION_FAILED",
          `Remote provider returned ${response.status}`,
          502,
        );
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const content = payload.choices?.[0]?.message?.content ?? "";
      const candidates = parseVariants(content, request.variantCount);

      return {
        candidates,
        providerModel: payload.model ?? config.model,
        providerVersion: "remote-llm",
      };
    },
  };
}

function parseVariants(content: string, limit: number): WritingCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new WritingError(
      "WRITING_GENERATION_FAILED",
      "Remote provider did not return JSON",
      502,
    );
  }

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
