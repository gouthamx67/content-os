import { describe, expect, it } from "vitest";
import {
  MOTION_PRESET_IDS,
  MOTION_PRESETS,
  isMotionPresetId,
} from "../presets";
import { buildPresetKeyframes } from "../presets/apply-preset";

describe("motion presets", () => {
  it("documents every preset id", () => {
    for (const id of MOTION_PRESET_IDS) {
      expect(MOTION_PRESETS[id].id).toBe(id);
    }
  });

  it("recognises only known ids", () => {
    expect(isMotionPresetId("FADE_IN")).toBe(true);
    expect(isMotionPresetId("WOBBLE")).toBe(false);
    expect(isMotionPresetId(42)).toBe(false);
  });

  it("expands every preset to keyframes within the duration", () => {
    for (const id of MOTION_PRESET_IDS) {
      const keyframes = buildPresetKeyframes(id, 1000);
      expect(keyframes.length).toBeGreaterThan(0);

      for (const keyframe of keyframes) {
        expect(keyframe.timeMs).toBeGreaterThanOrEqual(0);
        expect(keyframe.timeMs).toBeLessThanOrEqual(1000);
      }
    }
  });

  it("gives PULSE two opacity segments", () => {
    const keyframes = buildPresetKeyframes("PULSE", 1000);
    expect(keyframes).toHaveLength(2);
    expect(keyframes[0]!.timeMs).toBe(0);
    expect(keyframes[1]!.timeMs).toBe(500);
  });

  it("never divides by a zero duration", () => {
    const keyframes = buildPresetKeyframes("FADE_OUT", 0);
    expect(keyframes[0]!.timeMs).toBeGreaterThanOrEqual(0);
  });
});
