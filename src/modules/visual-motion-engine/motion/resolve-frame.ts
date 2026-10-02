import {
  NEUTRAL_MOTION,
  type MotionEasing,
  type MotionProperty,
  type VisualEffectType,
  type VisualFitMode,
  type VisualLayerType,
} from "../domain/types";
import { clamp, sampleTrack } from "./interpolate";

/**
 * Structural inputs for evaluation.
 *
 * The evaluator only ever reads these fields, so it accepts both the stored
 * record and the JSON scene graph the browser holds. Stating that as a type
 * means the same function can power the preview without a second, drifting
 * interpolation in client code.
 */
export type FrameKeyframeInput = {
  id: string;
  property: MotionProperty;
  timeMs: number;
  fromValue: number;
  toValue: number;
  easing: MotionEasing;
};

export type FrameEffectInput = {
  type: VisualEffectType;
  amount: number;
  enabled: boolean;
};

export type FrameLayerInput = {
  id: string;
  name: string;
  type: VisualLayerType;
  assetRef: string | null;
  textContent: string | null;
  visible: boolean;
  zIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  fit: VisualFitMode;
  cropX: number;
  cropY: number;
  cropWidth: number | null;
  cropHeight: number | null;
  keyframes: readonly FrameKeyframeInput[];
  effects: readonly FrameEffectInput[];
};

export type FrameCompositionInput = {
  id: string;
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
  layers: readonly FrameLayerInput[];
};

export type ResolvedEffect = {
  type: VisualEffectType;
  amount: number;
};

export type ResolvedCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ResolvedLayer = {
  id: string;
  name: string;
  type: VisualLayerType;
  assetRef: string | null;
  textContent: string | null;
  visible: boolean;
  zIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  fit: VisualFitMode;
  crop: ResolvedCrop | null;
  effects: ResolvedEffect[];
};

export type ResolvedFrame = {
  compositionId: string;
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
  timeMs: number;
  layers: ResolvedLayer[];
};

const MOTION_PROPERTIES: readonly MotionProperty[] = [
  "X",
  "Y",
  "SCALE",
  "ROTATION",
  "OPACITY",
];

/**
 * The state of every layer at one instant.
 *
 * Pure and deterministic: it depends only on the composition and `timeMs`, so
 * the same input always yields the same frame. That property is what lets the
 * browser preview and the CP15 renderer share this function and agree on every
 * frame without talking to each other.
 */
export function resolveFrame(
  composition: FrameCompositionInput,
  timeMs: number,
): ResolvedFrame {
  const clampedTime = clamp(timeMs, 0, composition.durationMs);

  const layers = composition.layers
    .map((layer) => resolveLayer(layer, clampedTime, composition.durationMs))
    .sort((a, b) => {
      if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
      return a.id.localeCompare(b.id);
    });

  return {
    compositionId: composition.id,
    width: composition.width,
    height: composition.height,
    frameRate: composition.frameRate,
    durationMs: composition.durationMs,
    timeMs: clampedTime,
    layers,
  };
}

function resolveLayer(
  layer: FrameLayerInput,
  timeMs: number,
  durationMs: number,
): ResolvedLayer {
  const motion = readMotion(layer, timeMs, durationMs);

  return {
    id: layer.id,
    name: layer.name,
    type: layer.type,
    assetRef: layer.assetRef,
    textContent: layer.textContent,
    visible: layer.visible,
    zIndex: layer.zIndex,
    x: layer.x + motion.X,
    y: layer.y + motion.Y,
    width: layer.width * motion.SCALE,
    height: layer.height * motion.SCALE,
    rotation: layer.rotation + motion.ROTATION,
    opacity: clamp(layer.opacity * motion.OPACITY, 0, 1),
    fit: layer.fit,
    crop:
      layer.cropWidth !== null && layer.cropHeight !== null
        ? {
            x: layer.cropX,
            y: layer.cropY,
            width: layer.cropWidth,
            height: layer.cropHeight,
          }
        : null,
    effects: layer.effects
      .filter((effect) => effect.enabled)
      .map((effect) => ({ type: effect.type, amount: effect.amount }))
      .sort((a, b) => a.type.localeCompare(b.type)),
  };
}

function readMotion(
  layer: FrameLayerInput,
  timeMs: number,
  durationMs: number,
): Record<MotionProperty, number> {
  const motion: Record<MotionProperty, number> = { ...NEUTRAL_MOTION };

  for (const property of MOTION_PROPERTIES) {
    const track = layer.keyframes.filter(
      (keyframe) => keyframe.property === property,
    );
    const value = sampleTrack(track, timeMs, durationMs);

    if (value !== null) {
      motion[property] = value;
    }
  }

  return motion;
}
