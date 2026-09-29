import { describe, expect, it } from "vitest";
import { ContentIntentError } from "./content-intent";
import { parseContentIntentInterpretation } from "./content-intent-ai-validation";

function valid(overrides: Record<string, unknown> = {}) {
  return {
    contentTypeId: "video.launch",
    purpose: "launch",
    platforms: ["linkedin"],
    durationSeconds: 30,
    aspectRatio: "9:16",
    language: "en",
    tone: "confident",
    style: "minimal",
    quantity: 1,
    notes: ["Read as a product launch"],
    ...overrides,
  };
}

function parse(raw: string) {
  return parseContentIntentInterpretation(JSON.parse(raw));
}

describe("parseContentIntentInterpretation", () => {
  it("accepts a well-formed interpretation", () => {
    const result = parse(JSON.stringify(valid()));

    expect(result.contentTypeId).toBe("video.launch");
    expect(result.platforms).toEqual(["linkedin"]);
    expect(result.durationSeconds).toBe(30);
    expect(result.tone).toBe("confident");
    expect(result.notes).toEqual(["Read as a product launch"]);
  });

  it("accepts an empty interpretation rather than failing the run", () => {
    // A model that says nothing useful is not a failure: the deterministic
    // result stands and the user is asked.
    const result = parse(JSON.stringify({ notes: ["No reading available"] }));

    expect(result.contentTypeId).toBeUndefined();
    expect(result.platforms).toEqual([]);
  });

  // JSON text is the adapter's problem; this layer receives a value and decides
  // whether the shape is one CP09 can act on.
  it.each([
    ["a bare string", '"video.launch"'],
    ["an array", "[]"],
    ["null", "null"],
    ["a number", "30"],
  ])("rejects %s", (_label, raw) => {
    expect(() => parse(raw)).toThrow(ContentIntentError);
  });

  it("rejects an unknown content type", () => {
    expect(() => parse(JSON.stringify(valid({ contentTypeId: "video.hologram" })))).toThrow(
      /unsupported content type/i,
    );
  });

  it("rejects an unknown platform", () => {
    expect(() => parse(JSON.stringify(valid({ platforms: ["myspace"] })))).toThrow(
      /unknown platform "myspace"/i,
    );
  });

  it("rejects a non-integer or out-of-range duration", () => {
    expect(() => parse(JSON.stringify(valid({ durationSeconds: 30.5 })))).toThrow(
      ContentIntentError,
    );
    expect(() => parse(JSON.stringify(valid({ durationSeconds: 5_400 })))).toThrow(
      ContentIntentError,
    );
  });

  it("rejects a quantity outside the supported range", () => {
    expect(() => parse(JSON.stringify(valid({ quantity: 0 })))).toThrow(ContentIntentError);
    expect(() => parse(JSON.stringify(valid({ quantity: 500 })))).toThrow(ContentIntentError);
  });

  it("rejects an unknown aspect ratio", () => {
    expect(() => parse(JSON.stringify(valid({ aspectRatio: "3:2" })))).toThrow(
      /aspect ratio/i,
    );
  });

  it("rejects an unsupported tone or style", () => {
    expect(() => parse(JSON.stringify(valid({ tone: "sassy" })))).toThrow(/tone/i);
    expect(() => parse(JSON.stringify(valid({ style: "cyberpunk-vaporwave" })))).toThrow(
      /style/i,
    );
  });

  it("rejects a purpose outside the controlled list", () => {
    expect(() => parse(JSON.stringify(valid({ purpose: "go_viral" })))).toThrow(
      /purpose/i,
    );
  });

  it("rejects creative-direction fields even alongside a valid reading", () => {
    for (const creative of [
      { hook: "Stop scrolling" },
      { story: "A founder struggles, then discovers the product" },
      { angle: "Contrarian" },
      { scenes: ["intro", "outro"] },
      { visualDirection: "neon" },
      { music: "upbeat synth" },
      { script: "Scene one..." },
      { persona: "busy founder" },
    ]) {
      const key = Object.keys(creative)[0];
      expect(() => parse(JSON.stringify(valid(creative)))).toThrow(
        new RegExp(`"${key}"`),
      );
    }
  });

  it("rejects a field it does not know at all", () => {
    expect(() => parse(JSON.stringify(valid({ moodboard: "swiss" })))).toThrow(
      /unexpected field "moodboard"/i,
    );
  });

  it("rejects an audience or a CTA written by the model", () => {
    expect(() => parse(JSON.stringify(valid({ audience: "startup founders" })))).toThrow(
      ContentIntentError,
    );
    expect(() => parse(JSON.stringify(valid({ cta: "Start free" })))).toThrow(
      ContentIntentError,
    );
  });

  it("rejects a long value instead of truncating it silently", () => {
    expect(() =>
      parse(JSON.stringify(valid({ tone: "a".repeat(200) }))),
    ).toThrow(ContentIntentError);
  });

  it("names the failure with an intent error code", () => {
    try {
      parse(JSON.stringify(valid({ contentTypeId: "video.hologram" })));
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ContentIntentError);
      expect((error as ContentIntentError).code).toBe("INTENT_AI_INVALID_OUTPUT");
    }
  });
});
