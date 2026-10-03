import { describe, expect, it } from "vitest";
import {
  buildVoiceoverDuckIntervals,
  isDuckedAt,
  resolveAudibleTracks,
} from "../mixing/ducking";

type TrackLike = {
  kind: "VOICEOVER" | "MUSIC" | "SFX" | "AMBIENCE";
  startMs: number;
  durationMs: number;
  mute: boolean;
  solo: boolean;
};

function track(overrides: Partial<TrackLike> = {}): TrackLike {
  return {
    kind: "VOICEOVER",
    startMs: 0,
    durationMs: 1000,
    mute: false,
    solo: false,
    ...overrides,
  };
}

describe("buildVoiceoverDuckIntervals", () => {
  it("maps only unmuted voiceovers to spans", () => {
    const intervals = buildVoiceoverDuckIntervals([
      track({ startMs: 1000, durationMs: 2000 }),
      track({ kind: "MUSIC", startMs: 0, durationMs: 5000 }),
      track({ startMs: 0, durationMs: 500, mute: true }),
    ]);

    expect(intervals).toEqual([{ startMs: 1000, endMs: 3000 }]);
  });

  it("merges overlapping voiceovers into one span", () => {
    const intervals = buildVoiceoverDuckIntervals([
      track({ startMs: 0, durationMs: 2000 }),
      track({ startMs: 1000, durationMs: 3000 }),
      track({ startMs: 8000, durationMs: 1000 }),
    ]);

    expect(intervals).toEqual([
      { startMs: 0, endMs: 4000 },
      { startMs: 8000, endMs: 9000 },
    ]);
  });

  it("keeps adjacent spans separate when they only touch", () => {
    const intervals = buildVoiceoverDuckIntervals([
      track({ startMs: 0, durationMs: 1000 }),
      track({ startMs: 2000, durationMs: 1000 }),
    ]);

    expect(intervals).toEqual([
      { startMs: 0, endMs: 1000 },
      { startMs: 2000, endMs: 3000 },
    ]);
  });
});

describe("isDuckedAt", () => {
  it("includes the start and excludes the end", () => {
    const intervals = [{ startMs: 1000, endMs: 3000 }];
    expect(isDuckedAt(intervals, 999)).toBe(false);
    expect(isDuckedAt(intervals, 1000)).toBe(true);
    expect(isDuckedAt(intervals, 2999)).toBe(true);
    expect(isDuckedAt(intervals, 3000)).toBe(false);
  });
});

describe("resolveAudibleTracks", () => {
  it("drops muted tracks", () => {
    const result = resolveAudibleTracks([
      track({ mute: true }),
      track({ kind: "MUSIC" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe("MUSIC");
  });

  it("keeps everything when nothing is soloed", () => {
    expect(resolveAudibleTracks([track(), track()])).toHaveLength(2);
  });

  it("keeps only soloed tracks when one is soloed", () => {
    const result = resolveAudibleTracks([
      track({ solo: true }),
      track({ kind: "MUSIC" }),
    ]);
    expect(result).toHaveLength(1);
  });

  it("ignores a muted solo track", () => {
    const result = resolveAudibleTracks([
      track({ solo: true, mute: true }),
      track({ kind: "MUSIC" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe("MUSIC");
  });
});
