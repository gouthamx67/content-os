import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRemoteLlmLocalizationProvider,
  localizationLlmFallbackChainFromEnv,
  localizationLlmFallbackFromEnv,
} from "../services/remote-llm-provider";
import type { LocalizationProviderRequest } from "../integrations/ports";
import type { LocalizationSegment } from "../domain/types";
import { isLocalizationError } from "../errors";

function segment(id: string, sourceText: string): LocalizationSegment {
  return {
    id,
    kind: "BODY",
    path: `body:${id}`,
    sourceText,
    targetText: null,
    placeholders: [],
    glossary: {},
    metadata: {},
  };
}

function request(): LocalizationProviderRequest {
  return {
    strategy: "TRANSLATE",
    sourceLocale: "en",
    targetLocale: "es",
    segments: [segment("seg_1", "Hello world")],
    glossary: [],
  };
}

function completion(content: string, model = "served-model"): Response {
  return new Response(
    JSON.stringify({ model, choices: [{ message: { content } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("localization fallback chain from env", () => {
  it("reads numbered slots in order", () => {
    const chain = localizationLlmFallbackChainFromEnv({
      LOCALIZATION_LLM_FALLBACK_BASE_URL: "https://first.example.com/v1",
      LOCALIZATION_LLM_FALLBACK_MODEL: "model-1",
      LOCALIZATION_LLM_FALLBACK_2_BASE_URL: "https://second.example.com/v1",
      LOCALIZATION_LLM_FALLBACK_2_MODEL: "model-2",
      LOCALIZATION_LLM_FALLBACK_3_BASE_URL: "https://third.example.com/v1",
      LOCALIZATION_LLM_FALLBACK_3_MODEL: "model-3",
    });
    expect(chain.map((entry) => entry.model)).toEqual([
      "model-1",
      "model-2",
      "model-3",
    ]);
  });

  it("inherits the writing fallback chain when localization names none", () => {
    const chain = localizationLlmFallbackChainFromEnv({
      WRITING_LLM_FALLBACK_BASE_URL: "https://groq.example.com/v1",
      WRITING_LLM_FALLBACK_MODEL: "writing-model-1",
      WRITING_LLM_FALLBACK_2_BASE_URL: "https://nvidia.example.com/v1",
      WRITING_LLM_FALLBACK_2_MODEL: "writing-model-2",
    });
    expect(chain.map((entry) => entry.baseUrl)).toEqual([
      "https://groq.example.com/v1",
      "https://nvidia.example.com/v1",
    ]);
  });

  it("prefers a localization fallback over the writing fallback per slot", () => {
    const first = localizationLlmFallbackFromEnv({
      LOCALIZATION_LLM_FALLBACK_BASE_URL: "https://localized.example.com/v1",
      LOCALIZATION_LLM_FALLBACK_MODEL: "loc-model",
      WRITING_LLM_FALLBACK_BASE_URL: "https://writing.example.com/v1",
      WRITING_LLM_FALLBACK_MODEL: "writing-model",
    });
    expect(first?.baseUrl).toBe("https://localized.example.com/v1");
    expect(first?.model).toBe("loc-model");
  });
});

describe("localization provider failover", () => {
  const primary = {
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

  it("moves to the fallback after a rate limit and reports the serving model", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return url.includes("primary")
          ? new Response(null, { status: 429 })
          : completion(
              JSON.stringify({
                segments: [{ segmentId: "seg_1", targetText: "Hola mundo" }],
              }),
              "fallback-served-model",
            );
      }),
    );

    const provider = createRemoteLlmLocalizationProvider(primary, [fallback]);
    const result = await provider.localize(request());

    expect(urls.map((url) => new URL(url).host)).toEqual([
      "primary.example.com",
      "secondary.example.com",
    ]);
    expect(result.providerModel).toBe("fallback-served-model");
    expect(result.segments).toEqual([
      { segmentId: "seg_1", targetText: "Hola mundo" },
    ]);
  });

  it("reports provider-unavailable when every endpoint fails", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createRemoteLlmLocalizationProvider(primary, [fallback]);
    try {
      await provider.localize(request());
      expect.unreachable("expected a localization error");
    } catch (error) {
      expect(isLocalizationError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(
        "LOCALIZATION_PROVIDER_UNAVAILABLE",
      );
      expect((error as Error).message).not.toContain("sk-");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops at a non-retryable rejection instead of trying the fallback", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createRemoteLlmLocalizationProvider(primary, [fallback]);
    try {
      await provider.localize(request());
      expect.unreachable("expected a localization error");
    } catch (error) {
      expect(isLocalizationError(error)).toBe(true);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
