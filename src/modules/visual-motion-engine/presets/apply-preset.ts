import type { MotionEasing, MotionProperty } from "../domain/types";
import type { MotionPresetId } from "../presets";

export type PresetKeyframe = {
  property: MotionProperty;
  timeMs: number;
  fromValue: number;
  toValue: number;
  easing: MotionEasing;
};

/**
 * Expands a preset into concrete keyframes against a duration.
 *
 * Every preset animates the opening fraction of the composition and leaves the
 * rest at rest, except the loops/resets that need two segments. Times are
 * rounded to whole milliseconds because that is the storage resolution.
 */
export function buildPresetKeyframes(
  presetId: MotionPresetId,
  durationMs: number,
): PresetKeyframe[] {
  const duration = Math.max(1, Math.round(durationMs));
  const at = (fraction: number) => Math.round(duration * fraction);

  switch (presetId) {
    case "FADE_IN":
      return [
        {
          property: "OPACITY",
          timeMs: 0,
          fromValue: 0,
          toValue: 1,
          easing: "EASE_OUT",
        },
      ];
    case "FADE_OUT":
      return [
        {
          property: "OPACITY",
          timeMs: at(0.5),
          fromValue: 1,
          toValue: 0,
          easing: "EASE_IN",
        },
      ];
    case "SLIDE_UP":
      return [
        {
          property: "Y",
          timeMs: 0,
          fromValue: 160,
          toValue: 0,
          easing: "EASE_OUT",
        },
      ];
    case "SLIDE_LEFT":
      return [
        {
          property: "X",
          timeMs: 0,
          fromValue: 160,
          toValue: 0,
          easing: "EASE_OUT",
        },
      ];
    case "ZOOM_IN":
      return [
        {
          property: "SCALE",
          timeMs: 0,
          fromValue: 1,
          toValue: 1.2,
          easing: "EASE_IN_OUT",
        },
      ];
    case "PULSE":
      return [
        {
          property: "OPACITY",
          timeMs: 0,
          fromValue: 1,
          toValue: 0.5,
          easing: "EASE_IN_OUT",
        },
        {
          property: "OPACITY",
          timeMs: at(0.5),
          fromValue: 0.5,
          toValue: 1,
          easing: "EASE_IN_OUT",
        },
      ];
    case "KEN_BURNS":
      return [
        {
          property: "SCALE",
          timeMs: 0,
          fromValue: 1,
          toValue: 1.15,
          easing: "LINEAR",
        },
        {
          property: "X",
          timeMs: 0,
          fromValue: 0,
          toValue: -24,
          easing: "LINEAR",
        },
        {
          property: "Y",
          timeMs: 0,
          fromValue: 0,
          toValue: -18,
          easing: "LINEAR",
        },
      ];
  }
}
