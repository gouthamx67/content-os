import type { VisualFitMode } from "../domain/types";

export type FittedRect = {
  /** Rendered box, in composition pixels. */
  width: number;
  height: number;
  /** Top-left of the rendered content inside the requested box. */
  offsetX: number;
  offsetY: number;
  /** Uniform scale applied to the source, `1` for STRETCH. */
  scale: number;
};

/**
 * Places a source of `sourceWidth × sourceHeight` inside `boxWidth × boxHeight`.
 *
 * Pure and total: a zero-sized source or box has no meaningful scale, so it
 * degrades to an empty rect at the box origin rather than producing Infinity or
 * NaN that would poison every downstream transform.
 */
export function fitRect(input: {
  sourceWidth: number;
  sourceHeight: number;
  boxWidth: number;
  boxHeight: number;
  mode: VisualFitMode;
}): FittedRect {
  const { sourceWidth, sourceHeight, boxWidth, boxHeight, mode } = input;

  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    boxWidth <= 0 ||
    boxHeight <= 0
  ) {
    return {
      width: Math.max(0, boxWidth),
      height: Math.max(0, boxHeight),
      offsetX: 0,
      offsetY: 0,
      scale: 0,
    };
  }

  if (mode === "STRETCH") {
    return {
      width: boxWidth,
      height: boxHeight,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
    };
  }

  const scaleX = boxWidth / sourceWidth;
  const scaleY = boxHeight / sourceHeight;
  const scale = mode === "COVER" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    width,
    height,
    offsetX: (boxWidth - width) / 2,
    offsetY: (boxHeight - height) / 2,
    scale,
  };
}
