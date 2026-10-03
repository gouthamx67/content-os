import type { AudioEasing } from "../domain/types";
import type { DuckInterval } from "../mixing/ducking";
import { ffmpegNumber } from "../../video-rendering/ffmpeg/expressions";

/** The fields an automation point needs to compile to an envelope. */
export type AutomationLike = {
  timeMs: number;
  value: number;
  easing: AudioEasing;
};

/** A compiled gain expression: how loud a track is at time `t` (seconds). */
export type GainExpression = {
  expression: string;
  constant: boolean;
};

const TIME_VAR = "t";

function easingExpr(progress: string, easing: AudioEasing): string {
  const p = `(${progress})`;

  switch (easing) {
    case "LINEAR":
      return p;
    case "EASE_IN":
      return `(${p})*(${p})`;
    case "EASE_OUT":
      return `(1-(1-${p})*(1-${p}))`;
    case "EASE_IN_OUT":
      return `if(lt(${p},0.5),2*${p}*${p},1-pow((-2*${p}+2),2)/2)`;
  }
}

/**
 * Compiles a VOLUME_DB envelope, in seconds, to an FFmpeg expression.
 *
 * Before the first point the first value holds; after the last point the last
 * value holds; between points the curve stored on the right point is used. An
 * empty envelope is the track's static gain, which is what makes the compiled
 * graph identical whether a user drew no automation or drew a flat line.
 */
export function automationDbExpression(
  points: readonly AutomationLike[],
  fallbackDb: number,
): GainExpression {
  if (points.length === 0) {
    return { expression: ffmpegNumber(fallbackDb), constant: true };
  }

  const sorted = points
    .slice()
    .sort((a, b) => a.timeMs - b.timeMs);

  if (sorted.length === 1 || sorted.every((point) => point.value === sorted[0]!.value)) {
    return { expression: ffmpegNumber(sorted[0]!.value), constant: true };
  }

  const seconds = (ms: number) => ffmpegNumber(ms / 1000);

  let expression = ffmpegNumber(sorted[sorted.length - 1]!.value);

  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const from = sorted[index]!;
    const to = sorted[index + 1]!;
    const span = to.timeMs - from.timeMs;

    let segment: string;
    if (span <= 0) {
      segment = ffmpegNumber(to.value);
    } else {
      const progress = `((${TIME_VAR}-${seconds(from.timeMs)})/(${ffmpegNumber(
        span / 1000,
      )}))`;
      const eased = easingExpr(progress, to.easing);
      segment = `(${ffmpegNumber(from.value)}+(${ffmpegNumber(
        to.value - from.value,
      )})*${eased})`;
    }

    expression = `if(lt(${TIME_VAR},${seconds(to.timeMs)}),${segment},${expression})`;
    if (index === 0) {
      expression = `if(lt(${TIME_VAR},${seconds(from.timeMs)}),${ffmpegNumber(
        from.value,
      )},${expression})`;
    }
  }

  return { expression, constant: false };
}

/**
 * Compiles the ducking envelope.
 *
 * `shiftMs` maps composition time onto the track's own post-trim time, because
 * gain is applied before the track is delayed onto the timeline. A track with no
 * voiceovers over it compiles to a constant, which costs nothing.
 */
export function duckDbExpression(
  intervals: readonly DuckInterval[],
  duckDb: number,
  shiftMs: number,
): GainExpression {
  if (intervals.length === 0 || duckDb === 0) {
    return { expression: "0", constant: true };
  }

  const seconds = (ms: number) => ffmpegNumber(ms / 1000);
  let expression = "0";

  for (let index = intervals.length - 1; index >= 0; index -= 1) {
    const interval = intervals[index]!;
    const start = seconds(interval.startMs - shiftMs);
    const end = seconds(interval.endMs - shiftMs);
    expression = `if(between(${TIME_VAR},${start},${end}),${ffmpegNumber(duckDb)},${expression})`;
  }

  return { expression, constant: false };
}

/**
 * The final per-track volume, as a linear multiplier over `t`.
 *
 * Gain is a sum of decibels (static/automated program gain plus ducking), then
 * converted once to a linear factor. Convert-and-multiply would round differently
 * than sum-then-convert, so this keeps the arithmetic in the unit the user set.
 */
export function linearVolumeExpression(
  gain: GainExpression,
  duck: GainExpression,
): GainExpression {
  if (gain.constant && duck.constant) {
    const db = Number(gain.expression) + Number(duck.expression);
    return { expression: ffmpegNumber(10 ** (db / 20)), constant: true };
  }

  const total =
    gain.constant && gain.expression === "0"
      ? duck.expression
      : duck.constant && duck.expression === "0"
        ? gain.expression
        : `((${gain.expression})+(${duck.expression}))`;

  return { expression: `pow(10,(${total})/20)`, constant: false };
}

/** Equal-ish pan that keeps unity at centre: hard left is [1,0], right is [0,1]. */
export function panGains(pan: number): { left: number; right: number } {
  if (pan <= 0) return { left: 1, right: 1 + pan };
  return { left: 1 - pan, right: 1 };
}
