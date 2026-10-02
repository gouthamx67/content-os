import { createId } from "../../lib/id";
import { HttpError } from "../../lib/http";
import type { VisualRepository } from "../../core/ports/visual-repository";
import type {
  MotionEasing,
  MotionProperty,
  VisualCompositionRecord,
  VisualEffectType,
  VisualFitMode,
  VisualLayerRecord,
  VisualLayerType,
} from "./domain/types";
import {
  isMotionEasing,
  isMotionProperty,
  isVisualEffectType,
  isVisualFitMode,
  isVisualLayerType,
  validateEffectAmount,
  validateKeyframeInput,
  validateLayerInput,
} from "./domain/validation";
import { resolveAssetRef } from "./integrations/capture-take";
import { buildPresetKeyframes } from "./presets/apply-preset";
import { isMotionPresetId, type MotionPresetId } from "./presets";

export type VisualLayerServiceDeps = {
  repository: VisualRepository;
  authorizeProject: (projectId: string, userId: string) => Promise<void>;
};

export type AddLayerArgs = {
  projectId: string;
  compositionId: string;
  userId: string;
  name?: string | null;
  type: VisualLayerType;
  assetRef?: string | null;
  textContent?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  fit?: VisualFitMode;
  cropX?: number;
  cropY?: number;
  cropWidth?: number | null;
  cropHeight?: number | null;
  zIndex?: number;
  visible?: boolean;
};

export type UpdateLayerArgs = {
  projectId: string;
  compositionId: string;
  layerId: string;
  userId: string;
  changes: Partial<{
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    opacity: number;
    fit: VisualFitMode;
    textContent: string | null;
    cropX: number;
    cropY: number;
    cropWidth: number | null;
    cropHeight: number | null;
    zIndex: number;
    visible: boolean;
  }>;
};

export class VisualLayerService {
  private readonly repository: VisualRepository;
  private readonly authorizeProject: VisualLayerServiceDeps["authorizeProject"];

  constructor(deps: VisualLayerServiceDeps) {
    this.repository = deps.repository;
    this.authorizeProject = deps.authorizeProject;
  }

  async addLayer(args: AddLayerArgs): Promise<VisualLayerRecord> {
    await this.authorizeProject(args.projectId, args.userId);
    const composition = await this.requireComposition(
      args.projectId,
      args.compositionId,
    );

    if (!isVisualLayerType(args.type)) {
      throw new HttpError(400, "Invalid layer type");
    }

    let assetRef: string | null = null;

    if (args.type === "MEDIA") {
      if (!args.assetRef) {
        throw new HttpError(400, "A media layer requires an assetRef");
      }

      // Resolving proves the take or asset exists in *this* project; the
      // canonical ref it returns is what gets stored.
      assetRef = (await resolveAssetRef(args.projectId, args.assetRef)).ref;
    }

    const fit = args.fit ?? "CONTAIN";
    if (!isVisualFitMode(fit)) {
      throw new HttpError(400, "Invalid fit mode");
    }

    const input = {
      type: args.type,
      assetRef,
      textContent: args.textContent ?? null,
      width: args.width ?? composition.width,
      height: args.height ?? composition.height,
      opacity: args.opacity ?? 1,
      rotation: args.rotation ?? 0,
      zIndex: args.zIndex ?? (await this.nextZIndex(composition)),
      cropX: args.cropX ?? 0,
      cropY: args.cropY ?? 0,
      cropWidth: args.cropWidth ?? null,
      cropHeight: args.cropHeight ?? null,
    };

    validateLayerInput(input);

    const now = new Date().toISOString();

    return this.repository.createLayer({
      id: createId("vlay"),
      compositionId: composition.id,
      name: (args.name ?? "").trim() || labelForType(args.type),
      type: input.type,
      assetRef: input.assetRef,
      textContent: input.textContent,
      x: args.x ?? 0,
      y: args.y ?? 0,
      width: input.width,
      height: input.height,
      rotation: input.rotation,
      opacity: input.opacity,
      fit,
      cropX: input.cropX,
      cropY: input.cropY,
      cropWidth: input.cropWidth,
      cropHeight: input.cropHeight,
      zIndex: input.zIndex,
      visible: args.visible ?? true,
      createdAt: now,
      updatedAt: now,
    });
  }

  async updateLayer(args: UpdateLayerArgs): Promise<VisualLayerRecord> {
    await this.authorizeProject(args.projectId, args.userId);
    const existing = await this.requireLayer(
      args.projectId,
      args.compositionId,
      args.layerId,
    );

    if (args.changes.fit !== undefined && !isVisualFitMode(args.changes.fit)) {
      throw new HttpError(400, "Invalid fit mode");
    }

    const merged = {
      type: existing.type,
      assetRef: existing.assetRef,
      textContent:
        args.changes.textContent !== undefined
          ? args.changes.textContent
          : existing.textContent,
      width: args.changes.width ?? existing.width,
      height: args.changes.height ?? existing.height,
      opacity: args.changes.opacity ?? existing.opacity,
      rotation: args.changes.rotation ?? existing.rotation,
      zIndex: args.changes.zIndex ?? existing.zIndex,
      cropX: args.changes.cropX ?? existing.cropX,
      cropY: args.changes.cropY ?? existing.cropY,
      cropWidth:
        args.changes.cropWidth !== undefined
          ? args.changes.cropWidth
          : existing.cropWidth,
      cropHeight:
        args.changes.cropHeight !== undefined
          ? args.changes.cropHeight
          : existing.cropHeight,
    };

    validateLayerInput(merged);

    return this.repository.updateLayer(
      args.projectId,
      args.compositionId,
      args.layerId,
      {
        ...args.changes,
        updatedAt: new Date().toISOString(),
      },
    );
  }

  async deleteLayer(args: {
    projectId: string;
    compositionId: string;
    layerId: string;
    userId: string;
  }): Promise<void> {
    await this.requireLayer(args.projectId, args.compositionId, args.layerId);
    await this.repository.deleteLayer(
      args.projectId,
      args.compositionId,
      args.layerId,
    );
  }

  async addKeyframe(args: {
    projectId: string;
    compositionId: string;
    layerId: string;
    userId: string;
    property: MotionProperty;
    timeMs: number;
    fromValue: number;
    toValue: number;
    easing?: MotionEasing;
  }): Promise<VisualLayerRecord> {
    await this.authorizeProject(args.projectId, args.userId);
    const composition = await this.requireComposition(
      args.projectId,
      args.compositionId,
    );
    await this.requireLayer(args.projectId, args.compositionId, args.layerId);

    if (!isMotionProperty(args.property)) {
      throw new HttpError(400, "Invalid motion property");
    }

    const easing = args.easing ?? "LINEAR";
    if (!isMotionEasing(easing)) {
      throw new HttpError(400, "Invalid motion easing");
    }

    validateKeyframeInput({
      property: args.property,
      timeMs: args.timeMs,
      fromValue: args.fromValue,
      toValue: args.toValue,
      easing,
    });

    if (args.timeMs > composition.durationMs) {
      throw new HttpError(
        400,
        "Keyframe time must fall within the composition duration",
      );
    }

    await this.repository.upsertKeyframe({
      id: createId("vkey"),
      layerId: args.layerId,
      property: args.property,
      timeMs: args.timeMs,
      fromValue: args.fromValue,
      toValue: args.toValue,
      easing,
      createdAt: new Date().toISOString(),
    });

    return this.requireLayer(args.projectId, args.compositionId, args.layerId);
  }

  async deleteKeyframe(args: {
    projectId: string;
    compositionId: string;
    layerId: string;
    keyframeId: string;
    userId: string;
  }): Promise<void> {
    await this.requireLayer(args.projectId, args.compositionId, args.layerId);
    await this.repository.deleteKeyframe(
      args.projectId,
      args.compositionId,
      args.layerId,
      args.keyframeId,
    );
  }

  async setEffect(args: {
    projectId: string;
    compositionId: string;
    layerId: string;
    userId: string;
    type: VisualEffectType;
    amount: number;
    enabled?: boolean;
  }): Promise<VisualLayerRecord> {
    await this.authorizeProject(args.projectId, args.userId);
    await this.requireLayer(args.projectId, args.compositionId, args.layerId);

    if (!isVisualEffectType(args.type)) {
      throw new HttpError(400, "Invalid effect type");
    }

    validateEffectAmount(args.type, args.amount);

    const now = new Date().toISOString();

    await this.repository.upsertEffect({
      id: createId("veff"),
      layerId: args.layerId,
      type: args.type,
      amount: args.amount,
      enabled: args.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    });

    return this.requireLayer(args.projectId, args.compositionId, args.layerId);
  }

  async deleteEffect(args: {
    projectId: string;
    compositionId: string;
    layerId: string;
    effectId: string;
    userId: string;
  }): Promise<void> {
    await this.requireLayer(args.projectId, args.compositionId, args.layerId);
    await this.repository.deleteEffect(
      args.projectId,
      args.compositionId,
      args.layerId,
      args.effectId,
    );
  }

  async applyPreset(args: {
    projectId: string;
    compositionId: string;
    layerId: string;
    userId: string;
    presetId: string;
  }): Promise<VisualLayerRecord> {
    await this.authorizeProject(args.projectId, args.userId);
    const composition = await this.requireComposition(
      args.projectId,
      args.compositionId,
    );
    await this.requireLayer(args.projectId, args.compositionId, args.layerId);

    if (!isMotionPresetId(args.presetId)) {
      throw new HttpError(400, "Unknown motion preset");
    }

    const presetId: MotionPresetId = args.presetId;
    const keyframes = buildPresetKeyframes(presetId, composition.durationMs);
    const now = new Date().toISOString();

    for (const keyframe of keyframes) {
      await this.repository.upsertKeyframe({
        id: createId("vkey"),
        layerId: args.layerId,
        property: keyframe.property,
        timeMs: keyframe.timeMs,
        fromValue: keyframe.fromValue,
        toValue: keyframe.toValue,
        easing: keyframe.easing,
        createdAt: now,
      });
    }

    return this.requireLayer(args.projectId, args.compositionId, args.layerId);
  }

  async listLayers(args: {
    projectId: string;
    compositionId: string;
    userId: string;
  }): Promise<VisualLayerRecord[]> {
    const composition = await this.requireCompositionForUser(args);
    return composition.layers;
  }

  private async requireCompositionForUser(args: {
    projectId: string;
    compositionId: string;
    userId: string;
  }): Promise<VisualCompositionRecord> {
    await this.authorizeProject(args.projectId, args.userId);
    return this.requireComposition(args.projectId, args.compositionId);
  }

  private async requireComposition(
    projectId: string,
    compositionId: string,
  ): Promise<VisualCompositionRecord> {
    const composition = await this.repository.getComposition(
      projectId,
      compositionId,
    );

    if (!composition) {
      throw new HttpError(404, "Composition not found");
    }

    return composition;
  }

  private async requireLayer(
    projectId: string,
    compositionId: string,
    layerId: string,
  ): Promise<VisualLayerRecord> {
    const layer = await this.repository.getLayer(
      projectId,
      compositionId,
      layerId,
    );

    if (!layer) {
      throw new HttpError(404, "Layer not found");
    }

    return layer;
  }

  private async nextZIndex(
    composition: VisualCompositionRecord,
  ): Promise<number> {
    return composition.layers.reduce(
      (highest, layer) => Math.max(highest, layer.zIndex + 1),
      0,
    );
  }
}

function labelForType(type: VisualLayerType): string {
  switch (type) {
    case "MEDIA":
      return "Media";
    case "TEXT":
      return "Text";
    case "SHAPE":
      return "Shape";
    case "GROUP":
      return "Group";
  }
}
