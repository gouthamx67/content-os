import { describe, expect, it } from "vitest";
import {
  easingProgress,
  interpolateAutomation,
} from "../motion/interpolate-audio";
import type { AudioAutomationPointRecord } from "../domain/types";

function point(
  id: string,
  timeMs: number,
  value: number,
  easing: AudioAutomationPointRecord["easing"] = "LINEAR",
): AudioAutomationPointRecord {
  return {
    id,
    trackId: "track",
    property: "VOLUME_DB",
    timeMs,
    value,
    easing,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("easingProgress", () => {
  it("is pinned at both ends for every easing", () => {
    for (const easing of [
      "LINEAR",
      "EASE_IN",
      "EASE_OUT",
      "EASE_IN_OUT",
    ] as const) {
      expect(easingProgress(easing, 0)).toBe(0);
      expect(easingProgress(easing, 1)).toBe(1);
    }
  });

  it("clamps progress outside 0..1", () => {
    expect(easingProgress("LINEAR", -1)).toBe(0);
    expect(easingProgress("LINEAR", 2)).toBe(1);
  });

  it("is symmetric at the midpoint for EASE_IN_OUT", () => {
    expect(easingProgress("EASE_IN_OUT", 0.5)).toBeCloseTo(0.5, 10);
  });
});

describe("interpolateAutomation", () => {
  it("returns the fallback for an empty envelope", () => {
    expect(interpolateAutomation([], 500, -6)).toBe(-6);
  });

  it("holds the first value before the first point", () => {
    const points = [point("a", 1000, -3), point("b", 3000, 0)];
    expect(interpolateAutomation(points, 0, -12)).toBe(-3);
  });

  it("holds the last value after the last point", () => {
    const points = [point("a", 1000, -3), point("b", 3000, 0)];
    expect(interpolateAutomation(points, 9000, -12)).toBe(0);
  });

  it("interpolates linearly between points", () => {
    const points = [point("a", 0, -20), point("b", 1000, 0)];
    expect(interpolateAutomation(points, 500, 0)).toBeCloseTo(-10, 10);
  });

  it("uses the easing stored on the right-hand point", () => {
    const points = [
      point("a", 0, 0),
      point("b", 1000, 100, "EASE_IN"),
    ];
    // EASE_IN at p=0.5 is 0.25, so 0 + 100*0.25.
    expect(interpolateAutomation(points, 500, 0)).toBeCloseTo(25, 10);
  });

  it("sorts unordered points before evaluating", () => {
    const points = [point("b", 1000, 0), point("a", 0, -20)];
    expect(interpolateAutomation(points, 500, 0)).toBeCloseTo(-10, 10);
  });
});
