import type {
  VisualCompositionRecord,
  VisualEffectType,
  VisualFitMode,
  VisualLayerType,
} from "../domain/types";
import { evaluateScene } from "../motion/evaluate-scene";

/**
 * The contract CP15's renderer consumes.
 *
 * Versioned on purpose: the renderer is a separate checkpoint and will be built
 * against a frozen shape. Bumping this number is the signal that the shape
 * changed; a renderer that reads `contractVersion` can refuse a document it does
 * not understand instead of silently mis-rendering it.
 */
export const VISUAL_RENDERER_CONTRACT_VERSION = 1 as const;

export type RendererContractEffect = {
  type: VisualEffectType;
  amount: number;
};

export type RendererContractLayer = {
  id: string;
  name: string;
  type: VisualLayerType;
  assetRef: string | null;
  textContent: string | null;
  visible: boolean;
  zIndex: number;
  fit: VisualFitMode;
  transform: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    opacity: number;
  };
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  effects: RendererContractEffect[];
};

export type RendererScene = {
  contractVersion: typeof VISUAL_RENDERER_CONTRACT_VERSION;
  compositionId: string;
  projectId: string;
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
  timeMs: number;
  layers: RendererContractLayer[];
};

/**
 * Builds one renderable frame. It never touches storage: `assetRef` is a
 * logical reference the renderer resolves through the capture/asset services,
 * so this document can be produced without reading a single byte of media.
 */
export function buildRendererScene(
  composition: VisualCompositionRecord,
  timeMs: number,
): RendererScene {
  const frame = evaluateScene(composition, timeMs);

  return {
    contractVersion: VISUAL_RENDERER_CONTRACT_VERSION,
    compositionId: composition.id,
    projectId: composition.projectId,
    width: frame.width,
    height: frame.height,
    frameRate: frame.frameRate,
    durationMs: frame.durationMs,
    timeMs: frame.timeMs,
    layers: frame.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      type: layer.type,
      assetRef: layer.assetRef,
      textContent: layer.textContent,
      visible: layer.visible,
      zIndex: layer.zIndex,
      fit: layer.fit,
      transform: {
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        rotation: layer.rotation,
        opacity: layer.opacity,
      },
      crop: layer.crop,
      effects: layer.effects.map((effect) => ({
        type: effect.type,
        amount: effect.amount,
      })),
    })),
  };
}
