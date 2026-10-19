import { llmFetch, readBoundedJson } from "./llm-http";

/**
 * The shared chat-completions transport.
 *
 * Every remote provider in this codebase speaks the same wire protocol — an
 * OpenAI-compatible `POST {baseUrl}/chat/completions` — so the transport lives
 * here once and each domain provider keeps its own prompt, schema and error
 * mapping on top.
 *
 * The transport also owns failover. A deployment can configure a second
 * endpoint (for example OpenAI primary, Groq fallback) and the transport moves
 * to it when — and only when — the failure is one a different endpoint could
 * plausibly answer differently:
 *
 *   - a transport-level failure (connection refused, TLS, abort, timeout),
 *   - an authentication/authorization rejection (an expired or revoked key),
 *   - a rate limit,
 *   - a server-side failure (5xx) or an unreadable/oversized response.
 *
 * It does NOT fail over on a request the endpoint understood and rejected
 * (400/404/422), because repeating the same malformed request against a second
 * endpoint would spend more money to receive the same answer. Domain-level
 * schema failures happen above this layer and never trigger a failover either:
 * re-asking a model after it returned unusable JSON is a product decision, not
 * a transport one.
 *
 * No response body ever appears in an error message. A provider that echoes the
 * request (and therefore the prompt, and possibly pinned terminology) into its
 * error text must not have that text forwarded into logs or user-visible
 * errors.
 */

export type LlmEndpoint = {
  /** Short, sanitized name used in errors and provenance (never a secret). */
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  timeoutMs: number;
};

export type LlmChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmChatOptions = {
  temperature?: number;
  /** Overrides every endpoint's configured model when set. */
  model?: string;
  /** Sent as `max_tokens` when set; absent means the provider's default. */
  maxTokens?: number;
  signal?: AbortSignal;
};

export type LlmChatUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type LlmChatResult = {
  content: string;
  model: string;
  endpoint: string;
  usage?: LlmChatUsage;
};

export type LlmChatAttemptFailure = {
  endpoint: string;
  status: number | null;
  retryable: boolean;
  reason: string;
};

export class LlmChatError extends Error {
  readonly attempts: readonly LlmChatAttemptFailure[];

  constructor(attempts: readonly LlmChatAttemptFailure[]) {
    const summary = attempts
      .map(
        (attempt) =>
          `${attempt.endpoint}: ${attempt.reason}${
            attempt.status === null ? "" : ` (HTTP ${attempt.status})`
          }`,
      )
      .join("; ");
    super(`Every configured LLM endpoint failed — ${summary}`);
    this.name = "LlmChatError";
    this.attempts = attempts;
  }
}

type ChatCompletionResponse = {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function endpointLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "endpoint";
  }
}

/**
 * Builds the sanitized label a config factory uses for one endpoint. Exported
 * so provenance strings from every domain line up.
 */
export function llmEndpointLabel(baseUrl: string): string {
  return endpointLabel(baseUrl);
}

/**
 * The most endpoints a single request may be retried across. Four is a
 * deliberate ceiling: a chain long enough to survive one vendor outage or an
 * expired key is useful, but an unbounded list turns one user request into an
 * unbounded fan-out of paid inference.
 */
const MAX_ENDPOINTS = 4;

function classifyStatus(status: number): {
  retryable: boolean;
  reason: string;
} {
  if (status === 401 || status === 403) {
    return { retryable: true, reason: "authentication rejected" };
  }
  if (status === 408) {
    return { retryable: true, reason: "request timeout" };
  }
  if (status === 429) {
    return { retryable: true, reason: "rate limited" };
  }
  if (status >= 500) {
    return { retryable: true, reason: "endpoint error" };
  }
  return { retryable: false, reason: "request rejected" };
}

async function attempt(
  endpoint: LlmEndpoint,
  messages: readonly LlmChatMessage[],
  options: LlmChatOptions,
  callerSignal: AbortSignal | undefined,
): Promise<LlmChatResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), endpoint.timeoutMs);
  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  let response: Response;
  try {
    response = await llmFetch(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(endpoint.apiKey
          ? { authorization: `Bearer ${endpoint.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: options.model ?? endpoint.model,
        temperature: options.temperature ?? 0.2,
        ...(options.maxTokens === undefined
          ? {}
          : { max_tokens: options.maxTokens }),
        messages,
      }),
      signal: controller.signal,
    });
  } catch {
    if (callerSignal?.aborted) {
      throw new LlmChatError([
        {
          endpoint: endpoint.label,
          status: null,
          retryable: false,
          reason: "cancelled",
        },
      ]);
    }
    const timedOut = controller.signal.aborted;
    throw new LlmChatError([
      {
        endpoint: endpoint.label,
        status: null,
        retryable: true,
        reason: timedOut ? "timed out" : "unreachable",
      },
    ]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }

  if (!response.ok) {
    const { retryable, reason } = classifyStatus(response.status);
    await response.body?.cancel().catch(() => undefined);
    throw new LlmChatError([
      {
        endpoint: endpoint.label,
        status: response.status,
        retryable,
        reason,
      },
    ]);
  }

  const payload = (await readBoundedJson(response)) as ChatCompletionResponse | null;
  if (!payload) {
    throw new LlmChatError([
      {
        endpoint: endpoint.label,
        status: response.status,
        retryable: true,
        reason: "unreadable response",
      },
    ]);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new LlmChatError([
      {
        endpoint: endpoint.label,
        status: response.status,
        retryable: true,
        reason: "empty completion",
      },
    ]);
  }

  const usage: LlmChatUsage | undefined =
    payload.usage &&
    (payload.usage.prompt_tokens !== undefined ||
      payload.usage.completion_tokens !== undefined)
      ? {
          inputTokens: payload.usage.prompt_tokens,
          outputTokens: payload.usage.completion_tokens,
        }
      : undefined;

  return {
    content,
    model: payload.model ?? endpoint.model,
    endpoint: endpoint.label,
    ...(usage ? { usage } : {}),
  };
}

/**
 * Sends one chat request, moving down the endpoint chain only for failures a
 * different endpoint could plausibly fix. Throws `LlmChatError` carrying the
 * per-endpoint attempt summary (sanitized) when every endpoint fails.
 */
export async function requestChatCompletion(
  endpoints: readonly LlmEndpoint[],
  messages: readonly LlmChatMessage[],
  options: LlmChatOptions = {},
): Promise<LlmChatResult> {
  const chain = endpoints.slice(0, MAX_ENDPOINTS);
  if (chain.length === 0) {
    throw new LlmChatError([
      { endpoint: "none", status: null, retryable: false, reason: "no endpoint configured" },
    ]);
  }

  const failures: LlmChatAttemptFailure[] = [];

  for (const endpoint of chain) {
    try {
      return await attempt(endpoint, messages, options, options.signal);
    } catch (error) {
      if (!(error instanceof LlmChatError)) throw error;
      const failure = error.attempts[0];
      if (!failure) throw error;
      failures.push(failure);
      if (!failure.retryable) break;
    }
  }

  throw new LlmChatError(failures);
}
