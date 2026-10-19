import { describe, expect, it } from "vitest";
import {
  assertServerConfig,
  collectServerConfigIssues,
  describeFeatureCapabilities,
  ServerConfigError,
} from "./server-config";

const VALID_DATABASE_URL =
  "postgresql://user:pass@localhost:5432/content_os";

function keys(issues: readonly { key: string }[]): string[] {
  return issues.map((issue) => issue.key).sort();
}

describe("collectServerConfigIssues", () => {
  it("accepts a minimal valid environment", () => {
    expect(
      collectServerConfigIssues({
        DATABASE_URL: VALID_DATABASE_URL,
        NODE_ENV: "production",
      }),
    ).toEqual([]);
  });

  it("requires DATABASE_URL", () => {
    expect(keys(collectServerConfigIssues({}))).toContain("DATABASE_URL");
  });

  it("rejects a non-postgres DATABASE_URL scheme", () => {
    const issues = collectServerConfigIssues({
      DATABASE_URL: "mysql://localhost/content_os",
    });
    expect(keys(issues)).toContain("DATABASE_URL");
  });

  it("rejects an unknown NODE_ENV", () => {
    const issues = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      NODE_ENV: "staging",
    });
    expect(keys(issues)).toContain("NODE_ENV");
  });

  it("rejects an unsafe session cookie name", () => {
    const issues = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      SESSION_COOKIE_NAME: "bad name; drop",
    });
    expect(keys(issues)).toContain("SESSION_COOKIE_NAME");
  });

  it("requires CONTENT_OS_APP_ORIGIN to be a bare origin", () => {
    const withPath = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      CONTENT_OS_APP_ORIGIN: "https://app.example.com/dashboard",
    });
    expect(keys(withPath)).toContain("CONTENT_OS_APP_ORIGIN");

    const valid = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      CONTENT_OS_APP_ORIGIN: "https://app.example.com",
    });
    expect(valid).toEqual([]);
  });

  it("requires PUBLISHING_SECRET_KEY to decode to 32 bytes", () => {
    const short = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      PUBLISHING_SECRET_KEY: Buffer.alloc(16).toString("base64"),
    });
    expect(keys(short)).toContain("PUBLISHING_SECRET_KEY");

    const correct = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      PUBLISHING_SECRET_KEY: Buffer.alloc(32).toString("base64"),
    });
    expect(correct).toEqual([]);
  });

  it("treats Mastodon settings as all-or-none", () => {
    const partial = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      PUBLISHING_MASTODON_BASE_URL: "https://mastodon.example.com",
    });
    expect(keys(partial)).toContain("PUBLISHING_MASTODON_*");
  });

  it("rejects a non-http Mastodon base URL", () => {
    const issues = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      PUBLISHING_MASTODON_BASE_URL: "ftp://mastodon.example.com",
      PUBLISHING_MASTODON_CLIENT_ID: "id",
      PUBLISHING_MASTODON_CLIENT_SECRET: "secret",
    });
    expect(keys(issues)).toContain("PUBLISHING_MASTODON_BASE_URL");
  });

  it("rejects a non-positive LLM timeout", () => {
    const issues = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      WRITING_LLM_TIMEOUT_MS: "0",
    });
    expect(keys(issues)).toContain("WRITING_LLM_TIMEOUT_MS");
  });

  it("rejects an incomplete LLM endpoint (base URL without model, or the reverse)", () => {
    const missingModel = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      WRITING_LLM_BASE_URL: "https://llm.example.com/v1",
    });
    expect(keys(missingModel)).toContain("WRITING_LLM_BASE_URL/WRITING_LLM_MODEL");

    const missingBase = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      WRITING_LLM_FALLBACK_2_MODEL: "some-model",
    });
    expect(keys(missingBase)).toContain(
      "WRITING_LLM_FALLBACK_2_BASE_URL/WRITING_LLM_FALLBACK_2_MODEL",
    );
  });

  it("validates every configured fallback endpoint's URL and timeout", () => {
    const issues = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      WRITING_LLM_FALLBACK_3_BASE_URL: "ftp://bad.example.com",
      WRITING_LLM_FALLBACK_3_MODEL: "model",
      LOCALIZATION_LLM_FALLBACK_TIMEOUT_MS: "soon",
      CONTENT_OS_AI_FALLBACK_BASE_URL: "https://ai.example.com/v1",
      CONTENT_OS_AI_FALLBACK_MODEL: "model",
    });
    expect(keys(issues)).toContain("WRITING_LLM_FALLBACK_3_BASE_URL");
    expect(keys(issues)).toContain("LOCALIZATION_LLM_FALLBACK_TIMEOUT_MS");
  });

  it("accepts a complete writing endpoint with fallbacks", () => {
    expect(
      collectServerConfigIssues({
        DATABASE_URL: VALID_DATABASE_URL,
        WRITING_LLM_BASE_URL: "https://api.openai.com/v1",
        WRITING_LLM_MODEL: "gpt-4o-mini",
        WRITING_LLM_FALLBACK_BASE_URL: "https://api.groq.com/openai/v1",
        WRITING_LLM_FALLBACK_MODEL: "openai/gpt-oss-120b",
      }),
    ).toEqual([]);
  });

  it('requires the model-assisted gates to be exactly "1" and to have an endpoint', () => {
    const badValue = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      CONTENT_OS_AI_INTERPRETATION: "true",
    });
    expect(keys(badValue)).toContain("CONTENT_OS_AI_INTERPRETATION");

    const noEndpoint = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      CONTENT_OS_AI_BROWSER: "1",
    });
    expect(keys(noEndpoint)).toContain("CONTENT_OS_AI_BROWSER");

    const satisfied = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      CONTENT_OS_AI_INTERPRETATION: "1",
      WRITING_LLM_BASE_URL: "https://llm.example.com/v1",
      WRITING_LLM_MODEL: "model",
    });
    expect(satisfied).toEqual([]);
  });

  it('requires CONTENT_OS_TRUST_PROXY to be exactly "1"', () => {
    const issues = collectServerConfigIssues({
      DATABASE_URL: VALID_DATABASE_URL,
      CONTENT_OS_TRUST_PROXY: "true",
    });
    expect(keys(issues)).toContain("CONTENT_OS_TRUST_PROXY");
  });
});

describe("assertServerConfig", () => {
  it("throws with a named context and every issue", () => {
    expect(() => assertServerConfig("unit-test", {})).toThrow(ServerConfigError);

    try {
      assertServerConfig("unit-test", {});
      expect.unreachable("expected assertServerConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ServerConfigError);
      expect((error as ServerConfigError).message).toContain("unit-test");
      expect((error as ServerConfigError).issues.length).toBeGreaterThan(0);
    }
  });

  it("does not throw for a valid environment", () => {
    expect(() =>
      assertServerConfig("unit-test", {
        DATABASE_URL: VALID_DATABASE_URL,
      }),
    ).not.toThrow();
  });
});

describe("describeFeatureCapabilities", () => {
  it("reports every optional feature as unavailable when unconfigured", () => {
    const capabilities = describeFeatureCapabilities({
      DATABASE_URL: VALID_DATABASE_URL,
    });
    expect(capabilities.publishing.available).toBe(false);
    expect(capabilities.publishing.provider).toBeNull();
    expect(capabilities.aiProvider.available).toBe(false);
    expect(capabilities.aiInterpretation.available).toBe(false);
    expect(capabilities.aiBrowser.available).toBe(false);
    expect(capabilities.writingProvider.available).toBe(false);
    expect(capabilities.localizationProvider.available).toBe(false);
  });

  it("does not claim writing capability for a base URL without a model", () => {
    const capabilities = describeFeatureCapabilities({
      WRITING_LLM_BASE_URL: "https://llm.example.com/v1",
    });
    expect(capabilities.writingProvider.available).toBe(false);
  });

  it("reports the gate, endpoint and fallback count honestly", () => {
    const capabilities = describeFeatureCapabilities({
      WRITING_LLM_BASE_URL: "https://api.openai.com/v1",
      WRITING_LLM_MODEL: "gpt-4o-mini",
      WRITING_LLM_FALLBACK_BASE_URL: "https://api.groq.com/openai/v1",
      WRITING_LLM_FALLBACK_MODEL: "openai/gpt-oss-120b",
      CONTENT_OS_AI_INTERPRETATION: "1",
    });
    expect(capabilities.aiProvider.available).toBe(true);
    expect(capabilities.aiInterpretation.available).toBe(true);
    expect(capabilities.aiBrowser.available).toBe(false);
    expect(capabilities.writingProvider.detail).toBe(
      "configured with 1 fallback endpoint(s)",
    );
  });

  it("only marks publishing available with a provider and a key", () => {
    const providerOnly = describeFeatureCapabilities({
      PUBLISHING_MASTODON_BASE_URL: "https://mastodon.example.com",
      PUBLISHING_MASTODON_CLIENT_ID: "id",
      PUBLISHING_MASTODON_CLIENT_SECRET: "secret",
    });
    expect(providerOnly.publishing.provider).toBe("mastodon");
    expect(providerOnly.publishing.available).toBe(false);

    const complete = describeFeatureCapabilities({
      PUBLISHING_MASTODON_BASE_URL: "https://mastodon.example.com",
      PUBLISHING_MASTODON_CLIENT_ID: "id",
      PUBLISHING_MASTODON_CLIENT_SECRET: "secret",
      PUBLISHING_SECRET_KEY: Buffer.alloc(32).toString("base64"),
    });
    expect(complete.publishing.available).toBe(true);
  });

  it("falls back to the writing endpoint for localization", () => {
    const capabilities = describeFeatureCapabilities({
      WRITING_LLM_BASE_URL: "https://llm.example.com",
      WRITING_LLM_MODEL: "model",
    });
    expect(capabilities.writingProvider.available).toBe(true);
    expect(capabilities.localizationProvider.available).toBe(true);
  });
});
