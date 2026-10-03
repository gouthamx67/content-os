import { resolveFrame, type FrameLayerInput } from "../motion/resolve-frame";

/**
 * A layer's resolved box at one instant.
 *
 * This is the shared geometry authority: the browser preview and the FFmpeg
 * compiler both derive positions from the same evaluation. `resolveFrame` does
 * the interpolation; this just names the fields a layout cares about, so a
 * consistency test can compare renderer output against preview output without
 * knowing the shape of either.
 */
export type LayerGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  crop: { x: number; y: number; width: number; height: number } | null;
};

export function resolveLayerGeometry(
  layer: FrameLayerInput,
  timeMs: number,
  durationMs: number,
): LayerGeometry {
  const frame = resolveFrame(
    {
      id: "geometry",
      width: 0,
      height: 0,
      frameRate: 1,
      durationMs,
      layers: [layer],
    },
    timeMs,
  );

  const resolved = frame.layers[0];

  if (!resolved) {
    return {
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      rotation: layer.rotation,
      opacity: layer.opacity,
      crop: null,
    };
  }

  return {
    x: resolved.x,
    y: resolved.y,
    width: resolved.width,
    height: resolved.height,
    rotation: resolved.rotation,
    opacity: resolved.opacity,
    crop: resolved.crop,
  };
}
