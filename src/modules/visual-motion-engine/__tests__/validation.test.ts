import { describe, expect, it } from "vitest";
import {
  VisualValidationError,
  normalizeAssetRef,
  validateCompositionInput,
  validateEffectAmount,
  validateKeyframeInput,
  validateLayerInput,
} from "../domain/validation";

describe("normalizeAssetRef", () => {
  it("accepts canonical capture and asset references", () => {
    expect(normalizeAssetRef("capture:take_abc-1")).toBe("capture:take_abc-1");
    expect(normalizeAssetRef("asset:Logo_2")).toBe("asset:Logo_2");
    expect(normalizeAssetRef("  capture:x  ")).toBe("capture:x");
  });

  it.each([
    "capture:../secret",
    "/etc/passwd",
    "../take",
    "file:///tmp/x",
    "http://evil.test/x",
    "https://evil.test/x",
    "data:image/png;base64,AAAA",
    "capture:bad\u0000id",
    "Capture:Upper",
    "capture:with/slash",
    "",
  ])("rejects %s", (value) => {
    expect(() => normalizeAssetRef(value)).toThrow(VisualValidationError);
  });
});

describe("validateCompositionInput", () => {
  const valid = {
    name: "Reel",
    width: 1080,
    height: 1920,
    frameRate: 30,
    durationMs: 5000,
  };

  it("accepts a valid composition", () => {
    expect(() => validateCompositionInput(valid)).not.toThrow();
  });

  it.each([
    [{ ...valid, name: "  " }],
    [{ ...valid, width: 0 }],
    [{ ...valid, width: 7681 }],
    [{ ...valid, width: 10.5 }],
    [{ ...valid, frameRate: 0 }],
    [{ ...valid, frameRate: 241 }],
    [{ ...valid, durationMs: 0 }],
    [{ ...valid, durationMs: 3_600_001 }],
  ])("rejects invalid composition %#", (input) => {
    expect(() => validateCompositionInput(input)).toThrow(
      VisualValidationError,
    );
  });
});

describe("validateLayerInput", () => {
  const base = {
    type: "SHAPE" as const,
    assetRef: null,
    textContent: null,
    width: 100,
    height: 100,
    opacity: 1,
  };

  it("requires an assetRef for media layers", () => {
    expect(() =>
      validateLayerInput({ ...base, type: "MEDIA" }),
    ).toThrow(VisualValidationError);

    expect(() =>
      validateLayerInput({
        ...base,
        type: "MEDIA",
        assetRef: "capture:abc",
      }),
    ).not.toThrow();
  });

  it("requires text for text layers", () => {
    expect(() =>
      validateLayerInput({ ...base, type: "TEXT", textContent: "  " }),
    ).toThrow(VisualValidationError);
  });

  it("bounds opacity and rotation", () => {
    expect(() => validateLayerInput({ ...base, opacity: 1.5 })).toThrow();
    expect(() => validateLayerInput({ ...base, rotation: 3601 })).toThrow();
    expect(() => validateLayerInput({ ...base, rotation: -3600 })).not.toThrow();
  });
});

describe("validateEffectAmount", () => {
  it("treats grayscale as a fraction", () => {
    expect(() => validateEffectAmount("GRAYSCALE", 1)).not.toThrow();
    expect(() => validateEffectAmount("GRAYSCALE", 1.01)).toThrow(
      VisualValidationError,
    );
  });

  it("bounds other effects", () => {
    expect(() => validateEffectAmount("BLUR", 10)).not.toThrow();
    expect(() => validateEffectAmount("BLUR", 10.1)).toThrow();
    expect(() => validateEffectAmount("BLUR", -1)).toThrow();
  });
});

describe("validateKeyframeInput", () => {
  it("bounds opacity values and time", () => {
    expect(() =>
      validateKeyframeInput({
        property: "OPACITY",
        timeMs: 0,
        fromValue: 0,
        toValue: 1,
        easing: "LINEAR",
      }),
    ).not.toThrow();

    expect(() =>
      validateKeyframeInput({
        property: "OPACITY",
        timeMs: 0,
        fromValue: 0,
        toValue: 2,
        easing: "LINEAR",
      }),
    ).toThrow(VisualValidationError);

    expect(() =>
      validateKeyframeInput({
        property: "X",
        timeMs: -1,
        fromValue: 0,
        toValue: 1,
        easing: "LINEAR",
      }),
    ).toThrow(VisualValidationError);
  });
});
