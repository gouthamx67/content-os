/**
 * The shared boundary for calls to an OpenAI-compatible endpoint.
 *
 * Two hardening rules apply to every outbound LLM request:
 *
 * 1. Redirects are refused. The Authorization header must never be replayed to
 *    a host the operator did not configure, so a 3xx is an error, not a hop.
 * 2. The response is read with a byte ceiling. A provider that streams a
 *    gigabyte into `response.json()` would otherwise decide our memory use.
 */

export const LLM_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

export function llmFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(url, { ...init, redirect: "error" });
}

/**
 * Reads and parses a JSON body, giving up past `maxBytes`. Returns null for a
 * declared or observed oversized body and for unparseable JSON; callers decide
 * whether that is an unavailable provider or an invalid-output error.
 */
export async function readBoundedJson(
  response: Response,
  maxBytes: number = LLM_RESPONSE_MAX_BYTES,
): Promise<unknown | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    size,
  ).toString("utf8");

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}
