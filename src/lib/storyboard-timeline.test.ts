import { describe, expect, it } from "vitest";
import {
  buildStoryboardTimeline,
  distributeSceneDurations,
  formatDuration,
  MIN_SCENE_DURATION_MS,
  timelineTotal,
  TimelineError,
} from "./storyboard-timeline";

/** A range of durations a person would plausibly ask for. */
const DURATIONS = [
  5_000, 8_000, 15_000, 21_400, 30_000, 45_000, 60_000, 75_000, 90_000,
  120_000, 125_000, 180_000, 214_000, 300_000,
];

describe("distributeSceneDurations", () => {
  it("sums to the whole in every case, which is the whole point of it", () => {
    for (const total of DURATIONS) {
      for (const count of [3, 5, 7, 8, 12]) {
        const durations = distributeSceneDurations(total, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].slice(0, count), count);
        expect(durations.reduce((sum, value) => sum + value, 0)).toBe(total);
      }
    }
  });

  it("keeps every scene at least a millisecond long", () => {
    for (const total of DURATIONS) {
      for (const count of [3, 5, 7, 8, 12]) {
        const durations = distributeSceneDurations(total, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].slice(0, count), count);
        expect(Math.min(...durations)).toBeGreaterThanOrEqual(MIN_SCENE_DURATION_MS);
      }
    }
  });

  it("splits evenly when nothing is weighted", () => {
    expect(distributeSceneDurations(9_000, [1, 1, 1], 3)).toEqual([3_000, 3_000, 3_000]);
  });

  it("gives a heavier scene more time, and never a millisecond from a light one", () => {
    expect(distributeSceneDurations(10_000, [1, 3, 1], 3)).toEqual([2_000, 6_000, 2_000]);
  });

  it("is stable: the same input gives the same split, so a plan can be reviewed", () => {
    const first = distributeSceneDurations(12_345, [1, 2, 4, 8, 16, 3, 7, 11], 8);
    const second = distributeSceneDurations(12_345, [1, 2, 4, 8, 16, 3, 7, 11], 8);
    expect(first).toEqual(second);
  });

  it("refuses to divide a duration into more scenes than it can carry", () => {
    // The honest answer here is an error. A zero-length scene is not a scene,
    // and quietly emitting one hides the real problem.
    expect(() => distributeSceneDurations(4, [1, 1, 1, 1, 1, 1], 6)).toThrow(TimelineError);
  });

  it("rejects a negative or fractional target", () => {
    expect(() => distributeSceneDurations(-1, [1, 1], 2)).toThrow(TimelineError);
    expect(() => distributeSceneDurations(1_000.5, [1, 1], 2)).toThrow(TimelineError);
  });
});

describe("buildStoryboardTimeline", () => {
  it("covers the target exactly, with no gap and no overlap", () => {
    for (const total of DURATIONS) {
      const count = total > 8_000 ? 8 : 5;
      const segments = buildStoryboardTimeline(
        total,
        Array.from({ length: count }, (_, index) => ({ id: `s${index}`, weight: 1 + index })),
      );

      expect(segments[0].startMs).toBe(0);
      expect(timelineTotal(segments)).toBe(total);
      for (let index = 1; index < segments.length; index += 1) {
        expect(segments[index].startMs).toBe(segments[index - 1].endMs);
      }
      for (const segment of segments) {
        expect(segment.endMs - segment.startMs).toBe(segment.durationMs);
        expect(segment.durationMs).toBeGreaterThanOrEqual(MIN_SCENE_DURATION_MS);
      }
    }
  });

  it("honours a pinned duration and shares out the rest", () => {
    const segments = buildStoryboardTimeline(20_000, [
      { id: "hook", durationMs: 5_000 },
      { id: "body", weight: 3 },
      { id: "cta", weight: 1 },
    ]);

    expect(segments[0]).toEqual({ id: "hook", startMs: 0, endMs: 5_000, durationMs: 5_000 });
    expect(segments[1].durationMs + segments[2].durationMs).toBe(15_000);
    expect(timelineTotal(segments)).toBe(20_000);
  });

  it("refuses a pin longer than the piece, because that is a decision to make, not to make quietly", () => {
    expect(() =>
      buildStoryboardTimeline(5_000, [
        { id: "a", durationMs: 4_000 },
        { id: "b", durationMs: 4_000 },
      ]),
    ).toThrow(TimelineError);
  });

  it("refuses a pinned scene shorter than a millisecond", () => {
    expect(() => buildStoryboardTimeline(5_000, [{ id: "a", durationMs: 0 }])).toThrow(TimelineError);
  });

  it("returns nothing for an empty plan rather than throwing", () => {
    expect(buildStoryboardTimeline(10_000, [])).toEqual([]);
    expect(timelineTotal([])).toBe(0);
  });
});

describe("formatDuration", () => {
  it("reads in seconds below a minute and as a clock above it", () => {
    expect(formatDuration(8_000)).toBe("8.0s");
    expect(formatDuration(21_400)).toBe("21.4s");
    expect(formatDuration(60_000)).toBe("1:00.0");
    expect(formatDuration(125_000)).toBe("2:05.0");
  });
});
