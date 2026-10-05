import { describe, expect, it } from "vitest";
import { stripHype, toneDirective } from "./tone";
import { WRITING_TONES } from "../domain/types";

describe("tone", () => {
  it("gives every tone a directive", () => {
    for (const tone of WRITING_TONES) {
      expect(toneDirective(tone).length).toBeGreaterThan(0);
    }
  });

  it("strips the loudest hype regardless of tone", () => {
    const text = "A revolutionary, game-changing and world-class platform.";
    const stripped = stripHype(text);
    expect(stripped.toLowerCase()).not.toContain("revolutionary");
    expect(stripped.toLowerCase()).not.toContain("game-changing");
    expect(stripped.toLowerCase()).not.toContain("world-class");
  });
});
