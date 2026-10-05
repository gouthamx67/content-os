import { describe, expect, it } from "vitest";
import {
  MAX_VARIANTS,
  MIN_VARIANTS,
  isWritingProvider,
  validateGenerateRequest,
} from "../domain/validation";
import type { WritingGenerateRequest } from "../domain/types";
import { WritingError } from "../errors";

function request(
  overrides: Partial<WritingGenerateRequest> = {},
): WritingGenerateRequest {
  return {
    projectId: "project_1",
    requestedById: "user_1",
    blockType: "HEADLINE",
    tone: "BRAND",
    length: "MEDIUM",
    objective: "AWARENESS",
    audience: null,
    language: null,
    prompt: "Announce our scheduling tool",
    variantCount: 3,
    provider: "LOCAL_RULES",
    intentId: null,
    directionId: null,
    storyboardId: null,
    sceneId: null,
    ...overrides,
  };
}

describe("validateGenerateRequest", () => {
  it("accepts a well-formed request", () => {
    expect(() => validateGenerateRequest(request())).not.toThrow();
  });

  it("rejects a missing prompt", () => {
    expect(() => validateGenerateRequest(request({ prompt: "   " }))).toThrow(
      /prompt is required/i,
    );
  });

  it("rejects an unknown block type", () => {
    expect(() =>
      validateGenerateRequest(
        request({ blockType: "NOPE" as WritingGenerateRequest["blockType"] }),
      ),
    ).toThrow(/Unsupported block type/);
  });

  it("rejects an unknown tone, length and objective", () => {
    expect(() =>
      validateGenerateRequest(
        request({ tone: "LOUD" as WritingGenerateRequest["tone"] }),
      ),
    ).toThrow(/Unsupported tone/);
    expect(() =>
      validateGenerateRequest(
        request({ length: "HUGE" as WritingGenerateRequest["length"] }),
      ),
    ).toThrow(/Unsupported length/);
    expect(() =>
      validateGenerateRequest(
        request({ objective: "VIRAL" as WritingGenerateRequest["objective"] }),
      ),
    ).toThrow(/Unsupported objective/);
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      validateGenerateRequest(
        request({ provider: "MOCK" as WritingGenerateRequest["provider"] }),
      ),
    ).toThrow(WritingError);
  });

  it("bounds the variant count", () => {
    expect(() =>
      validateGenerateRequest(request({ variantCount: MIN_VARIANTS - 1 })),
    ).toThrow(/variantCount/);
    expect(() =>
      validateGenerateRequest(request({ variantCount: MAX_VARIANTS + 1 })),
    ).toThrow(/variantCount/);
    expect(() =>
      validateGenerateRequest(request({ variantCount: 2.5 })),
    ).toThrow(/variantCount/);
  });

  it("only accepts known providers", () => {
    expect(isWritingProvider("LOCAL_RULES")).toBe(true);
    expect(isWritingProvider("REMOTE_LLM")).toBe(true);
    expect(isWritingProvider("OPENAI")).toBe(false);
  });
});
