import { describe, expect, it } from "vitest";
import {
  AudioValidationError,
  MAX_AUDIO_TRACKS,
  sortAutomation,
  validateAudioComposition,
  validateAudioTrackInput,
  validateAutomationInput,
} from "../domain/validation";
import type { AudioAutomationPointRecord } from "../domain/types";

const baseTrack = {
  kind: "MUSIC",
  name: "Bed",
  sourceRef: "asset:a",
  startMs: 0,
  sourceOffsetMs: 0,
  durationMs: 5000,
  gainDb: 0,
  pan: 0,
  fadeInMs: 0,
  fadeOutMs: 0,
  mute: false,
  solo: false,
  duckVoiceoverDb: null,
  compositionDurationMs: 5000,
};

function point(
  id: string,
  timeMs: number,
): AudioAutomationPointRecord {
  return {
    id,
    trackId: "t",
    property: "VOLUME_DB",
    timeMs,
    value: 0,
    easing: "LINEAR",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("validateAudioTrackInput", () => {
  it("accepts a well-formed track", () => {
    expect(() => validateAudioTrackInput(baseTrack)).not.toThrow();
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      validateAudioTrackInput({ ...baseTrack, kind: "PODCAST" }),
    ).toThrow(AudioValidationError);
  });

  it("rejects a non-positive duration", () => {
    expect(() =>
      validateAudioTrackInput({ ...baseTrack, durationMs: 0 }),
    ).toThrow(AudioValidationError);
  });

  it("rejects a track past the end of the composition", () => {
    expect(() =>
      validateAudioTrackInput({
        ...baseTrack,
        startMs: 4000,
        durationMs: 5000,
      }),
    ).toThrow(AudioValidationError);
  });

  it("rejects gain outside the allowed range", () => {
    expect(() =>
      validateAudioTrackInput({ ...baseTrack, gainDb: 40 }),
    ).toThrow(AudioValidationError);
  });

  it("rejects fades longer than the track", () => {
    expect(() =>
      validateAudioTrackInput({
        ...baseTrack,
        fadeInMs: 3000,
        fadeOutMs: 3000,
      }),
    ).toThrow(AudioValidationError);
  });

  it("rejects a positive duck amount", () => {
    expect(() =>
      validateAudioTrackInput({ ...baseTrack, duckVoiceoverDb: 6 }),
    ).toThrow(AudioValidationError);
  });
});

describe("validateAutomationInput", () => {
  it("accepts a point inside the track", () => {
    expect(() =>
      validateAutomationInput({
        property: "VOLUME_DB",
        timeMs: 500,
        value: -6,
        durationMs: 1000,
      }),
    ).not.toThrow();
  });

  it("rejects a point past the track duration", () => {
    expect(() =>
      validateAutomationInput({
        property: "VOLUME_DB",
        timeMs: 2000,
        value: -6,
        durationMs: 1000,
      }),
    ).toThrow(AudioValidationError);
  });

  it("rejects an unsupported property", () => {
    expect(() =>
      validateAutomationInput({
        property: "PAN",
        timeMs: 500,
        value: 0,
        durationMs: 1000,
      }),
    ).toThrow(AudioValidationError);
  });
});

describe("validateAudioComposition", () => {
  it("accepts a normal composition", () => {
    expect(() =>
      validateAudioComposition([{ id: "a" }, { id: "b" }], 5000),
    ).not.toThrow();
  });

  it("rejects duplicate track ids", () => {
    expect(() =>
      validateAudioComposition([{ id: "a" }, { id: "a" }], 5000),
    ).toThrow(AudioValidationError);
  });

  it("rejects more tracks than the limit", () => {
    const tracks = Array.from({ length: MAX_AUDIO_TRACKS + 1 }, (_, index) => ({
      id: `t${index}`,
    }));
    expect(() => validateAudioComposition(tracks, 5000)).toThrow(
      AudioValidationError,
    );
  });

  it("rejects a non-positive duration", () => {
    expect(() => validateAudioComposition([], 0)).toThrow(
      AudioValidationError,
    );
  });
});

describe("sortAutomation", () => {
  it("orders by time then id without mutating the input", () => {
    const input = [point("b", 1000), point("a", 500), point("c", 1000)];
    const sorted = sortAutomation(input);
    expect(sorted.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(input[0]!.id).toBe("b");
  });
});
