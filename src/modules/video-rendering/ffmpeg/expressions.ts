import type {
  MotionEasing,
  MotionProperty,
} from "../../visual-motion-engine/domain/types";
import type { SceneGraphKeyframe } from "../../visual-motion-engine/serialization/scene-graph";

/**
 * A motion track compiled to an FFmpeg expression.
 *
 * `constant` lets the compiler choose a static filter over a per-frame
 * expression: a layer that never moves should not pay for `eval=frame` on every
 * frame of a 4K render.
 */
export type MotionExpression = {
  expression: string;
  constant: boolean;
  value: number;
};

/**
 * FFmpeg's ternary is `if(cond, then, else)` and comparisons are function calls
 * like `lt(a, b)`. `t` is the frame timestamp in seconds in overlay/scale/rotate;
 * `geq` names the same value `T`. Everything here is generated against that one
 * variable name.
 */
const DEFAULT_TIME_VAR = "t";

/** A number rendered so FFmpeg parses it identically to JavaScript. */
export function ffmpegNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot render a non-finite number: ${value}`);
  }
  if (Object.is(value, -0)) return "0";
  if (Number.isInteger(value)) return String(value);
  const fixed = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return fixed.length === 0 ? "0" : fixed;
}

export function easingExpression(
  progress: string,
  easing: MotionEasing,
): string {
  const u = `(${progress})`;

  switch (easing) {
    case "EASE_IN":
      return `${u}*${u}`;
    case "EASE_OUT":
      return `${u}*(2-${u})`;
    case "EASE_IN_OUT":
      return `if(lt(${u},0.5),2*${u}*${u},1-2*(1-${u})*(1-${u}))`;
    case "LINEAR":
    default:
      return u;
  }
}

/**
 * The eased motion delta of one property as a function of time.
 *
 * The generated expression mirrors `sampleTrack` exactly: a keyframe owns the
 * segment from its own start to the next keyframe of the same property (or the
 * end of the composition), the track holds the first keyframe's `fromValue`
 * before it starts and the last keyframe's `toValue` after it ends, and a
 * zero-length segment is a step rather than a divide by zero.
 */
export function keyframesToFfmpegExpr(
  keyframes: readonly SceneGraphKeyframe[],
  durationMs: number,
  timeVar = DEFAULT_TIME_VAR,
): MotionExpression {
  const ordered = [...keyframes].sort((a, b) => {
    if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
    return a.id.localeCompare(b.id);
  });

  if (ordered.length === 0) {
    return { expression: "0", constant: true, value: 0 };
  }

  const first = ordered[0]!;
  const allEqual = ordered.every(
    (keyframe) =>
      keyframe.fromValue === keyframe.toValue &&
      keyframe.fromValue === first.fromValue,
  );

  if (allEqual) {
    return {
      expression: ffmpegNumber(first.fromValue),
      constant: true,
      value: first.fromValue,
    };
  }

  const last = ordered[ordered.length - 1]!;
  const durationSec = Math.max(durationMs, last.timeMs) / 1000;

  let tail = ffmpegNumber(last.toValue);

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const keyframe = ordered[index]!;
    const startSec = keyframe.timeMs / 1000;
    const next = ordered[index + 1];
    const endSec = next ? next.timeMs / 1000 : durationSec;
    const from = ffmpegNumber(keyframe.fromValue);
    const to = ffmpegNumber(keyframe.toValue);

    if (endSec <= startSec) {
      // A zero-length segment is a step: for t >= start it is already `to`.
      const start = ffmpegNumber(startSec);
      tail =
        index === 0
          ? `if(lt(${timeVar},${start}),${from},${to})`
          : `if(lt(${timeVar},${start}),${tail},${to})`;
      continue;
    }

    const progress = `((${timeVar}-${ffmpegNumber(
      startSec,
    )})/${ffmpegNumber(endSec - startSec)})`;
    const eased = easingExpression(progress, keyframe.easing);
    const segment = `(${from}+(${to}-${from})*${eased})`;
    const conditionEnd = ffmpegNumber(endSec);

    if (index === 0) {
      const fromClause = `if(lt(${timeVar},${ffmpegNumber(
        startSec,
      )}),${from},if(lt(${timeVar},${conditionEnd}),${segment},${tail}))`;
      tail = fromClause;
    } else {
      tail = `if(lt(${timeVar},${conditionEnd}),${segment},${tail})`;
    }
  }

  return { expression: tail, constant: false, value: 0 };
}

/**
 * Combines a track delta with the layer's base value using the property's
 * arithmetic: translation and rotation are additive, scale and opacity
 * multiply. This is the same rule `resolveFrame` applies, restated for FFmpeg.
 */
export function applyMotion(
  base: number,
  property: MotionProperty,
  motion: MotionExpression,
): MotionExpression {
  if (motion.constant) {
    const value = combine(base, property, motion.value);
    return { expression: ffmpegNumber(value), constant: true, value };
  }

  const delta = `(${motion.expression})`;
  const expression =
    property === "SCALE" || property === "OPACITY"
      ? `(${ffmpegNumber(base)}*${delta})`
      : `(${ffmpegNumber(base)}+${delta})`;

  return { expression, constant: false, value: base };
}

function combine(base: number, property: MotionProperty, value: number): number {
  if (property === "SCALE" || property === "OPACITY") {
    return base * value;
  }
  return base + value;
}

/** Escapes literal text for the `drawtext` filter's `text=` argument. */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/;/g, "\\;");
}
