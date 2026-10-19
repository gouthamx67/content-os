import { afterEach, describe, expect, it, vi } from "vitest";
import { WritingError } from "../errors";
import { makeContext } from "../__tests__/fixtures";
import {
  createRemoteLlmProvider,
  remoteLlmConfigFromEnv,
  remoteLlmFallbackChainFromEnv,
  remoteLlmFallbackFromEnv,
} from "./remote-llm-provider";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function completion(content: string, model = "served-model") {
  return { model, choices: [{ message: { content } }] };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remoteLlmConfigFromEnv", () => {
  it("returns null without a base URL and a model", () => {
    expect(remoteLlmConfigFromEnv({})).toBeNull();
    expect(
      remoteLlmConfigFromEnv({ WRITING_LLM_BASE_URL: "https://x.example.com" }),
    ).toBeNull();
    expect(
      remoteLlmConfigFromEnv({ WRITING_LLM_MODEL: "m" }),
    ).toBeNull();
  });

  it("reads the endpoint, strips a trailing slash and defaults the timeout", () => {
    const config = remoteLlmConfigFromEnv({
      WRITING_LLM_BASE_URL: "https://api.openai.com/v1/",
      WRITING_LLM_MODEL: "gpt-4o-mini",
      WRITING_LLM_API_KEY: "sk-test",
    });
    expect(config).toEqual({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      timeoutMs: 30_000,
    });
  });

  it("parses an explicit timeout and ignores an invalid one", () => {
    expect(
      remoteLlmConfigFromEnv({
        WRITING_LLM_BASE_URL: "https://x.example.com",
        WRITING_LLM_MODEL: "m",
        WRITING_LLM_TIMEOUT_MS: "1500",
      })?.timeoutMs,
    ).toBe(1500);
    expect(
      remoteLlmConfigFromEnv({
        WRITING_LLM_BASE_URL: "https://x.example.com",
        WRITING_LLM_MODEL: "m",
        WRITING_LLM_TIMEOUT_MS: "soon",
      })?.timeoutMs,
    ).toBe(30_000);
  });
});

describe("remoteLlmFallbackChainFromEnv", () => {
  it("returns an empty chain when no fallback slot is complete", () => {
    expect(remoteLlmFallbackChainFromEnv({})).toEqual([]);
    expect(
      remoteLlmFallbackChainFromEnv({ WRITING_LLM_FALLBACK_BASE_URL: "https://x" }),
    ).toEqual([]);
  });

  it("reads numbered slots in order and skips incomplete ones", () => {
    const chain = remoteLlmFallbackChainFromEnv({
      WRITING_LLM_FALLBACK_BASE_URL: "https://first.example.com/v1",
      WRITING_LLM_FALLBACK_MODEL: "model-1",
      WRITING_LLM_FALLBACK_2_BASE_URL: "https://second.example.com/v1",
      WRITING_LLM_FALLBACK_2_MODEL: "model-2",
      WRITING_LLM_FALLBACK_3_BASE_URL: "https://third.example.com/v1",
      WRITING_LLM_FALLBACK_3_MODEL: "model-3",
    });
    expect(chain.map((entry) => entry.model)).toEqual([
      "model-1",
      "model-2",
      "model-3",
    ]);
    expect(chain[0]?.baseUrl).toBe("https://first.example.com/v1");
  });

  it("still exposes the single first fallback through the compat helper", () => {
    expect(
      remoteLlmFallbackFromEnv({
        WRITING_LLM_FALLBACK_BASE_URL: "https://first.example.com/v1",
        WRITING_LLM_FALLBACK_MODEL: "model-1",
      })?.model,
    ).toBe("model-1");
  });
});

describe("createRemoteLlmProvider", () => {
  const config = {
    baseUrl: "https://primary.example.com/v1",
    apiKey: "sk-primary",
    model: "primary-model",
    timeoutMs: 5_000,
  };
  const fallback = {
    baseUrl: "https://secondary.example.com/v1",
    apiKey: "sk-secondary",
    model: "secondary-model",
    timeoutMs: 5_000,
  };

  it("sends a grounded prompt and parses strict JSON variants", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(completion(JSON.stringify({ variants: ["First copy.", "Second copy."] }))),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createRemoteLlmProvider(config);
    const result = await provider.generate({
      context: makeContext(),
      variantCount: 2,
    });

    expect(provider.id).toBe("REMOTE_LLM");
    expect(result.providerModel).toBe("served-model");
    expect(result.providerVersion).toBe("remote-llm");
    expect(result.candidates).toEqual([
      { label: "V1", text: "First copy.", instruction: null },
      { label: "V2", text: "Second copy.", instruction: null },
    ]);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: string }>;
      temperature: number;
    };
    expect(body.temperature).toBe(0.7);
    expect(body.messages[0]?.role).toBe("system");
    const userPrompt = body.messages[1]?.content ?? "";
    expect(userPrompt).toContain("Scheduled exports");
    expect(userPrompt).toContain('Return strict JSON: {"variants": ["...", "..."]}');
  });

  it("caps candidates at the requested count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(completion(JSON.stringify({ variants: ["a", "b", "c"] }))),
      ),
    );
    const provider = createRemoteLlmProvider(config);
    const result = await provider.generate({ context: makeContext(), variantCount: 2 });
    expect(result.candidates.map((candidate) => candidate.text)).toEqual(["a", "b"]);
  });

  it("reads JSON wrapped in fences or surrounding prose", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          completion('Sure! ```json\n{"variants": ["Fenced copy."]}\n```'),
        ),
      ),
    );
    const provider = createRemoteLlmProvider(config);
    const result = await provider.generate({ context: makeContext(), variantCount: 1 });
    expect(result.candidates[0]?.text).toBe("Fenced copy.");
  });

  it("fails over to the configured fallback on a retryable failure", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return url.includes("primary")
          ? new Response(null, { status: 429 })
          : jsonResponse(completion(JSON.stringify({ variants: ["Fallback copy."] }), "fallback-model"));
      }),
    );

    const provider = createRemoteLlmProvider(config, [fallback]);
    const result = await provider.generate({ context: makeContext(), variantCount: 1 });

    expect(urls.map((url) => new URL(url).host)).toEqual([
      "primary.example.com",
      "secondary.example.com",
    ]);
    expect(result.providerModel).toBe("fallback-model");
    expect(result.candidates[0]?.text).toBe("Fallback copy.");
  });

  it("does not fail over when the model answered but the schema is unusable", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(completion("I cannot help with that.")),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createRemoteLlmProvider(config, [fallback]);
    await expect(
      provider.generate({ context: makeContext(), variantCount: 1 }),
    ).rejects.toMatchObject({
      code: "WRITING_GENERATION_FAILED",
      status: 502,
      message: "Remote provider did not return JSON",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a JSON object with no usable variants", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(completion(JSON.stringify({ variants: [1, "", "  "] })))),
    );
    const provider = createRemoteLlmProvider(config);
    await expect(
      provider.generate({ context: makeContext(), variantCount: 1 }),
    ).rejects.toMatchObject({
      code: "WRITING_GENERATION_FAILED",
      message: "Remote provider returned no usable variants",
    });
  });

  it("reports every failed endpoint in the error without leaking bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: { message: "SECRET_PROMPT_ECHO" } }, 401),
      ),
    );
    const provider = createRemoteLlmProvider(config, [fallback]);
    try {
      await provider.generate({ context: makeContext(), variantCount: 1 });
      expect.unreachable("expected a WritingError");
    } catch (error) {
      expect(error).toBeInstanceOf(WritingError);
      const failure = error as WritingError;
      expect(failure.status).toBe(502);
      expect(failure.message).toContain("primary.example.com");
      expect(failure.message).toContain("secondary.example.com");
      expect(failure.message).not.toContain("SECRET_PROMPT_ECHO");
    }
  });
});
