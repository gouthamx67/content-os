import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRemoteLlmLocalizationProvider,
  localizationLlmConfigFromEnv,
  REMOTE_LLM_PROVIDER,
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
    segments: [segment("seg_1", "Hello world"), segment("seg_2", "Second line")],
    glossary: [{ term: "Hello", translation: "Hola", doNotTranslate: false }],
  };
}

function completion(content: string, model = "stub-mt-1"): Response {
  return new Response(
    JSON.stringify({
      model,
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function expectErrorCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(isLocalizationError(error)).toBe(true);
    expect((error as { code: string }).code).toBe(code);
    return;
  }
  throw new Error("Expected the provider call to reject");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("localization LLM config from env", () => {
  it("requires a base URL and a model", () => {
    expect(localizationLlmConfigFromEnv({})).toBeNull();
    expect(
      localizationLlmConfigFromEnv({ LOCALIZATION_LLM_BASE_URL: "http://x" }),
    ).toBeNull();
    expect(
      localizationLlmConfigFromEnv({ LOCALIZATION_LLM_MODEL: "m" }),
    ).toBeNull();
  });

  it("prefers LOCALIZATION_LLM_* and strips a trailing slash", () => {
    const config = localizationLlmConfigFromEnv({
      LOCALIZATION_LLM_BASE_URL: "http://local/v1/",
      LOCALIZATION_LLM_MODEL: "mt-1",
      WRITING_LLM_BASE_URL: "http://writing/v1",
      WRITING_LLM_MODEL: "writer",
    });
    expect(config).toEqual({
      baseUrl: "http://local/v1",
      apiKey: null,
      model: "mt-1",
      timeoutMs: 45_000,
    });
  });

  it("falls back to the writing LLM settings", () => {
    const config = localizationLlmConfigFromEnv({
      WRITING_LLM_BASE_URL: "http://writing/v1",
      WRITING_LLM_MODEL: "writer",
      WRITING_LLM_API_KEY: "secret",
      LOCALIZATION_LLM_TIMEOUT_MS: "5000",
    });
    expect(config).toEqual({
      baseUrl: "http://writing/v1",
      apiKey: "secret",
      model: "writer",
      timeoutMs: 5_000,
    });
  });
});

describe("remote LLM localization provider", () => {
  it("posts a translation prompt and returns the model's segments", async () => {
    const fetchMock = vi.fn(async () =>
      completion(
        JSON.stringify({
          segments: [
            { segmentId: "seg_1", targetText: "Hola mundo" },
            { segmentId: "seg_2", targetText: "Segunda línea" },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createRemoteLlmLocalizationProvider({
      baseUrl: "http://model/v1",
      apiKey: "key",
      model: "mt-1",
      timeoutMs: 1_000,
    });

    const result = await provider.localize(request());

    expect(provider.name).toBe(REMOTE_LLM_PROVIDER);
    expect(result.provider).toBe(REMOTE_LLM_PROVIDER);
    expect(result.providerModel).toBe("stub-mt-1");
    expect(result.segments).toEqual([
      { segmentId: "seg_1", targetText: "Hola mundo" },
      { segmentId: "seg_2", targetText: "Segunda línea" },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://model/v1/chat/completions");
    expect((init.headers as Record<string, string>)["authorization"]).toBe(
      "Bearer key",
    );
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: { content: string }[];
    };
    expect(body.model).toBe("mt-1");
    expect(body.messages[0]!.content).toContain("professional translator");
    expect(body.messages[1]!.content).toContain("en to es");
    expect(body.messages[1]!.content).toContain("Hello => Hola");
    expect(body.messages[1]!.content).toContain("seg_1");
  });

  it("reads segments out of a fenced JSON block", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        completion(
          '```json\n{"segments":[{"segmentId":"seg_1","targetText":"Hola"}]}\n```',
        ),
      ),
    );

    const provider = createRemoteLlmLocalizationProvider({
      baseUrl: "http://model/v1",
      apiKey: null,
      model: "mt-1",
      timeoutMs: 1_000,
    });

    const result = await provider.localize(request());
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]!.targetText).toBe("Hola");
  });

  it("reports an unreachable endpoint as provider-unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 502 })),
    );

    const provider = createRemoteLlmLocalizationProvider({
      baseUrl: "http://model/v1",
      apiKey: null,
      model: "mt-1",
      timeoutMs: 1_000,
    });

    await expectErrorCode(
      provider.localize(request()),
      "LOCALIZATION_PROVIDER_UNAVAILABLE",
    );
  });

  it("reports unparseable content as invalid output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => completion("I am not JSON at all")),
    );

    const provider = createRemoteLlmLocalizationProvider({
      baseUrl: "http://model/v1",
      apiKey: null,
      model: "mt-1",
      timeoutMs: 1_000,
    });

    await expectErrorCode(
      provider.localize(request()),
      "LOCALIZATION_PROVIDER_INVALID_OUTPUT",
    );
  });

  it("reports a segment with no target text as invalid output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        completion('{"segments":[{"segmentId":"seg_1"}]}'),
      ),
    );

    const provider = createRemoteLlmLocalizationProvider({
      baseUrl: "http://model/v1",
      apiKey: null,
      model: "mt-1",
      timeoutMs: 1_000,
    });

    await expectErrorCode(
      provider.localize(request()),
      "LOCALIZATION_PROVIDER_INVALID_OUTPUT",
    );
  });
});
