import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRemoteAiProvider,
  remoteAiConfigFromEnv,
  remoteAiFallbackChainFromEnv,
} from "./remote-ai-provider";

function completion(content: string, model = "served-model"): Response {
  return new Response(
    JSON.stringify({
      model,
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 5, completion_tokens: 9 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remoteAiConfigFromEnv", () => {
  it("returns null when neither the AI nor the writing endpoint is configured", () => {
    expect(remoteAiConfigFromEnv({})).toBeNull();
  });

  it("prefers CONTENT_OS_AI_* over WRITING_LLM_*", () => {
    const config = remoteAiConfigFromEnv({
      CONTENT_OS_AI_BASE_URL: "https://ai.example.com/v1",
      CONTENT_OS_AI_MODEL: "ai-model",
      CONTENT_OS_AI_API_KEY: "sk-ai",
      WRITING_LLM_BASE_URL: "https://writing.example.com/v1",
      WRITING_LLM_MODEL: "writing-model",
    });
    expect(config).toEqual({
      baseUrl: "https://ai.example.com/v1",
      apiKey: "sk-ai",
      model: "ai-model",
      timeoutMs: 30_000,
    });
  });

  it("inherits the writing endpoint when the AI endpoint is absent", () => {
    const config = remoteAiConfigFromEnv({
      WRITING_LLM_BASE_URL: "https://writing.example.com/v1/",
      WRITING_LLM_MODEL: "writing-model",
      WRITING_LLM_TIMEOUT_MS: "1200",
    });
    expect(config).toEqual({
      baseUrl: "https://writing.example.com/v1",
      apiKey: null,
      model: "writing-model",
      timeoutMs: 1200,
    });
  });
});

describe("remoteAiFallbackChainFromEnv", () => {
  it("inherits the writing fallback chain when AI slots are absent", () => {
    const chain = remoteAiFallbackChainFromEnv({
      WRITING_LLM_FALLBACK_BASE_URL: "https://groq.example.com/v1",
      WRITING_LLM_FALLBACK_MODEL: "model-1",
      WRITING_LLM_FALLBACK_2_BASE_URL: "https://nvidia.example.com/v1",
      WRITING_LLM_FALLBACK_2_MODEL: "model-2",
    });
    expect(chain.map((entry) => entry.model)).toEqual(["model-1", "model-2"]);
  });

  it("prefers AI-specific fallback slots", () => {
    const chain = remoteAiFallbackChainFromEnv({
      CONTENT_OS_AI_FALLBACK_BASE_URL: "https://ai-fallback.example.com/v1",
      CONTENT_OS_AI_FALLBACK_MODEL: "ai-fallback-model",
      WRITING_LLM_FALLBACK_BASE_URL: "https://writing-fallback.example.com/v1",
      WRITING_LLM_FALLBACK_MODEL: "writing-fallback-model",
    });
    expect(chain.map((entry) => entry.baseUrl)).toEqual([
      "https://ai-fallback.example.com/v1",
    ]);
  });
});

describe("createRemoteAiProvider", () => {
  const config = {
    baseUrl: "https://primary.example.com/v1",
    apiKey: "sk-primary",
    model: "primary-model",
    timeoutMs: 5_000,
  };

  it("passes the port request through and maps the response", async () => {
    const fetchMock = vi.fn(async () => completion('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createRemoteAiProvider(config);
    const response = await provider.generate({
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "user prompt" },
      ],
      temperature: 0.1,
    });

    expect(response.text).toBe('{"ok":true}');
    expect(response.model).toBe("served-model");
    expect(response.usage).toEqual({ inputTokens: 5, outputTokens: 9 });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      model: string;
      temperature: number;
      messages: unknown[];
    };
    expect(body.model).toBe("primary-model");
    expect(body.temperature).toBe(0.1);
    expect(body.messages).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "user prompt" },
    ]);
  });

  it("honors a per-request model override", async () => {
    const fetchMock = vi.fn(async () => completion("{}"));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createRemoteAiProvider(config);
    await provider.generate({
      messages: [{ role: "user", content: "hi" }],
      model: "request-model",
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((JSON.parse(String(init.body)) as { model: string }).model).toBe(
      "request-model",
    );
  });

  it("fails over to the fallback endpoint and throws a sanitized error when all fail", async () => {
    const fallback = {
      baseUrl: "https://secondary.example.com/v1",
      apiKey: null,
      model: "secondary-model",
      timeoutMs: 5_000,
    };
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return url.includes("primary")
          ? new Response(null, { status: 503 })
          : completion("fallback text", "secondary-served");
      }),
    );

    const provider = createRemoteAiProvider(config, [fallback]);
    const response = await provider.generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(urls).toHaveLength(2);
    expect(response.text).toBe("fallback text");
    expect(response.model).toBe("secondary-served");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "SECRET_ECHO" } }), {
          status: 401,
        }),
      ),
    );
    await expect(
      provider.generate({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({
      name: "LlmChatError",
      message: expect.not.stringContaining("SECRET_ECHO") as unknown as string,
    });
  });
});
