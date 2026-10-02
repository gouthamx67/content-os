import { describe, expect, it } from "vitest";
import {
  applyEasing,
  clamp,
  orderKeyframes,
  sampleTrack,
} from "../motion/interpolate";
import type { KeyframeLike } from "../motion/interpolate";

function key(
  id: string,
  timeMs: number,
  fromValue: number,
  toValue: number,
  easing: KeyframeLike["easing"] = "LINEAR",
): KeyframeLike {
  return { id, property: "OPACITY", timeMs, fromValue, toValue, easing };
}

describe("applyEasing", () => {
  it("is defined and monotonic at both ends", () => {
    for (const easing of [
      "LINEAR",
      "EASE_IN",
      "EASE_OUT",
      "EASE_IN_OUT",
    ] as const) {
      expect(applyEasing(0, easing)).toBe(0);
      expect(applyEasing(1, easing)).toBe(1);
    }
  });
});

describe("sampleTrack", () => {
  it("returns null for an empty track", () => {
    expect(sampleTrack([], 10, 1000)).toBeNull();
  });

  it("holds fromValue before the first keyframe and toValue after the last", () => {
    const track = [key("a", 100, 0, 1)];
    expect(sampleTrack(track, 0, 1000)).toBe(0);
    expect(sampleTrack(track, 1000, 1000)).toBe(1);
  });

  it("interpolates linearly across a segment", () => {
    const track = [key("a", 0, 0, 1)];
    expect(sampleTrack(track, 500, 1000)).toBeCloseTo(0.5);
  });

  it("uses the next keyframe as the segment end", () => {
    const track = [key("a", 0, 0, 1), key("b", 500, 1, 0)];
    expect(sampleTrack(track, 250, 1000)).toBeCloseTo(0.5);
    expect(sampleTrack(track, 750, 1000)).toBeCloseTo(0.5);
  });

  it("resolves a zero-length segment to toValue", () => {
    const track = [key("a", 0, 0, 1), key("b", 0, 1, 0)];
    expect(sampleTrack(track, 0, 1000)).toBe(0);
  });

  it("is deterministic when two keyframes share a time", () => {
    const early = orderKeyframes([key("b", 0, 0, 1), key("a", 0, 0, 1)]);
    expect(early.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});

describe("clamp", () => {
  it("bounds and guards NaN", () => {
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
  });
});
