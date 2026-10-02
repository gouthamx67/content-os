import type { MotionEasing, MotionProperty } from "../domain/types";

/**
 * The fields interpolation actually reads.
 *
 * Stored keyframes and the JSON scene graph both satisfy this, which lets one
 * sampler serve the database-backed renderer and the browser preview alike.
 */
export type KeyframeLike = {
  id: string;
  property: MotionProperty;
  timeMs: number;
  fromValue: number;
  toValue: number;
  easing: MotionEasing;
};

/**
 * Eased progress in `[0, 1]`.
 *
 * The curves are the classic CSS-ish quadratics: cheap, monotonic, and defined
 * at both ends so a keyframe boundary never overshoots. Keeping them here means
 * the preview in the browser and the evaluation on the server share one notion
 * of what EASE_IN means.
 */
export function applyEasing(progress: number, easing: MotionEasing): number {
  const t = clamp(progress, 0, 1);

  switch (easing) {
    case "EASE_IN":
      return t * t;
    case "EASE_OUT":
      return t * (2 - t);
    case "EASE_IN_OUT":
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    case "LINEAR":
    default:
      return t;
  }
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

/**
 * The value of one keyframe track at `timeMs`.
 *
 * A keyframe is a segment: it starts at its own `timeMs` and runs to the next
 * keyframe of the same property, or to `trackDurationMs` for the last one.
 * Before the first keyframe the track holds its `fromValue`; after the last it
 * holds its `toValue`. A zero-length segment resolves to `toValue` — a step,
 * not a division by zero.
 */
export function sampleTrack(
  keyframes: readonly KeyframeLike[],
  timeMs: number,
  trackDurationMs: number,
): number | null {
  if (keyframes.length === 0) {
    return null;
  }

  const ordered = orderKeyframes(keyframes);

  if (timeMs <= ordered[0]!.timeMs) {
    return ordered[0]!.fromValue;
  }

  let active = ordered[0]!;

  for (const keyframe of ordered) {
    if (keyframe.timeMs <= timeMs) {
      active = keyframe;
    } else {
      break;
    }
  }

  const index = ordered.indexOf(active);
  const next = ordered[index + 1];
  const segmentEnd = next ? next.timeMs : Math.max(trackDurationMs, active.timeMs);

  if (segmentEnd <= active.timeMs) {
    return active.toValue;
  }

  const progress = (timeMs - active.timeMs) / (segmentEnd - active.timeMs);
  const eased = applyEasing(progress, active.easing);

  return lerp(active.fromValue, active.toValue, eased);
}

/**
 * Sorts a copy by time, then by keyframe id.
 *
 * The id tiebreak keeps two keyframes written in the same millisecond in a
 * stable order regardless of the order Postgres happened to return them, which
 * is what makes frame evaluation reproducible.
 */
export function orderKeyframes<T extends KeyframeLike>(
  keyframes: readonly T[],
): T[] {
  return [...keyframes].sort((a, b) => {
    if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
    return a.id.localeCompare(b.id);
  });
}
