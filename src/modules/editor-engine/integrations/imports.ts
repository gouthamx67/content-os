import { createId } from "../../../lib/id";
import { EditorError } from "../errors";
import type {
  EditorAudioSettings,
  EditorMediaKind,
  EditorNode,
  EditorNodeAsset,
  EditorProvenanceOrigin,
} from "../domain/types";
import { emptyStyle } from "../domain/types";
import type { EditorService } from "../editor-service";
import type { AudioRepository } from "../../../core/ports/audio-repository";
import type { AssetRepository } from "../../../core/ports/asset-repository";
import type { CaptureRepository } from "../../../core/ports/capture-repository";
import type { ImageGenerationRepository } from "../../../core/ports/image-generation-repository";
import type { WritingRepository } from "../../../core/ports/writing-repository";
import type { AdaptationRepository } from "../../../core/ports/adaptation-repository";
import type { AudioCompositionRecord } from "../../audio-engine/domain/types";
import type {
  MotionEasing,
  MotionProperty,
  VisualEffectType,
  VisualLayerType,
} from "../../visual-motion-engine/domain/types";

export type EditorImportServiceDeps = {
  editor: EditorService;
  captures: CaptureRepository;
  assets: AssetRepository;
  images: ImageGenerationRepository;
  writing: WritingRepository;
  adaptations: AdaptationRepository;
  audio: AudioRepository;
  visualCompositionFor: (args: {
    projectId: string;
    compositionId: string;
    userId: string;
  }) => Promise<SceneGraphLike>;
};

export type CreatedEditorDocument = Awaited<
  ReturnType<EditorService["createDocument"]>
>;

/**
 * Scene-graph surface the adapter reads from.
 *
 * Importing reads the canonical CP14 view, so this stays a structural type over
 * the exported `SceneGraph` rather than touching the composition service and its
 * rows.
 */
type SceneGraphLike = {
  id: string;
  projectId: string;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
  layers: readonly {
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
    zIndex: number;
    visible: boolean;
    keyframes: readonly {
      id: string;
      property: MotionProperty;
      timeMs: number;
      fromValue: number;
      toValue: number;
      easing: MotionEasing;
    }[];
    effects: readonly {
      id: string;
      type: VisualEffectType;
      amount: number;
      enabled: boolean;
    }[];
  }[];
};

const DEFAULT_AUDIO: EditorAudioSettings = {
  gainDb: 0,
  muted: false,
  pan: 0,
  fadeInMs: 0,
  fadeOutMs: 0,
  sourceOffsetMs: 0,
  solo: false,
  duckVoiceoverDb: null,
};

/**
 * CP20 import adapters.
 *
 * Each adapter turns an artifact already owned by another checkpoint into
 * editor nodes, then creates a document through the same append-only service
 * every other write uses — the import is just an initial revision with
 * `sourceType: "IMPORT"`. Nothing is duplicated: media keeps its controlled
 * reference, copy keeps its grounded provenance, and the source keeps its id so
 * a reader can always walk back to the checkpoint it came from.
 *
 * A source id that belongs to another project resolves to nothing, so every
 * adapter is inert across project boundaries by construction.
 */
export class EditorImportService {
  constructor(private readonly deps: EditorImportServiceDeps) {}

  /** CP14 visual composition → editor document (visual nodes only). */
  async importFromCP14(args: {
    projectId: string;
    userId: string;
    compositionId: string;
    name?: string;
  }): Promise<CreatedEditorDocument> {
    const graph = await this.deps.visualCompositionFor(args);
    const nodes: EditorNode[] = [];
    for (const layer of graph.layers) {
      nodes.push(
        await this.layerToNode(graph.projectId, layer, {
          origin: "VISUAL_COMPOSITION",
          sourceId: graph.id,
          label: `Imported from the visual composition “${graph.name}”`,
        }),
      );
    }

    return this.deps.editor.createDocument({
      projectId: args.projectId,
      userId: args.userId,
      name:
        args.name ??
        `Composition import — ${graph.name}`,
      width: graph.width,
      height: graph.height,
      durationMs: graph.durationMs,
      frameRate: graph.frameRate,
      nodes,
      sourceType: "IMPORT",
      sourceId: graph.id,
      provenanceSourceIds: [graph.id],
    });
  }

  /** CP16 audio composition → editor document (audio tracks only). */
  async importFromCP16(args: {
    projectId: string;
    userId: string;
    audioCompositionId: string;
    name?: string;
  }): Promise<CreatedEditorDocument> {
    const composition = await this.deps.audio.getComposition(
      args.projectId,
      args.audioCompositionId,
    );
    if (!composition) {
      throw new EditorError(
        "EDITOR_ASSET_UNAVAILABLE",
        `Audio composition ${args.audioCompositionId} was not found`,
      );
    }

    const nodes = this.tracksToNodes(composition);

    return this.deps.editor.createDocument({
      projectId: args.projectId,
      userId: args.userId,
      name: args.name ?? `Audio import — ${composition.name}`,
      width: 1080,
      height: 1920,
      durationMs: composition.durationMs || 15_000,
      frameRate: 30,
      nodes,
      sourceType: "IMPORT",
      sourceId: composition.id,
      provenanceSourceIds: [composition.id],
    });
  }

  /** CP14 + (optional) CP16 against the same visual composition: multimodal. */
  async importComposition(args: {
    projectId: string;
    userId: string;
    compositionId: string;
    name?: string;
  }): Promise<CreatedEditorDocument> {
    const graph = await this.deps.visualCompositionFor(args);
    const visualNodes: EditorNode[] = [];
    for (const layer of graph.layers) {
      visualNodes.push(
        await this.layerToNode(graph.projectId, layer, {
          origin: "VISUAL_COMPOSITION",
          sourceId: graph.id,
          label: `Imported from the visual composition “${graph.name}”`,
        }),
      );
    }

    const audio = await this.deps.audio.getCompositionByVisual(
      args.projectId,
      graph.id,
    );
    const audioNodes = audio ? this.tracksToNodes(audio) : [];
    const offset = visualNodes.reduce(
      (max, node) => Math.max(max, node.zIndex),
      -1,
    );
    const audioNodesWithZ = audioNodes.map((node, index) => ({
      ...node,
      zIndex: offset + 1 + index,
    }));

    return this.deps.editor.createDocument({
      projectId: args.projectId,
      userId: args.userId,
      name:
        args.name ?? `Multimodal import — ${graph.name}`,
      width: graph.width,
      height: graph.height,
      durationMs: Math.max(
        graph.durationMs,
        audio?.durationMs ?? 0,
      ),
      frameRate: graph.frameRate,
      nodes: [...visualNodes, ...audioNodesWithZ],
      sourceType: "IMPORT",
      sourceId: graph.id,
      provenanceSourceIds: audio
        ? [graph.id, audio.id]
        : [graph.id],
    });
  }

  /** CP17 generated image → editor document (single IMAGE node). */
  async importFromCP17(args: {
    projectId: string;
    userId: string;
    assetId: string;
    name?: string;
  }): Promise<CreatedEditorDocument> {
    const asset = await this.deps.images.getAsset(
      args.projectId,
      args.assetId,
    );
    if (!asset || asset.deletedAt !== null) {
      throw new EditorError(
        "EDITOR_ASSET_UNAVAILABLE",
        `Generated asset ${args.assetId} was not found`,
      );
    }

    const node = this.mediaNode({
      projectId: args.projectId,
      ref: `generated:${asset.id}`,
      assetId: asset.id,
      kind: mediaKindFor(asset.mimeType),
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      durationMs: null,
      provenance: {
        origin: "GENERATED_IMAGE",
        sourceId: asset.id,
        label: `Imported from generated asset ${asset.id}`,
      },
    });

    return this.deps.editor.createDocument({
      projectId: args.projectId,
      userId: args.userId,
      name: args.name ?? `Generated image import — ${asset.id}`,
      width: asset.width || 1080,
      height: asset.height || 1920,
      durationMs: 15_000,
      frameRate: 30,
      nodes: [node],
      sourceType: "IMPORT",
      sourceId: asset.id,
      provenanceSourceIds: [asset.id],
    });
  }

  /** CP18 copy variant → editor document (single grounded TEXT node). */
  async importFromCP18(args: {
    projectId: string;
    userId: string;
    documentId: string;
    variantId: string;
    name?: string;
  }): Promise<CreatedEditorDocument> {
    const document = await this.deps.writing.getDocument(
      args.projectId,
      args.documentId,
    );
    if (!document) {
      throw new EditorError(
        "EDITOR_ASSET_UNAVAILABLE",
        `Writing document ${args.documentId} was not found`,
      );
    }

    const variant = await this.deps.writing.getVariant(
      document.id,
      args.variantId,
    );
    if (!variant) {
      throw new EditorError(
        "EDITOR_ASSET_UNAVAILABLE",
        `Writing variant ${args.variantId} was not found`,
      );
    }

    const sourceIds = writingSourceIds(document.contextSnapshot);

    const node: EditorNode = {
      id: createId("enode"),
      parentId: null,
      type: "TEXT",
      name: `Copy — ${document.title}`,
      zIndex: 0,
      transform: { x: 40, y: 80, width: 900, height: 200, rotation: 0, opacity: 1 },
      visible: true,
      asset: null,
      text: { value: variant.text },
      style: emptyStyle(),
      trim: null,
      audio: null,
      shape: null,
      motion: null,
      effects: [],
      automation: [],
      provenance: {
        origin: "WRITING_VARIANT",
        sourceType: "WRITING_VARIANT",
        sourceId: variant.id,
        sourceIds,
        label: `Imported from copy “${document.title}”`,
      },
    };

    return this.deps.editor.createDocument({
      projectId: args.projectId,
      userId: args.userId,
      name: args.name ?? `Copy import — ${document.title}`,
      width: 1080,
      height: 1920,
      durationMs: 15_000,
      frameRate: 30,
      nodes: [node],
      sourceType: "IMPORT",
      sourceId: variant.id,
      provenanceSourceIds: sourceIds,
    });
  }

  /** CP19 finished adaptation — copy, image or video. */
  async importFromCP19(args: {
    projectId: string;
    userId: string;
    jobId: string;
    name?: string;
  }): Promise<CreatedEditorDocument> {
    const job = await this.deps.adaptations.getJob(
      args.projectId,
      args.jobId,
    );
    if (!job) {
      throw new EditorError(
        "EDITOR_ASSET_UNAVAILABLE",
        `Adaptation job ${args.jobId} was not found`,
      );
    }
    if (job.status !== "SUCCEEDED") {
      throw new EditorError(
        "EDITOR_ASSET_UNAVAILABLE",
        `Adaptation ${job.id} has not finished`,
      );
    }

    let node: EditorNode;
    if (job.kind === "COPY") {
      node = this.textNode(
        `Adaptation copy — ${job.formatId}`,
        job.outputText ?? "",
        {
          origin: "ADAPTATION_JOB",
          sourceId: job.id,
          sourceIds: recipeSourceIds(job.recipe),
          label: `Imported from adaptation job ${job.id}`,
        },
      );
    } else if (job.kind === "IMAGE") {
      node = this.mediaNode({
        projectId: args.projectId,
        ref: `adaptation:${job.id}`,
        assetId: job.id,
        kind: "IMAGE",
        mimeType: job.outputMimeType ?? "image/png",
        byteSize: job.outputByteSize,
        width: job.outputWidth,
        height: job.outputHeight,
        durationMs: null,
        provenance: {
          origin: "ADAPTATION_JOB",
          sourceId: job.id,
          sourceIds: recipeSourceIds(job.recipe),
          label: `Imported from adaptation job ${job.id}`,
        },
      });
    } else {
      node = this.mediaNode({
        projectId: args.projectId,
        ref: `adaptation:${job.id}`,
        assetId: job.id,
        kind: "VIDEO",
        mimeType: job.outputMimeType ?? "video/mp4",
        byteSize: job.outputByteSize,
        width: job.outputWidth,
        height: job.outputHeight,
        durationMs: null,
        provenance: {
          origin: "ADAPTATION_JOB",
          sourceId: job.id,
          sourceIds: recipeSourceIds(job.recipe),
          label: `Imported from adaptation job ${job.id}`,
        },
      });
    }

    return this.deps.editor.createDocument({
      projectId: args.projectId,
      userId: args.userId,
      name: args.name ?? `Adaptation import — ${job.id}`,
      width: 1080,
      height: 1920,
      durationMs: 15_000,
      frameRate: 30,
      nodes: [node],
      sourceType: "IMPORT",
      sourceId: job.id,
      provenanceSourceIds: recipeSourceIds(job.recipe),
    });
  }

  private async layerToNode(
    projectId: string,
    layer: SceneGraphLike["layers"][number],
    provenance: {
      origin: EditorProvenanceOrigin;
      sourceId: string;
      label: string;
    },
  ): Promise<EditorNode> {
    const base = {
      id: createId("enode"),
      parentId: null,
      name: layer.name,
      zIndex: layer.zIndex,
      transform: {
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        rotation: layer.rotation,
        opacity: layer.opacity,
      },
      visible: layer.visible,
      style: emptyStyle(),
      trim: null,
      motion:
        layer.keyframes.length > 0
          ? {
              keyframes: layer.keyframes.map((keyframe) => ({
                id: keyframe.id,
                property: keyframe.property,
                timeMs: keyframe.timeMs,
                fromValue: keyframe.fromValue,
                toValue: keyframe.toValue,
                easing: keyframe.easing,
              })),
            }
          : null,
      effects: layer.effects.map((effect) => ({
        id: effect.id,
        type: effect.type,
        amount: effect.amount,
        enabled: effect.enabled,
      })),
      automation: [],
      provenance: {
        origin: provenance.origin,
        sourceType: provenance.origin,
        sourceId: provenance.sourceId,
        sourceIds: [provenance.sourceId],
        label: provenance.label,
      },
    } satisfies Omit<EditorNode, "asset" | "text" | "audio" | "shape" | "type">;

    if (layer.type === "GROUP") {
      return { ...base, type: "GROUP", asset: null, text: null, audio: null, shape: null };
    }

    if (layer.type === "SHAPE") {
      return {
        ...base,
        type: "SHAPE",
        asset: null,
        text: null,
        audio: null,
        shape: { shapeType: "RECT" },
      };
    }

    if (layer.type === "TEXT") {
      return {
        ...base,
        type: "TEXT",
        asset: null,
        text: { value: layer.textContent ?? "" },
        audio: null,
        shape: null,
      };
    }

    if (!layer.assetRef) {
      throw new EditorError(
        "EDITOR_INVALID_ASSET_REFERENCE",
        `Layer ${layer.id} is media but has no asset reference`,
      );
    }

    const media = await __resolveMedia(projectId, layer.assetRef, this.deps);
    if (media.kind === "AUDIO") {
      return {
        ...base,
        type: "AUDIO",
        asset: media.asset,
        text: null,
        audio: DEFAULT_AUDIO,
        shape: null,
      };
    }

    return {
      ...base,
      type: media.kind === "VIDEO" ? "VIDEO" : "IMAGE",
      asset: media.asset,
      text: null,
      audio: null,
      shape: null,
    };
  }

  private tracksToNodes(
    composition: AudioCompositionRecord,
  ): EditorNode[] {
    return composition.tracks.map((track, index) => ({
      id: createId("enode"),
      parentId: null,
      type: "AUDIO",
      name: track.name,
      zIndex: index,
      transform: { x: 0, y: 0, width: 400, height: 80, rotation: 0, opacity: 1 },
      visible: true,
      asset: {
        ref: track.sourceRef,
        assetId: track.sourceRef.slice(track.sourceRef.indexOf(":") + 1),
        kind: "AUDIO",
        origin: "VISUAL_COMPOSITION",
        sourceType: "AUDIO_TRACK",
        sourceId: track.id,
        mimeType: null,
        byteSize: null,
        width: null,
        height: null,
        durationMs: null,
      },
      text: null,
      style: emptyStyle(),
      trim: {
        startMs: track.startMs,
        endMs: track.startMs + track.durationMs,
      },
      audio: {
        gainDb: track.gainDb,
        muted: track.mute,
        pan: track.pan,
        fadeInMs: track.fadeInMs,
        fadeOutMs: track.fadeOutMs,
        sourceOffsetMs: track.sourceOffsetMs,
        solo: track.solo,
        duckVoiceoverDb: track.duckVoiceoverDb,
      },
      shape: null,
      motion: null,
      effects: [],
      automation: track.automation.map((point) => ({
        id: point.id,
        type: point.property,
        timeMs: point.timeMs,
        value: point.value,
        easing: point.easing,
      })),
      provenance: {
        origin: "VISUAL_COMPOSITION",
        sourceType: "AUDIO_TRACK",
        sourceId: track.id,
        sourceIds: [composition.id],
        label: `Imported audio track “${track.name}”`,
      },
    }));
  }

  private mediaNode(args: {
    projectId: string;
    ref: string;
    assetId: string;
    kind: EditorMediaKind;
    mimeType: string;
    byteSize: number | null;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    provenance: {
      origin: EditorProvenanceOrigin;
      sourceId: string;
      sourceIds?: string[];
      label: string;
    };
  }): EditorNode {
    const asset: EditorNodeAsset = {
      ref: args.ref,
      assetId: args.assetId,
      kind: args.kind,
      origin: args.provenance.origin,
      sourceType: args.provenance.origin,
      sourceId: args.provenance.sourceId,
      mimeType: args.mimeType,
      byteSize: args.byteSize,
      width: args.width,
      height: args.height,
      durationMs: args.durationMs,
    };

    return {
      id: createId("enode"),
      parentId: null,
      type: args.kind === "VIDEO" ? "VIDEO" : args.kind === "AUDIO" ? "AUDIO" : "IMAGE",
      name: args.provenance.label,
      zIndex: 0,
      transform: { x: 0, y: 0, width: args.width ?? 900, height: args.height ?? 500, rotation: 0, opacity: 1 },
      visible: true,
      asset,
      text: null,
      style: emptyStyle(),
      trim: args.durationMs != null ? { startMs: 0, endMs: args.durationMs } : null,
      audio: args.kind === "AUDIO" ? DEFAULT_AUDIO : null,
      shape: null,
      motion: null,
      effects: [],
      automation: [],
      provenance: {
        origin: args.provenance.origin,
        sourceType: args.provenance.origin,
        sourceId: args.provenance.sourceId,
        sourceIds: args.provenance.sourceIds ?? [args.provenance.sourceId],
        label: args.provenance.label,
      },
    };
  }

  private textNode(
    name: string,
    value: string,
    provenance: {
      origin: EditorProvenanceOrigin;
      sourceId: string;
      sourceIds?: string[];
      label: string;
    },
  ): EditorNode {
    return {
      id: createId("enode"),
      parentId: null,
      type: "TEXT",
      name,
      zIndex: 0,
      transform: { x: 40, y: 80, width: 900, height: 200, rotation: 0, opacity: 1 },
      visible: true,
      asset: null,
      text: { value },
      style: emptyStyle(),
      trim: null,
      audio: null,
      shape: null,
      motion: null,
      effects: [],
      automation: [],
      provenance: {
        origin: provenance.origin,
        sourceType: provenance.origin,
        sourceId: provenance.sourceId,
        sourceIds: provenance.sourceIds ?? [provenance.sourceId],
        label: provenance.label,
      },
    };
  }
}

type ResolvedLayerMedia = {
  asset: EditorNodeAsset;
  kind: EditorMediaKind;
};

async function __resolveMedia(
  projectId: string,
  ref: string,
  deps: {
    captures: CaptureRepository;
    images: ImageGenerationRepository;
    assets: AssetRepository;
  },
): Promise<ResolvedLayerMedia> {
  const separator = ref.indexOf(":");
  if (separator <= 0) {
    throw new EditorError("EDITOR_INVALID_ASSET_REFERENCE", `Invalid asset reference: ${ref}`);
  }
  const prefix = ref.slice(0, separator);
  const id = ref.slice(separator + 1);

  if (prefix === "capture") {
    const take = await deps.captures.getTake(projectId, id);
    if (!take || take.status === "DELETED" || take.status === "REJECTED") {
      throw new EditorError("EDITOR_ASSET_UNAVAILABLE", `Capture ${id} is not available to this project`);
    }
    const kind = mediaKindFor(take.mimeType);
    return {
      kind,
      asset: {
        ref,
        assetId: take.id,
        kind,
        origin: "VISUAL_COMPOSITION",
        sourceType: "CAPTURE_TAKE",
        sourceId: take.id,
        mimeType: take.mimeType,
        byteSize: take.byteSize,
        width: take.width,
        height: take.height,
        durationMs: take.durationMs,
      },
    };
  }

  if (prefix === "generated") {
    const asset = await deps.images.getAsset(projectId, id);
    if (!asset) {
      throw new EditorError("EDITOR_ASSET_UNAVAILABLE", `Generated asset ${id} is not available to this project`);
    }
    const kind = mediaKindFor(asset.mimeType);
    return {
      kind,
      asset: {
        ref,
        assetId: asset.id,
        kind,
        origin: "GENERATED_IMAGE",
        sourceType: "GENERATED_IMAGE",
        sourceId: asset.id,
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        width: asset.width,
        height: asset.height,
        durationMs: null,
      },
    };
  }

  if (prefix === "asset") {
    const asset = await deps.assets.getById(id);
    if (!asset || asset.projectId !== projectId) {
      throw new EditorError("EDITOR_CROSS_PROJECT_ASSET", `Asset ${id} is not available to this project`);
    }
    const kind = mediaKindFor(asset.name);
    return {
      kind,
      asset: {
        ref,
        assetId: asset.id,
        kind,
        origin: "VISUAL_COMPOSITION",
        sourceType: "SHARED_ASSET",
        sourceId: asset.id,
        mimeType: null,
        byteSize: null,
        width: null,
        height: null,
        durationMs: null,
      },
    };
  }

  throw new EditorError("EDITOR_INVALID_ASSET_REFERENCE", `Unsupported media reference: ${ref}`);
}

function mediaKindFor(mimeOrName: string | null): EditorMediaKind {
  const value = (mimeOrName ?? "").toLowerCase();
  if (value.startsWith("image/")) return "IMAGE";
  if (value.startsWith("video/")) return "VIDEO";
  if (value.startsWith("audio/")) return "AUDIO";
  if (/\.(png|jpe?g|webp|gif|bmp)$/.test(value)) return "IMAGE";
  if (/\.(mp4|webm|mov|m4v|mkv)$/.test(value)) return "VIDEO";
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(value)) return "AUDIO";
  throw new EditorError(
    "EDITOR_INVALID_ASSET_REFERENCE",
    `Cannot infer a media kind from "${value || "unknown"}"`,
  );
}

function writingSourceIds(contextSnapshot: string): string[] {
  try {
    const context = JSON.parse(contextSnapshot) as { sourceIds?: unknown };
    if (Array.isArray(context.sourceIds)) {
      return context.sourceIds.filter(
        (value): value is string => typeof value === "string",
      );
    }
  } catch {
    return [];
  }
  return [];
}

function recipeSourceIds(recipeJson: string): string[] {
  try {
    const recipe = JSON.parse(recipeJson) as {
      provensanceSourceIds?: unknown;
      provenanceSourceIds?: unknown;
    };
    const ids =
      recipe.provenanceSourceIds ?? recipe.provensanceSourceIds;
    if (Array.isArray(ids)) {
      return ids.filter((value): value is string => typeof value === "string");
    }
  } catch {
    return [];
  }
  return [];
}