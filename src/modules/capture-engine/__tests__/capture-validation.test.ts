import { describe, expect, it } from "vitest";
import {
  ALLOWED_MIME_TYPES,
  MAX_CAPTURE_BYTES,
  MAX_DURATION_MS,
  normalizeMimeType,
  sanitizeCaptureMetadata,
  validateCaptureInput,
} from "../capture-validation";

describe("normalizeMimeType", () => {
  it("strips the codec suffix a MediaRecorder reports", () => {
    expect(normalizeMimeType("video/webm;codecs=vp9,opus")).toBe("video/webm");
    expect(normalizeMimeType("audio/webm; codecs=opus")).toBe("audio/webm");
  });

  it("lowercases and treats audio/wave as audio/wav", () => {
    expect(normalizeMimeType("VIDEO/MP4")).toBe("video/mp4");
    expect(normalizeMimeType("audio/wave")).toBe("audio/wav");
  });

  it("returns an empty string for an empty type", () => {
    expect(normalizeMimeType("")).toBe("");
  });
});

describe("validateCaptureInput", () => {
  const bytes = Buffer.from("content-os-cp13-real-capture-fixture", "utf8");

  it("accepts an allowed recording within every limit", () => {
    expect(() =>
      validateCaptureInput({
        mimeType: "video/webm",
        byteSize: bytes.byteLength,
        metadata: { durationMs: 4_200, width: 1280, height: 720, frameRate: 30 },
      }),
    ).not.toThrow();
  });

  it("rejects a type outside the explicit allowlist", () => {
    for (const mimeType of ["image/svg+xml", "text/html", "application/pdf"]) {
      expect(() =>
        validateCaptureInput({ mimeType, byteSize: 10 }),
      ).toThrow(/Unsupported capture MIME type/);
    }
  });

  it("does not accept a prefix match that a startsWith allowlist would", () => {
    expect(ALLOWED_MIME_TYPES.has("image/svg+xml")).toBe(false);
    expect(ALLOWED_MIME_TYPES.has("text/html")).toBe(false);
  });

  it("rejects an empty or non-integer byte size", () => {
    expect(() =>
      validateCaptureInput({ mimeType: "video/webm", byteSize: 0 }),
    ).toThrow(/must contain bytes/);

    expect(() =>
      validateCaptureInput({ mimeType: "video/webm", byteSize: 1.5 }),
    ).toThrow(/must contain bytes/);
  });

  it("rejects a capture over the 250 MB cap", () => {
    expect(() =>
      validateCaptureInput({
        mimeType: "video/webm",
        byteSize: MAX_CAPTURE_BYTES + 1,
      }),
    ).toThrow(/250 MB/);
  });

  it("rejects a duration over the ten minute cap", () => {
    expect(() =>
      validateCaptureInput({
        mimeType: "video/webm",
        byteSize: 10,
        metadata: { durationMs: MAX_DURATION_MS + 1 },
      }),
    ).toThrow(/duration is invalid/);
  });

  it("rejects non-positive dimensions", () => {
    expect(() =>
      validateCaptureInput({
        mimeType: "video/webm",
        byteSize: 10,
        metadata: { width: 0 },
      }),
    ).toThrow(/dimensions are invalid/);
  });
});

describe("sanitizeCaptureMetadata", () => {
  it("keeps positive numeric fields", () => {
    expect(
      sanitizeCaptureMetadata({ durationMs: 1000, width: 640, height: 480 }),
    ).toEqual({ durationMs: 1000, width: 640, height: 480 });
  });

  it("drops absent fields rather than storing null", () => {
    expect(sanitizeCaptureMetadata({ width: null, durationMs: 5 })).toEqual({
      durationMs: 5,
    });
  });

  it("drops non-positive and non-finite numbers", () => {
    expect(
      sanitizeCaptureMetadata({ width: 0, height: -1, frameRate: Number.NaN }),
    ).toBeUndefined();
  });

  it("ignores fields of the wrong type and returns undefined for none left", () => {
    expect(sanitizeCaptureMetadata({ width: "wide" })).toBeUndefined();
    expect(sanitizeCaptureMetadata("not an object")).toBeUndefined();
    expect(sanitizeCaptureMetadata(null)).toBeUndefined();
  });

  it("trims and caps a device label", () => {
    const long = `  ${"x".repeat(200)}  `;
    const result = sanitizeCaptureMetadata({ deviceLabel: long });
    expect(result?.deviceLabel).toHaveLength(120);
  });
});
