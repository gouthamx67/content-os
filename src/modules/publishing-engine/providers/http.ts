/**
 * The small HTTP surface every provider call goes through.
 *
 * Responses are parsed defensively (a provider may answer HTML on a proxy
 * failure), transport failures are distinguished from HTTP failures so the
 * publish path can classify ambiguity, and provider error text is sanitized
 * before it is stored or shown.
 */

export type HttpResult = {
  status: number;
  headers: Headers;
  body: unknown;
};

export class TransportError extends Error {
  readonly timedOut: boolean;

  constructor(message: string, timedOut: boolean) {
    super(message);
    this.name = "TransportError";
    this.timedOut = timedOut;
  }
}

export type RequestOptions = {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  form?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export async function requestJson(options: RequestOptions): Promise<HttpResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.form
        ? new URLSearchParams(options.form).toString()
        : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new TransportError(
      timedOut
        ? "Provider request timed out"
        : "Provider request failed before a response arrived",
      timedOut,
    );
  }

  let body: unknown = null;
  try {
    const text = await response.text();
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  return { status: response.status, headers: response.headers, body };
}

export function providerErrorMessage(
  body: unknown,
  fallback: string,
): string {
  if (body && typeof body === "object") {
    const candidate = (body as Record<string, unknown>)["error"];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return sanitizeProviderMessage(candidate);
    }
    const description = (body as Record<string, unknown>)["error_description"];
    if (typeof description === "string" && description.trim().length > 0) {
      return sanitizeProviderMessage(description);
    }
  }
  return fallback;
}

/**
 * Provider text is untrusted input: collapse control characters, cap the
 * length and strip anything that looks like a token or header dump before it
 * can reach a log line, an API response or a database column.
 */
export function sanitizeProviderMessage(raw: string): string {
  const collapsed = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const redacted = collapsed
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "bearer [redacted]")
    .replace(
      /(access_token|client_secret|token)[=:]\s*[A-Za-z0-9._~+/=-]+/gi,
      "$1=[redacted]",
    );
  return redacted.length > 300 ? `${redacted.slice(0, 297)}...` : redacted;
}

export function requestIdFrom(headers: Headers): string | null {
  const value =
    headers.get("x-request-id") ?? headers.get("x-ratelimit-transient-account");
  return value && value.trim().length > 0 ? sanitizeProviderMessage(value) : null;
}
