import type { PublicOrm } from "../../prisma/db";
import { db } from "../../prisma/db";
import type { Models } from "../../prisma/contract.d";
import { pgTimestampToIso } from "../../lib/time";
import type {
  CreateCompositionInput,
  CreateLayerInput,
  UpdateCompositionInput,
  UpdateLayerInput,
  UpsertEffectInput,
  UpsertKeyframeInput,
  VisualRepository,
} from "../../core/ports/visual-repository";
import type {
  MotionKeyframeRecord,
  VisualCompositionRecord,
  VisualEffectRecord,
  VisualLayerRecord,
} from "../../modules/visual-motion-engine/domain/types";

type CompositionRow = Omit<
  Models.public_VisualComposition,
  "project" | "layers"
>;
type LayerRow = Omit<
  Models.public_VisualLayer,
  "composition" | "effects" | "keyframes"
>;
type KeyframeRow = Omit<Models.public_MotionKeyframe, "layer">;
type EffectRow = Omit<Models.public_VisualEffect, "layer">;

function decodeComposition(
  row: CompositionRow,
  layers: VisualLayerRecord[],
): VisualCompositionRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    shotId: row.shotId ?? null,
    name: row.name,
    width: row.width,
    height: row.height,
    frameRate: row.frameRate,
    durationMs: row.durationMs,
    status: row.status,
    createdById: row.createdById,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
    layers,
  };
}

function decodeLayer(
  row: LayerRow,
  keyframes: MotionKeyframeRecord[],
  effects: VisualEffectRecord[],
): VisualLayerRecord {
  return {
    id: row.id,
    compositionId: row.compositionId,
    name: row.name,
    type: row.type,
    assetRef: row.assetRef ?? null,
    textContent: row.textContent ?? null,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    opacity: row.opacity,
    fit: row.fit,
    cropX: row.cropX,
    cropY: row.cropY,
    cropWidth: row.cropWidth ?? null,
    cropHeight: row.cropHeight ?? null,
    zIndex: row.zIndex,
    visible: row.visible,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
    keyframes,
    effects,
  };
}

function decodeKeyframe(row: KeyframeRow): MotionKeyframeRecord {
  return {
    id: row.id,
    layerId: row.layerId,
    property: row.property,
    timeMs: row.timeMs,
    fromValue: row.fromValue,
    toValue: row.toValue,
    easing: row.easing,
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

function decodeEffect(row: EffectRow): VisualEffectRecord {
  return {
    id: row.id,
    layerId: row.layerId,
    type: row.type,
    amount: row.amount,
    enabled: row.enabled,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

export class PostgresVisualRepository implements VisualRepository {
  private readonly orm: PublicOrm;

  constructor(orm: PublicOrm = db.orm.public) {
    this.orm = orm;
  }

  async createComposition(
    input: CreateCompositionInput,
  ): Promise<VisualCompositionRecord> {
    const row = (await this.orm.VisualComposition.create({
      id: input.id,
      projectId: input.projectId,
      shotId: input.shotId,
      name: input.name,
      width: input.width,
      height: input.height,
      frameRate: input.frameRate,
      durationMs: input.durationMs,
      status: "DRAFT",
      createdById: input.createdById,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })) as unknown as CompositionRow;

    return decodeComposition(row, []);
  }

  async getComposition(
    projectId: string,
    compositionId: string,
  ): Promise<VisualCompositionRecord | null> {
    // The composition read is the project scope. Every child collection is then
    // keyed by this composition's id, so a layer from another project can never
    // be reached through a project it does not belong to.
    const row = await this.orm.VisualComposition.where({
      id: compositionId,
      projectId,
    }).first();

    if (!row) {
      return null;
    }

    const composition = row as unknown as CompositionRow;
    const layers = await this.readLayers(compositionId);

    return decodeComposition(composition, layers);
  }

  async listCompositions(
    projectId: string,
  ): Promise<VisualCompositionRecord[]> {
    const rows = (await this.orm.VisualComposition.where({ projectId }).all())
      .map((row) => row as unknown as CompositionRow)
      .sort((a, b) => {
        const created = a.createdAt.localeCompare(b.createdAt);
        return created !== 0 ? created : a.id.localeCompare(b.id);
      });

    return Promise.all(
      rows.map(async (row) =>
        decodeComposition(row, await this.readLayers(row.id)),
      ),
    );
  }

  async updateComposition(
    projectId: string,
    compositionId: string,
    changes: UpdateCompositionInput,
  ): Promise<VisualCompositionRecord> {
    await this.orm.VisualComposition.where({
      id: compositionId,
      projectId,
    }).update({
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.width !== undefined ? { width: changes.width } : {}),
      ...(changes.height !== undefined ? { height: changes.height } : {}),
      ...(changes.frameRate !== undefined
        ? { frameRate: changes.frameRate }
        : {}),
      ...(changes.durationMs !== undefined
        ? { durationMs: changes.durationMs }
        : {}),
      ...(changes.shotId !== undefined ? { shotId: changes.shotId } : {}),
      ...(changes.status !== undefined ? { status: changes.status } : {}),
      updatedAt: changes.updatedAt,
    });

    const updated = await this.getComposition(projectId, compositionId);

    if (!updated) {
      throw new Error("Composition disappeared during update");
    }

    return updated;
  }

  async deleteComposition(
    projectId: string,
    compositionId: string,
  ): Promise<void> {
    await this.orm.VisualComposition.where({
      id: compositionId,
      projectId,
    }).delete();
  }

  async createLayer(input: CreateLayerInput): Promise<VisualLayerRecord> {
    const row = (await this.orm.VisualLayer.create({
      id: input.id,
      compositionId: input.compositionId,
      name: input.name,
      type: input.type,
      assetRef: input.assetRef,
      textContent: input.textContent,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      rotation: input.rotation,
      opacity: input.opacity,
      fit: input.fit,
      cropX: input.cropX,
      cropY: input.cropY,
      cropWidth: input.cropWidth,
      cropHeight: input.cropHeight,
      zIndex: input.zIndex,
      visible: input.visible,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })) as unknown as LayerRow;

    return decodeLayer(row, [], []);
  }

  async getLayer(
    projectId: string,
    compositionId: string,
    layerId: string,
  ): Promise<VisualLayerRecord | null> {
    const scoped = await this.orm.VisualComposition.where({
      id: compositionId,
      projectId,
    }).first();

    if (!scoped) {
      return null;
    }

    const row = await this.orm.VisualLayer.where({
      id: layerId,
      compositionId,
    }).first();

    if (!row) {
      return null;
    }

    const layer = row as unknown as LayerRow;

    return decodeLayer(
      layer,
      await this.readKeyframes(layerId),
      await this.readEffects(layerId),
    );
  }

  async updateLayer(
    projectId: string,
    compositionId: string,
    layerId: string,
    changes: UpdateLayerInput,
  ): Promise<VisualLayerRecord> {
    const existing = await this.getLayer(projectId, compositionId, layerId);

    if (!existing) {
      throw new Error("Layer not found in composition");
    }

    await this.orm.VisualLayer.where({ id: layerId, compositionId }).update({
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.type !== undefined ? { type: changes.type } : {}),
      ...(changes.assetRef !== undefined ? { assetRef: changes.assetRef } : {}),
      ...(changes.textContent !== undefined
        ? { textContent: changes.textContent }
        : {}),
      ...(changes.x !== undefined ? { x: changes.x } : {}),
      ...(changes.y !== undefined ? { y: changes.y } : {}),
      ...(changes.width !== undefined ? { width: changes.width } : {}),
      ...(changes.height !== undefined ? { height: changes.height } : {}),
      ...(changes.rotation !== undefined ? { rotation: changes.rotation } : {}),
      ...(changes.opacity !== undefined ? { opacity: changes.opacity } : {}),
      ...(changes.fit !== undefined ? { fit: changes.fit } : {}),
      ...(changes.cropX !== undefined ? { cropX: changes.cropX } : {}),
      ...(changes.cropY !== undefined ? { cropY: changes.cropY } : {}),
      ...(changes.cropWidth !== undefined
        ? { cropWidth: changes.cropWidth }
        : {}),
      ...(changes.cropHeight !== undefined
        ? { cropHeight: changes.cropHeight }
        : {}),
      ...(changes.zIndex !== undefined ? { zIndex: changes.zIndex } : {}),
      ...(changes.visible !== undefined ? { visible: changes.visible } : {}),
      updatedAt: changes.updatedAt,
    });

    const updated = await this.getLayer(projectId, compositionId, layerId);

    if (!updated) {
      throw new Error("Layer disappeared during update");
    }

    return updated;
  }

  async deleteLayer(
    projectId: string,
    compositionId: string,
    layerId: string,
  ): Promise<void> {
    const scoped = await this.getLayer(projectId, compositionId, layerId);

    if (!scoped) {
      return;
    }

    await this.orm.VisualLayer.where({ id: layerId, compositionId }).delete();
  }

  async listKeyframes(
    projectId: string,
    compositionId: string,
    layerId: string,
  ): Promise<MotionKeyframeRecord[]> {
    const layer = await this.getLayer(projectId, compositionId, layerId);
    return layer ? layer.keyframes : [];
  }

  async upsertKeyframe(
    input: UpsertKeyframeInput,
  ): Promise<MotionKeyframeRecord> {
    const existing = await this.orm.MotionKeyframe.where({
      layerId: input.layerId,
      property: input.property,
      timeMs: input.timeMs,
    }).first();

    if (existing) {
      const row = (await this.orm.MotionKeyframe.where({
        id: existing.id,
      }).update({
        fromValue: input.fromValue,
        toValue: input.toValue,
        easing: input.easing,
      })) as unknown as KeyframeRow;

      return decodeKeyframe(row);
    }

    const row = (await this.orm.MotionKeyframe.create({
      id: input.id,
      layerId: input.layerId,
      property: input.property,
      timeMs: input.timeMs,
      fromValue: input.fromValue,
      toValue: input.toValue,
      easing: input.easing,
      createdAt: input.createdAt,
    })) as unknown as KeyframeRow;

    return decodeKeyframe(row);
  }

  async deleteKeyframe(
    projectId: string,
    compositionId: string,
    layerId: string,
    keyframeId: string,
  ): Promise<void> {
    const layer = await this.getLayer(projectId, compositionId, layerId);

    if (!layer || !layer.keyframes.some((row) => row.id === keyframeId)) {
      return;
    }

    await this.orm.MotionKeyframe.where({ id: keyframeId, layerId }).delete();
  }

  async listEffects(
    projectId: string,
    compositionId: string,
    layerId: string,
  ): Promise<VisualEffectRecord[]> {
    const layer = await this.getLayer(projectId, compositionId, layerId);
    return layer ? layer.effects : [];
  }

  async upsertEffect(input: UpsertEffectInput): Promise<VisualEffectRecord> {
    const existing = await this.orm.VisualEffect.where({
      layerId: input.layerId,
      type: input.type,
    }).first();

    if (existing) {
      const row = (await this.orm.VisualEffect.where({
        id: existing.id,
      }).update({
        amount: input.amount,
        enabled: input.enabled,
        updatedAt: input.updatedAt,
      })) as unknown as EffectRow;

      return decodeEffect(row);
    }

    const row = (await this.orm.VisualEffect.create({
      id: input.id,
      layerId: input.layerId,
      type: input.type,
      amount: input.amount,
      enabled: input.enabled,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })) as unknown as EffectRow;

    return decodeEffect(row);
  }

  async deleteEffect(
    projectId: string,
    compositionId: string,
    layerId: string,
    effectId: string,
  ): Promise<void> {
    const layer = await this.getLayer(projectId, compositionId, layerId);

    if (!layer || !layer.effects.some((row) => row.id === effectId)) {
      return;
    }

    await this.orm.VisualEffect.where({ id: effectId, layerId }).delete();
  }

  private async readLayers(compositionId: string): Promise<VisualLayerRecord[]> {
    const rows = (
      await this.orm.VisualLayer.where({ compositionId }).all()
    )
      .map((row) => row as unknown as LayerRow)
      .sort((a, b) => {
        if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
        return a.id.localeCompare(b.id);
      });

    return Promise.all(
      rows.map(async (row) =>
        decodeLayer(
          row,
          await this.readKeyframes(row.id),
          await this.readEffects(row.id),
        ),
      ),
    );
  }

  private async readKeyframes(layerId: string): Promise<MotionKeyframeRecord[]> {
    const rows = (await this.orm.MotionKeyframe.where({ layerId }).all())
      .map((row) => row as unknown as KeyframeRow)
      .sort((a, b) => {
        if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
        return a.id.localeCompare(b.id);
      });

    return rows.map(decodeKeyframe);
  }

  private async readEffects(layerId: string): Promise<VisualEffectRecord[]> {
    const rows = (await this.orm.VisualEffect.where({ layerId }).all())
      .map((row) => row as unknown as EffectRow)
      .sort((a, b) => a.type.localeCompare(b.type));

    return rows.map(decodeEffect);
  }
}
