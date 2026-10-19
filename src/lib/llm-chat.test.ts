import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LlmChatError,
  llmEndpointLabel,
  requestChatCompletion,
  type LlmEndpoint,
} from "./llm-chat";

function endpoint(overrides: Partial<LlmEndpoint> = {}): LlmEndpoint {
  return {
    label: "primary.example.com",
    baseUrl: "https://primary.example.com/v1",
    model: "model-primary",
    apiKey: "sk-primary",
    timeoutMs: 5_000,
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function completion(content: string, model = "served-model") {
  return {
    model,
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 11, completion_tokens: 7 },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("llmEndpointLabel", () => {
  it("uses the host, never the full URL or credentials", () => {
    expect(llmEndpointLabel("https://api.openai.com/v1")).toBe("api.openai.com");
    expect(llmEndpointLabel("not a url")).toBe("endpoint");
  });
});

describe("requestChatCompletion", () => {
  it("sends one OpenAI-compatible chat request and returns the completion", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(completion("hello")));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestChatCompletion([endpoint()], [{ role: "user", content: "hi" }], {
      maxTokens: 128,
    });

    expect(result.content).toBe("hello");
    expect(result.model).toBe("served-model");
    expect(result.endpoint).toBe("primary.example.com");
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://primary.example.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer sk-primary");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body["model"]).toBe("model-primary");
    expect(body["temperature"]).toBe(0.2);
    expect(body["max_tokens"]).toBe(128);
    expect(body["messages"]).toEqual([{ role: "user", content: "hi" }]);
  });

  it("omits the authorization header when no key is configured and honors the model override", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(completion("ok")));
    vi.stubGlobal("fetch", fetchMock);

    await requestChatCompletion(
      [endpoint({ apiKey: null })],
      [{ role: "user", content: "hi" }],
      { model: "override-model", temperature: 0 },
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBeUndefined();
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body["model"]).toBe("override-model");
    expect(body["temperature"]).toBe(0);
    expect(body["max_tokens"]).toBeUndefined();
  });

  it("fails over to the next endpoint after a rate limit", async () => {
    const secondary = endpoint({
      label: "secondary.example.com",
      baseUrl: "https://secondary.example.com/v1",
      model: "model-secondary",
      apiKey: "sk-secondary",
    });
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      return url.includes("primary")
        ? new Response(null, { status: 429 })
        : jsonResponse(completion("from secondary", "model-secondary"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestChatCompletion(
      [endpoint(), secondary],
      [{ role: "user", content: "hi" }],
    );

    expect(urls).toHaveLength(2);
    expect(result.content).toBe("from secondary");
    expect(result.model).toBe("model-secondary");
    expect(result.endpoint).toBe("secondary.example.com");
  });

  it.each([
    [401, "authentication rejected"],
    [403, "authentication rejected"],
    [429, "rate limited"],
    [500, "endpoint error"],
    [503, "endpoint error"],
  ])("fails over on HTTP %i (%s)", async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(jsonResponse(completion("fallback")));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestChatCompletion(
      [
        endpoint(),
        endpoint({ label: "b", baseUrl: "https://b.example.com/v1" }),
      ],
      [{ role: "user", content: "hi" }],
    );
    expect(result.content).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fail over on a request the endpoint understood and rejected", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const attempt = requestChatCompletion(
      [
        endpoint(),
        endpoint({ label: "b", baseUrl: "https://b.example.com/v1" }),
      ],
      [{ role: "user", content: "hi" }],
    );

    await expect(attempt).rejects.toBeInstanceOf(LlmChatError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await attempt.catch((error: LlmChatError) => {
      expect(error.attempts[0]?.retryable).toBe(false);
      expect(error.attempts[0]?.reason).toBe("request rejected");
    });
  });

  it("fails over on a network failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(jsonResponse(completion("fallback")));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestChatCompletion(
      [
        endpoint(),
        endpoint({ label: "b", baseUrl: "https://b.example.com/v1" }),
      ],
      [{ role: "user", content: "hi" }],
    );
    expect(result.content).toBe("fallback");
  });

  it("fails over on an unreadable body and on an empty completion", async () => {
    const unreadable = vi
      .fn()
      .mockResolvedValueOnce(new Response("<html>oops</html>"))
      .mockResolvedValueOnce(jsonResponse(completion("recovered")));
    vi.stubGlobal("fetch", unreadable);
    await expect(
      requestChatCompletion(
        [endpoint(), endpoint({ label: "b", baseUrl: "https://b.example.com/v1" })],
        [{ role: "user", content: "hi" }],
      ),
    ).resolves.toMatchObject({ content: "recovered" });

    const empty = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "  " } }] }))
      .mockResolvedValueOnce(jsonResponse(completion("recovered")));
    vi.stubGlobal("fetch", empty);
    await expect(
      requestChatCompletion(
        [endpoint(), endpoint({ label: "b", baseUrl: "https://b.example.com/v1" })],
        [{ role: "user", content: "hi" }],
      ),
    ).resolves.toMatchObject({ content: "recovered" });
  });

  it("reports every failure without leaking response bodies", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: "SECRET_PROMPT_ECHO" } }, 400),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await requestChatCompletion([endpoint()], [{ role: "user", content: "hi" }]);
      expect.unreachable("expected a LlmChatError");
    } catch (error) {
      const failure = error as LlmChatError;
      expect(failure.message).toContain("primary.example.com");
      expect(failure.message).toContain("HTTP 400");
      expect(failure.message).not.toContain("SECRET_PROMPT_ECHO");
    }
  });

  it("times out one endpoint and fails over to the next", async () => {
    const hanging = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    let call = 0;
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      call += 1;
      return call === 1 ? hanging(url, init) : Promise.resolve(jsonResponse(completion("after timeout")));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestChatCompletion(
      [
        endpoint({ timeoutMs: 20 }),
        endpoint({ label: "b", baseUrl: "https://b.example.com/v1" }),
      ],
      [{ role: "user", content: "hi" }],
    );

    await expect(result.content).toBe("after timeout");
    await result;
  });

  it("stops immediately when the caller aborts", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
          setTimeout(() => controller.abort(), 5);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await requestChatCompletion(
        [
          endpoint({ timeoutMs: 5_000 }),
          endpoint({ label: "b", baseUrl: "https://b.example.com/v1" }),
        ],
        [{ role: "user", content: "hi" }],
        { signal: controller.signal },
      );
      expect.unreachable("expected a LlmChatError");
    } catch (error) {
      const failure = error as LlmChatError;
      expect(failure.attempts[0]?.reason).toBe("cancelled");
      expect(failure.attempts[0]?.retryable).toBe(false);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tries at most four endpoints", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestChatCompletion(
        [1, 2, 3, 4, 5].map((n) =>
          endpoint({ label: `e${n}`, baseUrl: `https://e${n}.example.com/v1` }),
        ),
        [{ role: "user", content: "hi" }],
      ),
    ).rejects.toBeInstanceOf(LlmChatError);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("refuses an empty chain", async () => {
    await expect(
      requestChatCompletion([], [{ role: "user", content: "hi" }]),
    ).rejects.toMatchObject({ name: "LlmChatError" });
  });
});
