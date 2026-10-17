import { describe, expect, it, vi } from "vitest";
import { MastodonPublishingProvider } from "../providers/mastodon";
import { ProviderError } from "../providers/ports";

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function provider(fetchImpl: typeof fetch) {
  return new MastodonPublishingProvider({
    baseUrl: "https://social.example",
    clientId: "client-1",
    clientSecret: "secret-1",
    fetchImpl,
  });
}

async function failureOf(run: () => Promise<unknown>): Promise<ProviderError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }
  throw new Error("expected the call to fail");
}

describe("MastodonPublishingProvider", () => {
  it("builds an authorize URL with the fixed scopes and no token", () => {
    const instance = provider(async () => jsonResponse({}));
    const url = new URL(
      instance.authorizeUrl({
        redirectUri: "https://app.example/callback",
        state: "state-token",
      }),
    );
    expect(url.origin).toBe("https://social.example");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("read write");
    expect(url.searchParams.get("state")).toBe("state-token");
  });

  it("exchanges a code for a token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: "token-1", scope: "read write" }),
    ) as unknown as typeof fetch;
    const instance = provider(fetchImpl);
    const token = await instance.exchangeCode({
      code: "code-1",
      redirectUri: "https://app.example/callback",
    });
    expect(token.accessToken).toBe("token-1");
    expect(token.scopes).toEqual(["read", "write"]);
    expect(token.expiresAt).toBeNull();

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("https://social.example/oauth/token");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).toContain("client_secret=secret-1");
  });

  it("classifies a refused code as AUTH", async () => {
    const instance = provider(async () =>
      jsonResponse({ error: "invalid_grant" }, 401),
    );
    const failure = await failureOf(() =>
      instance.exchangeCode({ code: "bad", redirectUri: "https://app.example/cb" }),
    );
    expect(failure.failure.kind).toBe("AUTH");
    expect(failure.failure.retryable).toBe(false);
    expect(failure.failure.message).toBe("invalid_grant");
  });

  it("verifies a credential into an account", async () => {
    const instance = provider(async () =>
      jsonResponse({ id: "42", display_name: "Launch Bot", username: "launch" }),
    );
    const account = await instance.verifyCredential("token");
    expect(account.externalAccountId).toBe("42");
    expect(account.displayName).toBe("Launch Bot");
  });

  it("rejects empty and oversized content before any request", () => {
    const instance = provider(async () => jsonResponse({}));
    const empty = instance.validateContent("   ");
    expect(empty[0]?.code).toBe("CONTENT_EMPTY");
    expect(empty[0]?.severity).toBe("ERROR");
    const long = instance.validateContent("x".repeat(501));
    expect(long[0]?.code).toBe("CONTENT_TOO_LONG");
    expect(instance.validateContent("hello")).toEqual([]);
  });

  it("publishes with an Idempotency-Key and returns the provider's own record", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          id: "post-9",
          url: "https://social.example/@bot/post-9",
          created_at: "2026-10-17T12:00:00.000Z",
        },
        200,
        { "x-request-id": "req-7" },
      ),
    ) as unknown as typeof fetch;
    const instance = provider(fetchImpl);
    const result = await instance.publish({
      credential: "token-1",
      content: "Shipping today",
      idempotencyKey: "pubidem-1",
    });
    expect(result.externalPostId).toBe("post-9");
    expect(result.externalUrl).toBe("https://social.example/@bot/post-9");
    expect(result.publishedAt).toBe("2026-10-17T12:00:00.000Z");
    expect(result.providerRequestId).toBe("req-7");

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("https://social.example/api/v1/statuses");
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("pubidem-1");
    expect(headers["authorization"]).toBe("Bearer token-1");
    expect(String(init.body)).toContain("status=Shipping+today");
  });

  it("refuses an idempotency key that is not a valid header value", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    const instance = provider(fetchImpl);
    const failure = await failureOf(() =>
      instance.publish({
        credential: "token",
        content: "hello",
        idempotencyKey: "bad key with spaces",
      }),
    );
    expect(failure.failure.kind).toBe("PERMANENT");
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("classifies publish HTTP failures honestly", async () => {
    const permanent = provider(async () => jsonResponse({ error: "too long" }, 422));
    const permanentFailure = await failureOf(() =>
      permanent.publish({ credential: "t", content: "x", idempotencyKey: "k1" }),
    );
    expect(permanentFailure.failure.kind).toBe("PERMANENT");
    expect(permanentFailure.failure.retryable).toBe(false);

    const limited = provider(async () => jsonResponse({ error: "slow down" }, 429));
    const limitedFailure = await failureOf(() =>
      limited.publish({ credential: "t", content: "x", idempotencyKey: "k2" }),
    );
    expect(limitedFailure.failure.kind).toBe("RATE_LIMITED");
    expect(limitedFailure.failure.retryable).toBe(true);

    const serverError = provider(async () => jsonResponse({ error: "boom" }, 503));
    const serverFailure = await failureOf(() =>
      serverError.publish({ credential: "t", content: "x", idempotencyKey: "k3" }),
    );
    expect(serverFailure.failure.kind).toBe("TRANSIENT");
    expect(serverFailure.failure.retryable).toBe(true);
  });

  it("treats a transport failure after sending as AMBIGUOUS, not as a clean failure", async () => {
    const instance = provider(async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    });
    const failure = await failureOf(() =>
      instance.publish({ credential: "t", content: "x", idempotencyKey: "k4" }),
    );
    expect(failure.failure.kind).toBe("AMBIGUOUS");
    expect(failure.failure.retryable).toBe(true);
    expect(failure.failure.message).toContain("idempotency key");
  });

  it("treats an accepted response with no usable id as AMBIGUOUS", async () => {
    const instance = provider(async () => jsonResponse({ url: "https://x" }, 200));
    const failure = await failureOf(() =>
      instance.publish({ credential: "t", content: "x", idempotencyKey: "k5" }),
    );
    expect(failure.failure.kind).toBe("AMBIGUOUS");
  });

  it("reads real metric counts and records their provenance", async () => {
    const instance = provider(async () =>
      jsonResponse({
        id: "post-9",
        created_at: "2026-10-17T12:00:00.000Z",
        favourites_count: 4,
        reblogs_count: 2,
        replies_count: 1,
      }),
    );
    const readings = await instance.fetchMetrics("token", "post-9");
    expect(readings).toHaveLength(3);
    expect(readings.map((reading) => reading.metricKey)).toEqual([
      "favourites",
      "reblogs",
      "replies",
    ]);
    for (const reading of readings) {
      expect(reading.provenance).toBe("PROVIDER_API");
      expect(reading.completeness).toBe("COMPLETE");
      expect(reading.windowStart).toBe("2026-10-17T12:00:00.000Z");
    }
  });

  it("skips a metric the provider did not report instead of inventing a zero", async () => {
    const instance = provider(async () =>
      jsonResponse({ id: "post-9", favourites_count: 4 }),
    );
    const readings = await instance.fetchMetrics("token", "post-9");
    expect(readings.map((reading) => reading.metricKey)).toEqual(["favourites"]);
  });

  it("rejects invalid metric values instead of storing them", async () => {
    const negative = provider(async () =>
      jsonResponse({ id: "post-9", favourites_count: -1 }),
    );
    const failure = await failureOf(() => negative.fetchMetrics("token", "post-9"));
    expect(failure.failure.kind).toBe("PERMANENT");

    const fractional = provider(async () =>
      jsonResponse({ id: "post-9", reblogs_count: 1.5 }),
    );
    const fractionalFailure = await failureOf(() =>
      fractional.fetchMetrics("token", "post-9"),
    );
    expect(fractionalFailure.failure.kind).toBe("PERMANENT");
  });

  it("classifies metrics credential and transport failures", async () => {
    const unauthorized = provider(async () => jsonResponse({ error: "nope" }, 401));
    const authFailure = await failureOf(() =>
      unauthorized.fetchMetrics("token", "post-9"),
    );
    expect(authFailure.failure.kind).toBe("AUTH");

    const broken = provider(async () => {
      throw new Error("socket closed");
    });
    const transportFailure = await failureOf(() => broken.fetchMetrics("token", "post-9"));
    expect(transportFailure.failure.kind).toBe("TRANSIENT");
    expect(transportFailure.failure.retryable).toBe(true);
  });
});
