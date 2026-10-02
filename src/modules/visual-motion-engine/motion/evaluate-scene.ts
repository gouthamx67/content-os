import {
  resolveFrame,
  type FrameCompositionInput,
  type ResolvedFrame,
  type ResolvedLayer,
} from "./resolve-frame";

/**
 * The single entry point both the preview and the renderer contract call.
 *
 * It exists so "which frame is this?" is answered in exactly one place. If the
 * preview and the renderer each interpolated keyframes themselves, a rounding
 * difference would show up as a preview that does not match the export, and
 * nobody would know which of the two was wrong.
 */
export function evaluateScene(
  composition: FrameCompositionInput,
  timeMs: number,
): ResolvedFrame {
  return resolveFrame(composition, timeMs);
}

/**
 * The frame timestamps of a composition, inclusive of both ends.
 *
 * A 1000 ms composition at 10 fps has frames at 0…1000 in 100 ms steps (11
 * frames); the final frame is included so the last keyframe is actually seen.
 */
export function frameTimes(composition: FrameCompositionInput): number[] {
  const duration = Math.max(0, composition.durationMs);
  const step = 1000 / composition.frameRate;
  const frames: number[] = [];

  for (let time = 0; time < duration; time += step) {
    frames.push(Math.round(time));
  }

  frames.push(duration);

  return frames;
}

export function findLayerFrame(
  frame: ResolvedFrame,
  layerId: string,
): ResolvedLayer | null {
  return frame.layers.find((layer) => layer.id === layerId) ?? null;
}
