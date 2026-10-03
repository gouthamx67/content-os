import type {
  AudioAutomationPointRecord,
  AudioEasing,
} from "../domain/types";

/**
 * Easing curves, expressed as a normalised progress transform.
 *
 * The same four names appear on visual motion keyframes, so the curves are
 * identical; only the value domain differs (decibels instead of pixels).
 */
export function easingProgress(easing: AudioEasing, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));

  switch (easing) {
    case "LINEAR":
      return p;
    case "EASE_IN":
      return p * p;
    case "EASE_OUT":
      return 1 - (1 - p) * (1 - p);
    case "EASE_IN_OUT":
      return p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
  }
}

/**
 * Evaluates a track's automation envelope at a point in time.
 *
 * Before the first point the first value holds; after the last point the last
 * value holds. Between two points the value is interpolated with the easing
 * stored on the *right* point, so the curve leading into a point is the curve
 * the editor chose for it. An empty envelope falls back to the track's static
 * gain.
 */
export function interpolateAutomation(
  points: readonly AudioAutomationPointRecord[],
  timeMs: number,
  fallbackDb: number,
): number {
  if (points.length === 0) return fallbackDb;

  const sorted = points
    .slice()
    .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));

  const first = sorted[0]!;
  if (timeMs <= first.timeMs) return first.value;

  const last = sorted[sorted.length - 1]!;
  if (timeMs >= last.timeMs) return last.value;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const from = sorted[index]!;
    const to = sorted[index + 1]!;

    if (timeMs >= from.timeMs && timeMs <= to.timeMs) {
      const span = to.timeMs - from.timeMs;
      if (span <= 0) return to.value;
      const progress = easingProgress(to.easing, (timeMs - from.timeMs) / span);
      return from.value + (to.value - from.value) * progress;
    }
  }

  return last.value;
}
