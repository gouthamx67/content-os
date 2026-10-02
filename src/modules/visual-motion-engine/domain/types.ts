/**
 * CP14 visual / motion engine domain.
 *
 * These records are what the repository decodes database rows into and what the
 * services return. They are deliberately independent of the persistence shape:
 * a layer is a transform plus its motion and effects, not a row of columns, so
 * the evaluator can be pure and the renderer contract can be built without
 * knowing anything about Postgres.
 */

export const VISUAL_COMPOSITION_STATUSES = [
  "DRAFT",
  "READY",
  "ARCHIVED",
] as const;
export type VisualCompositionStatus =
  (typeof VISUAL_COMPOSITION_STATUSES)[number];

export const VISUAL_LAYER_TYPES = ["MEDIA", "TEXT", "SHAPE", "GROUP"] as const;
export type VisualLayerType = (typeof VISUAL_LAYER_TYPES)[number];

export const VISUAL_FIT_MODES = ["CONTAIN", "COVER", "STRETCH"] as const;
export type VisualFitMode = (typeof VISUAL_FIT_MODES)[number];

export const VISUAL_EFFECT_TYPES = [
  "BLUR",
  "BRIGHTNESS",
  "CONTRAST",
  "SATURATION",
  "GRAYSCALE",
] as const;
export type VisualEffectType = (typeof VISUAL_EFFECT_TYPES)[number];

export const MOTION_PROPERTIES = [
  "X",
  "Y",
  "SCALE",
  "ROTATION",
  "OPACITY",
] as const;
export type MotionProperty = (typeof MOTION_PROPERTIES)[number];

export const MOTION_EASINGS = [
  "LINEAR",
  "EASE_IN",
  "EASE_OUT",
  "EASE_IN_OUT",
] as const;
export type MotionEasing = (typeof MOTION_EASINGS)[number];

export type VisualEffectRecord = {
  id: string;
  layerId: string;
  type: VisualEffectType;
  amount: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MotionKeyframeRecord = {
  id: string;
  layerId: string;
  property: MotionProperty;
  timeMs: number;
  fromValue: number;
  toValue: number;
  easing: MotionEasing;
  createdAt: string;
};

export type VisualLayerRecord = {
  id: string;
  compositionId: string;
  name: string;
  type: VisualLayerType;
  assetRef: string | null;
  textContent: string | null;
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
  zIndex: number;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
  keyframes: MotionKeyframeRecord[];
  effects: VisualEffectRecord[];
};

export type VisualCompositionRecord = {
  id: string;
  projectId: string;
  shotId: string | null;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
  status: VisualCompositionStatus;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  layers: VisualLayerRecord[];
};

/**
 * The neutral transform contribution of each motion property when a layer has
 * no keyframes for it: a layer at rest is not moved, not scaled, not rotated and
 * fully opaque.
 */
export const NEUTRAL_MOTION: Readonly<Record<MotionProperty, number>> = {
  X: 0,
  Y: 0,
  SCALE: 1,
  ROTATION: 0,
  OPACITY: 1,
};
