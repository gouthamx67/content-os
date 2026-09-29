import { describe, expect, it } from "vitest";
import { ContentIntentParser } from "./content-intent-parser";
import {
  ContentIntentResolver,
  type IntentResolutionContext,
} from "./content-intent-resolver";
import { ContentIntentValidator } from "./content-intent-validator";
import type { ContentIntentInterpretation } from "../ports/content-intent-interpreter";

const parser = new ContentIntentParser();
const resolver = new ContentIntentResolver();
const validator = new ContentIntentValidator();

const PROJECT_ID = "project-1";

function resolve(
  request: string,
  context: Partial<IntentResolutionContext> = {},
  interpretation?: ContentIntentInterpretation | null,
) {
  return resolver.resolve(
    request,
    parser.parse(request),
    { projectId: PROJECT_ID, ...context },
    interpretation,
  );
}

describe("ContentIntentResolver", () => {
  it("resolves Scenario A to a validated launch video", () => {
    const intent = resolve(
      "Make a 30 second cinematic launch video for LinkedIn",
      { brandVersion: 4, brandTone: "confident", sourceIds: ["source-1"] },
    );

    expect(intent.contentTypeId).toBe("video.launch");
    expect(intent.resolutionMode).toBe("EXPLICIT");
    expect(intent.status).toBe("RESOLVED");
    expect(intent.channel).toBe("VIDEO");
    expect(intent.platforms).toEqual(["linkedin"]);
    expect(intent.durationSeconds).toBe(30);
    expect(intent.style).toBe("cinematic");
    expect(intent.quantity).toBe(1);
    expect(intent.language).toBe("en");
    expect(intent.brandVersion).toBe(4);
    expect(intent.intelligenceSnapshotVersion).toBeUndefined();
    expect(intent.confidence).toBe("HIGH");
    expect(validator.validate(intent)).toEqual([]);
  });

  it("applies the platform default aspect ratio only when every platform agrees", () => {
    const single = resolve("Make a launch video for Instagram");
    expect(single.aspectRatio).toBe("4:5");

    const varied = resolve("Make a launch video for Instagram and YouTube");
    expect(varied.aspectRatio).toBeUndefined();
  });

  it("keeps a user-chosen aspect ratio over the platform default", () => {
    const intent = resolve("Make a 9:16 Instagram launch video");

    expect(intent.aspectRatio).toBe("9:16");
  });

  it("resolves Scenario B to five social videos with a linked subject", () => {
    const intent = resolve(
      "Create 5 TikTok concepts about the analytics feature",
      {
        brandVersion: 4,
        brandTone: "confident",
        intelligenceSnapshotVersion: 9,
        subjects: [{ type: "FEATURE", id: "feature-1" }],
      },
    );

    expect(intent.contentTypeId).toBe("video.social");
    expect(intent.resolutionMode).toBe("INFERRED");
    expect(intent.quantity).toBe(5);
    expect(intent.platforms).toEqual(["tiktok"]);
    expect(intent.subjects).toEqual([{ type: "FEATURE", id: "feature-1" }]);
    expect(intent.intelligenceSnapshotVersion).toBe(9);
    expect(intent.confidence).toBe("MEDIUM");
    expect(intent.status).toBe("RESOLVED");
  });

  it("resolves Scenario C to a LinkedIn announcement in Hindi", () => {
    const intent = resolve("Turn this into a LinkedIn announcement in Hindi");

    expect(intent.contentTypeId).toBe("text.linkedin");
    expect(intent.platforms).toEqual(["linkedin"]);
    expect(intent.language).toBe("hi");
    expect(intent.status).toBe("RESOLVED");
  });

  it("resolves Scenario D to a clarification instead of an invented output", () => {
    const intent = resolve("Make something for this.");

    expect(intent.resolutionMode).toBe("NEEDS_CLARIFICATION");
    expect(intent.status).toBe("NEEDS_CLARIFICATION");
    expect(intent.contentTypeId).toBe("");
    expect(intent.unresolvedFields).toContain("contentType");
    expect(intent.rawRequest).toBe("Make something for this.");
    expect(
      validator.validate(intent, { allowUnresolvedType: true }),
    ).toEqual([]);
    expect(validator.validate(intent)).not.toEqual([]);
  });

  it("keeps a known constraint while the output type is still missing", () => {
    const intent = resolve("Make this look premium.");

    expect(intent.tone).toBe("premium");
    expect(intent.contentTypeId).toBe("");
    expect(intent.unresolvedFields).toEqual(["contentType"]);
  });

  it("records a brand-derived tone as BRAND, never as a user constraint", () => {
    const intent = resolve("Make a launch video", {
      brandVersion: 2,
      brandTone: "confident",
    });

    expect(intent.tone).toBe("confident");
    expect(intent.constraints).toContainEqual({
      key: "tone",
      value: "confident",
      source: "BRAND",
    });
    expect(intent.constraints).toContainEqual({
      key: "quantity",
      value: "1",
      source: "SYSTEM",
    });
  });

  it("does not let a brand tone override the user's", () => {
    const intent = resolve("Make a technical launch video", {
      brandVersion: 2,
      brandTone: "confident",
    });

    expect(intent.tone).toBe("technical");
    expect(intent.constraints).toContainEqual({
      key: "tone",
      value: "technical",
      source: "USER",
    });
    expect(intent.constraints).not.toContainEqual({
      key: "tone",
      value: "confident",
      source: "BRAND",
    });
  });

  it("does not invent a tone when the brand has none", () => {
    const intent = resolve("Make a launch video", { brandVersion: 2 });

    expect(intent.tone).toBeUndefined();
    // Nothing was inferred: the request was explicit, so confidence stays HIGH.
    expect(intent.confidence).toBe("HIGH");
  });

  it("uses an AI reading for a gap the rules could not close", () => {
    const interpretation: ContentIntentInterpretation = {
      contentTypeId: "video.explainer",
      purpose: "education",
      platforms: ["youtube"],
      durationSeconds: 90,
      aspectRatio: "16:9",
      language: "en",
      tone: "informative",
      style: undefined,
      quantity: 1,
      provider: "openai/gpt-4o-mini",
      model: "gpt-4o-mini",
      notes: ["Read as an educational explainer"],
    };

    const intent = resolve("Make something for this.", {}, interpretation);

    expect(intent.contentTypeId).toBe("video.explainer");
    expect(intent.resolutionMode).toBe("INFERRED");
    expect(intent.durationSeconds).toBe(90);
    expect(intent.constraints).toContainEqual({
      key: "contentType",
      value: "video.explainer",
      source: "AI",
    });
    expect(intent.constraints).toContainEqual({
      key: "platform",
      value: "youtube",
      source: "AI",
    });
  });

  it("never lets the model override a stated value", () => {
    const interpretation: ContentIntentInterpretation = {
      contentTypeId: "image.thumbnail",
      purpose: undefined,
      platforms: ["youtube"],
      durationSeconds: 300,
      aspectRatio: "1:1",
      language: undefined,
      tone: "playful",
      style: undefined,
      quantity: 9,
      provider: "openai/gpt-4o-mini",
      model: "gpt-4o-mini",
      notes: [],
    };

    const intent = resolve(
      "Make a 30 second 16:9 launch video for LinkedIn",
      {},
      interpretation,
    );

    expect(intent.contentTypeId).toBe("video.launch");
    expect(intent.durationSeconds).toBe(30);
    expect(intent.aspectRatio).toBe("16:9");
    expect(intent.platforms).toEqual(["linkedin"]);
    expect(intent.quantity).toBe(1);
  });

  it("applies a user edit as a user constraint and revalidates", () => {
    const original = resolve("Make a 15 second TikTok video");
    const edited = resolver.applyUserEdit(original, {
      durationSeconds: 45,
      tone: "playful",
    });

    expect(edited.durationSeconds).toBe(45);
    expect(edited.tone).toBe("playful");
    expect(edited.constraints).toContainEqual({
      key: "duration",
      value: "45",
      source: "USER",
    });
    expect(validator.validate(edited)).toEqual([]);
  });

  it("raises the resolution mode when the user answers the open question", () => {
    const draft = resolve("Make something for this.");
    const answered = resolver.applyUserEdit(draft, { contentTypeId: "video.social" });

    expect(answered.resolutionMode).toBe("EXPLICIT");
    expect(answered.status).toBe("RESOLVED");
    expect(answered.unresolvedFields).toEqual([]);
  });
});

describe("ContentIntentValidator", () => {
  it("rejects a duration the content type cannot carry", () => {
    const intent = resolve("Make a 30 second thumbnail");

    expect(validator.validate(intent)).toEqual([
      "CONTENT_TYPE_DOES_NOT_SUPPORT_DURATION",
    ]);
  });

  it("rejects a platform the content type cannot use", () => {
    const intent = resolve("Make a launch video for YouTube Shorts");

    // A launch video is a long-form output: a Short cannot carry it.
    expect(validator.validate(intent)).toEqual([
      "PLATFORM_UNSUPPORTED:youtube_short",
    ]);
  });

  it("rejects two durations in one request", () => {
    const intent = resolve("Make a 15 second or 30 second launch video");

    expect(validator.validate(intent)).toEqual(["CONFLICTING_DURATION"]);
  });

  it("rejects two aspect ratios in one request", () => {
    const intent = resolve("Make a 16:9 vertical TikTok video");

    expect(validator.validate(intent)).toEqual(["CONFLICTING_ASPECT_RATIO"]);
  });

  it("accepts a custom ratio with usable dimensions", () => {
    const intent = resolve("Make a 1080x1920 launch video");

    expect(intent.aspectRatio).toBe("CUSTOM");
    expect(intent.customAspectRatio).toEqual({ width: 1080, height: 1920 });
    expect(validator.validate(intent)).toEqual([]);
  });

  it("refuses a custom ratio that is not a real size", () => {
    const intent = resolve("Make a launch video");
    intent.aspectRatio = "CUSTOM";
    intent.customAspectRatio = { width: 0, height: 0 };

    expect(validator.validate(intent)).toEqual(["INVALID_CUSTOM_ASPECT_RATIO"]);
  });

  it("leaves an unsupported brand tone out and says so instead of guessing", () => {
    const intent = resolve("Make a launch video", {
      brandVersion: 2,
      brandTone: "quirky",
    });

    expect(intent.tone).toBeUndefined();
    expect(intent.constraints.some((entry) => entry.key === "tone")).toBe(false);
    expect(intent.status).toBe("RESOLVED");
  });

  it("records the language default as a system default", () => {
    const intent = resolve("Make a launch video");

    expect(intent.language).toBe("en");
    expect(intent.constraints).toContainEqual({
      key: "language",
      value: "en",
      source: "SYSTEM",
    });
  });
});
