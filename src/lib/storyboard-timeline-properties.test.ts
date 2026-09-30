import { describe, expect, it } from "vitest";
import { distributeSceneDurations } from "./storyboard-timeline";

describe("distributeSceneDurations across many shapes", () => {
  const durations = [3_000, 4_500, 5_000, 7_200, 8_000, 9_000, 12_000, 15_000, 20_000];
  const counts = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  it("always sums to the total and never drops below a millisecond", () => {
    for (const total of durations) {
      for (const count of counts) {
        if (total < count) continue;
        const weights = Array.from({ length: count }, (_, index) => 1 + ((index * 7) % 5));
        const split = distributeSceneDurations(total, weights, count);

        expect(split.reduce((sum, value) => sum + value, 0)).toBe(total);
        expect(Math.min(...split)).toBeGreaterThanOrEqual(1);
        expect(split.every(Number.isInteger)).toBe(true);
      }
    }
  });

  it("preserves the requested proportions within a millisecond per scene", () => {
    for (const total of durations) {
      for (const count of counts) {
        if (total < count * 4) continue;
        const weights = Array.from({ length: count }, (_, index) => 1 + ((index * 3) % 4));
        const split = distributeSceneDurations(total, weights, count);
        const weightTotal = weights.reduce((sum, value) => sum + value, 0);

        weights.forEach((weight, index) => {
          const expected = (total * weight) / weightTotal;
          expect(Math.abs(split[index] - expected)).toBeLessThanOrEqual(1);
        });
      }
    }
  });
});
