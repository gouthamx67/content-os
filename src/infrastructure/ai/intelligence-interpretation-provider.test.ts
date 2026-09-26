import { describe, expect, it } from "vitest";

import {
  AUDIENCE_SIGNAL_KINDS,
  BRAND_SIGNAL_KINDS,
  CLAIM_TYPES,
  EVIDENCE_KINDS,
  FEATURE_CATEGORIES,
  IMPORTANCE_LEVELS,
  INTELLIGENCE_CONFIDENCE_LEVELS,
  INTELLIGENCE_RELATIONSHIP_TYPES,
  IntelligenceError,
} from "../../core/domain/intelligence";
import { canonicalEvidenceKey } from "../../core/domain/intelligence-canonical";
import type { IntelligenceInterpretationRequest } from "../../core/ports/intelligence-provider";
import { AiIntelligenceInterpretationProvider } from "./intelligence-interpretation-provider";
import { DeterministicIntelligenceInterpretationProvider } from "./deterministic-intelligence-interpretation-provider";
import { buildUserPrompt, extractJsonObject } from "./interpret-intelligence-text";

const sourceA = { id: "src_repo", type: "GITHUB" as const, name: "acme/content-os" };
const sourceB = { id: "src_site", type: "WEBSITE" as const, name: "acme.test" };

const repoEvidenceKey = canonicalEvidenceKey("src_repo", "REPOSITORY_FILE", "package.json");

function request(overrides: Partial<IntelligenceInterpretationRequest> = {}): IntelligenceInterpretationRequest {
  return {
    projectId: "proj_1",
    sources: [sourceA, sourceB],
    evidence: [
      {
        key: repoEvidenceKey,
        sourceId: "src_repo",
        kind: "REPOSITORY_FILE",
        locator: "package.json",
      },
    ],
    observations: "package.json declares next and react. The site advertises AI video generation.",
    ...overrides,
  };
}

function validPayload(): string {
  return JSON.stringify({
    product: {
      name: "Content OS",
      shortDescription: "Ship launch content faster",
      category: "Content Platform",
      purpose: "Turn a brief into launch assets",
      confidence: "MEDIUM",
      isMarketingClaim: false,
      sourceIds: ["src_site"],
      evidenceKeys: [canonicalEvidenceKey("src_site", "URL_SECTION", "h1:content-os")],
    },
    features: [
      {
        name: "Launch Analytics",
        description: "Tracks launch performance",
        category: "ANALYTICS",
        importance: "SECONDARY",
        confidence: "HIGH",
        isMarketingClaim: false,
        sourceIds: ["src_repo"],
        evidenceKeys: [repoEvidenceKey],
      },
    ],
    evidence: [
      {
        sourceId: "src_site",
        kind: "URL_SECTION",
        locator: "h1:content-os",
        excerpt: "Content OS",
      },
    ],
    relationships: [
      {
        type: "FEATURE_SUPPORTED_BY_EVIDENCE",
        fromType: "FEATURE",
        fromRef: "Launch Analytics",
        toType: "EVIDENCE",
        toRef: repoEvidenceKey,
        confidence: "HIGH",
      },
    ],
  });
}

function withRaw(text: string) {
  return new DeterministicIntelligenceInterpretationProvider(() => text);
}

describe("intelligence interpretation", () => {
  it("passes analyzer evidence into the prompt so the model can cite it", () => {
    const prompt = buildUserPrompt(request());
    expect(prompt).toContain(`key=${repoEvidenceKey}`);
    expect(prompt).toContain("id=src_repo type=GITHUB");
    expect(prompt).toContain("isMarketingClaim");
  });

  it("keeps the prompt enum list generated from the domain constants", () => {
    const prompt = buildUserPrompt(request());
    for (const values of [
      EVIDENCE_KINDS,
      INTELLIGENCE_CONFIDENCE_LEVELS,
      FEATURE_CATEGORIES,
      IMPORTANCE_LEVELS,
      CLAIM_TYPES,
      AUDIENCE_SIGNAL_KINDS,
      BRAND_SIGNAL_KINDS,
      INTELLIGENCE_RELATIONSHIP_TYPES,
    ]) {
      expect(prompt).toContain(values.join("|"));
    }
  });

  it("parses JSON returned inside a fenced code block", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("recovers a JSON object wrapped in prose", () => {
    expect(extractJsonObject('Here you go: {"a":1} hope that helps')).toEqual({ a: 1 });
  });

  it("rejects output with no JSON object", () => {
    expect(() => extractJsonObject("I could not analyze this")).toThrowError(IntelligenceError);
  });

  it("rejects malformed JSON", () => {
    expect(() => extractJsonObject('{"a": 1,}')).toThrowError(/malformed JSON/);
  });

  it("validates a well-formed interpretation into a draft", async () => {
    const result = await withRaw(validPayload()).interpret(request());

    expect(result.provider).toBe("deterministic-interpretation");
    expect(result.draft.product?.name).toBe("Content OS");
    expect(result.draft.features).toHaveLength(1);
    expect(result.draft.features[0].key).toBe("feature:launch-analytics");
    expect(result.draft.relationships).toHaveLength(1);
    expect(result.draft.relationships[0].toKey).toBe(repoEvidenceKey);
  });

  it("rejects a source id outside the analyzed project", async () => {
    const payload = JSON.parse(validPayload()) as Record<string, unknown>;
    (payload["product"] as Record<string, unknown>)["sourceIds"] = ["src_other"];
    await expect(withRaw(JSON.stringify(payload)).interpret(request())).rejects.toThrowError(
      /sourceId/,
    );
  });

  it("rejects an evidence reference that resolves to nothing", async () => {
    const payload = JSON.parse(validPayload()) as Record<string, unknown>;
    (payload["features"] as Record<string, unknown>[])[0]["evidenceKeys"] = ["ev:missing"];
    await expect(withRaw(JSON.stringify(payload)).interpret(request())).rejects.toThrowError(
      /evidence reference does not resolve/,
    );
  });

  it("rejects unknown top-level fields", async () => {
    const payload = JSON.parse(validPayload()) as Record<string, unknown>;
    payload["invented"] = [];
    await expect(withRaw(JSON.stringify(payload)).interpret(request())).rejects.toThrowError(
      /unknown field/i,
    );
  });

  it("rejects a relationship whose endpoints violate the relationship contract", async () => {
    const payload = JSON.parse(validPayload()) as Record<string, unknown>;
    (payload["relationships"] as Record<string, unknown>[])[0]["toType"] = "CLAIM";
    await expect(withRaw(JSON.stringify(payload)).interpret(request())).rejects.toThrowError(
      /toType/,
    );
  });

  it("rejects an output that contains no supported entity", async () => {
    const payload = JSON.parse(validPayload()) as Record<string, unknown>;
    delete payload["product"];
    payload["features"] = [];
    payload["evidence"] = [];
    payload["relationships"] = [];
    await expect(withRaw(JSON.stringify(payload)).interpret(request())).rejects.toThrowError(
      /no supported entities/,
    );
  });

  it("propagates a deterministic provider failure as an intelligence error", async () => {
    const provider = new DeterministicIntelligenceInterpretationProvider(
      () => new IntelligenceError("INTELLIGENCE_AI_UNAVAILABLE", "model offline"),
    );
    await expect(provider.interpret(request())).rejects.toThrowError(/model offline/);
  });

  it("wraps an unexpected provider failure", async () => {
    const provider = new DeterministicIntelligenceInterpretationProvider(
      () => new Error("socket hang up"),
    );
    await expect(provider.interpret(request())).rejects.toThrowError(/socket hang up/);
  });

  it("routes the AI adapter output through the same validation", async () => {
    const ai = {
      generate: async () => ({ text: validPayload(), model: "test-model" }),
    };
    const provider = new AiIntelligenceInterpretationProvider(ai, { defaultModel: "test-model" });
    const result = await provider.interpret(request());

    expect(result.model).toBe("test-model");
    expect(result.draft.features[0].name).toBe("Launch Analytics");
  });

  it("rejects AI output that fails validation", async () => {
    const ai = { generate: async () => ({ text: '{"features": "nope"}', model: "test-model" }) };
    const provider = new AiIntelligenceInterpretationProvider(ai);
    await expect(provider.interpret(request())).rejects.toThrowError(IntelligenceError);
  });
});
