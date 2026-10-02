import type {
  MotionEasing,
  MotionProperty,
  VisualCompositionRecord,
  VisualEffectType,
  VisualFitMode,
  VisualLayerType,
} from "../domain/types";

/**
 * Canonical, JSON-safe view of a composition.
 *
 * Records are already plain objects, but routing every response through this
 * module means the API surface is a deliberate decision rather than "whatever
 * the row happened to contain": when a persistence-only field is added later it
 * does not silently appear in a response.
 */
export type SceneGraphKeyframe = {
  id: string;
  property: MotionProperty;
  timeMs: number;
  fromValue: number;
  toValue: number;
  easing: MotionEasing;
};

export type SceneGraphEffect = {
  id: string;
  type: VisualEffectType;
  amount: number;
  enabled: boolean;
};

export type SceneGraphLayer = {
  id: string;
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
  keyframes: SceneGraphKeyframe[];
  effects: SceneGraphEffect[];
};

export type SceneGraph = {
  id: string;
  projectId: string;
  shotId: string | null;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
  status: VisualCompositionRecord["status"];
  createdById: string;
  createdAt: string;
  updatedAt: string;
  layers: SceneGraphLayer[];
};

export function buildSceneGraph(
  composition: VisualCompositionRecord,
): SceneGraph {
  return {
    id: composition.id,
    projectId: composition.projectId,
    shotId: composition.shotId,
    name: composition.name,
    width: composition.width,
    height: composition.height,
    frameRate: composition.frameRate,
    durationMs: composition.durationMs,
    status: composition.status,
    createdById: composition.createdById,
    createdAt: composition.createdAt,
    updatedAt: composition.updatedAt,
    layers: composition.layers
      .slice()
      .sort((a, b) => {
        if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
        return a.id.localeCompare(b.id);
      })
      .map((layer) => ({
        id: layer.id,
        name: layer.name,
        type: layer.type,
        assetRef: layer.assetRef,
        textContent: layer.textContent,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        rotation: layer.rotation,
        opacity: layer.opacity,
        fit: layer.fit,
        cropX: layer.cropX,
        cropY: layer.cropY,
        cropWidth: layer.cropWidth,
        cropHeight: layer.cropHeight,
        zIndex: layer.zIndex,
        visible: layer.visible,
        keyframes: layer.keyframes
          .slice()
          .sort((a, b) => {
            if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
            return a.id.localeCompare(b.id);
          })
          .map((keyframe) => ({
            id: keyframe.id,
            property: keyframe.property,
            timeMs: keyframe.timeMs,
            fromValue: keyframe.fromValue,
            toValue: keyframe.toValue,
            easing: keyframe.easing,
          })),
        effects: layer.effects
          .slice()
          .sort((a, b) => a.type.localeCompare(b.type))
          .map((effect) => ({
            id: effect.id,
            type: effect.type,
            amount: effect.amount,
            enabled: effect.enabled,
          })),
      })),
  };
}

export function serializeComposition(
  composition: VisualCompositionRecord,
): SceneGraph {
  return buildSceneGraph(composition);
}
