import type {
  MotionEasing,
  MotionProperty,
  VisualCompositionRecord,
  VisualEffectRecord,
  VisualEffectType,
  VisualFitMode,
  VisualLayerRecord,
  VisualLayerType,
  MotionKeyframeRecord,
} from "../../modules/visual-motion-engine/domain/types";

export type CreateCompositionInput = {
  id: string;
  projectId: string;
  shotId: string | null;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

export type UpdateCompositionInput = Partial<{
  name: string;
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
  shotId: string | null;
  status: VisualCompositionRecord["status"];
  updatedAt: string;
}>;

export type CreateLayerInput = {
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
};

export type UpdateLayerInput = Partial<
  Omit<CreateLayerInput, "id" | "compositionId" | "createdAt">
> & { updatedAt: string };

export type UpsertKeyframeInput = {
  id: string;
  layerId: string;
  property: MotionProperty;
  timeMs: number;
  fromValue: number;
  toValue: number;
  easing: MotionEasing;
  createdAt: string;
};

export type UpsertEffectInput = {
  id: string;
  layerId: string;
  type: VisualEffectType;
  amount: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * Project scope is a required argument on every method, never remembered by the
 * caller. A composition id is only meaningful inside a project, so a method
 * taking a bare id would make cross-project access a question of discipline
 * instead of something the type system refuses.
 */
export interface VisualRepository {
  createComposition(
    input: CreateCompositionInput,
  ): Promise<VisualCompositionRecord>;

  getComposition(
    projectId: string,
    compositionId: string,
  ): Promise<VisualCompositionRecord | null>;

  listCompositions(projectId: string): Promise<VisualCompositionRecord[]>;

  updateComposition(
    projectId: string,
    compositionId: string,
    changes: UpdateCompositionInput,
  ): Promise<VisualCompositionRecord>;

  deleteComposition(projectId: string, compositionId: string): Promise<void>;

  createLayer(input: CreateLayerInput): Promise<VisualLayerRecord>;

  getLayer(
    projectId: string,
    compositionId: string,
    layerId: string,
  ): Promise<VisualLayerRecord | null>;

  updateLayer(
    projectId: string,
    compositionId: string,
    layerId: string,
    changes: UpdateLayerInput,
  ): Promise<VisualLayerRecord>;

  deleteLayer(
    projectId: string,
    compositionId: string,
    layerId: string,
  ): Promise<void>;

  listKeyframes(
    projectId: string,
    compositionId: string,
    layerId: string,
  ): Promise<MotionKeyframeRecord[]>;

  upsertKeyframe(input: UpsertKeyframeInput): Promise<MotionKeyframeRecord>;

  deleteKeyframe(
    projectId: string,
    compositionId: string,
    layerId: string,
    keyframeId: string,
  ): Promise<void>;

  listEffects(
    projectId: string,
    compositionId: string,
    layerId: string,
  ): Promise<VisualEffectRecord[]>;

  upsertEffect(input: UpsertEffectInput): Promise<VisualEffectRecord>;

  deleteEffect(
    projectId: string,
    compositionId: string,
    layerId: string,
    effectId: string,
  ): Promise<void>;
}
