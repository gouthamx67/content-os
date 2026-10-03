import {
  VISUAL_RENDERER_CONTRACT_VERSION,
  type RendererContract,
} from "../../visual-motion-engine/export/renderer-contract";
import type { SceneGraphLayer } from "../../visual-motion-engine/serialization/scene-graph";
import {
  isFiniteNumber,
  isMotionEasing,
  isMotionProperty,
  isVisualEffectType,
  isVisualFitMode,
  isVisualLayerType,
} from "../../visual-motion-engine/domain/validation";
import { RENDER_LIMITS } from "../render-limits";
import { RenderContractError } from "../errors";

/**
 * Rehydrates and checks a renderer contract.
 *
 * The snapshot is read back out of the database as text, so it is untrusted
 * input even though this codebase wrote it. Validating the whole shape here
 * means the compiler can assume the contract is well-formed and never has to
 * guard every field access with a fallback.
 */
export function validateRendererContract(value: unknown): RendererContract {
  const root = expectObject(value, "renderer contract");

  if (root.contractVersion !== VISUAL_RENDERER_CONTRACT_VERSION) {
    throw new RenderContractError(
      `Unsupported renderer contract version: ${String(root.contractVersion)}`,
    );
  }

  const composition = expectObject(root.composition, "composition");
  const id = expectString(composition.id, "composition.id");
  const projectId = expectString(composition.projectId, "composition.projectId");
  const canvas = expectObject(composition.canvas, "composition.canvas");

  const width = expectPositiveInt(canvas.width, "canvas.width");
  const height = expectPositiveInt(canvas.height, "canvas.height");
  const frameRate = expectPositiveNumber(canvas.frameRate, "canvas.frameRate");
  const durationMs = expectPositiveInt(canvas.durationMs, "canvas.durationMs");

  if (!Array.isArray(composition.layers)) {
    throw new RenderContractError("composition.layers must be an array");
  }

  if (composition.layers.length > RENDER_LIMITS.maxLayers) {
    throw new RenderContractError(
      `A render may contain at most ${RENDER_LIMITS.maxLayers} layers`,
    );
  }

  const layers = composition.layers.map((layer, index) =>
    validateLayer(layer, `composition.layers[${index}]`),
  );

  return {
    contractVersion: VISUAL_RENDERER_CONTRACT_VERSION,
    composition: {
      id,
      projectId,
      canvas: { width, height, frameRate, durationMs },
      layers,
    },
  };
}

/**
 * The cheap, pre-FFmpeg bound check.
 *
 * Dimensions and duration come from the contract, not the composition, so a
 * snapshot that was valid at enqueue time is re-checked against the limits the
 * worker is running with today.
 */
export function assertWithinRenderLimits(contract: RendererContract): void {
  const { canvas, layers } = contract.composition;

  if (canvas.width > RENDER_LIMITS.maxWidth || canvas.height > RENDER_LIMITS.maxHeight) {
    throw new RenderContractError(
      `Render dimensions must not exceed ${RENDER_LIMITS.maxWidth}x${RENDER_LIMITS.maxHeight}`,
    );
  }

  if (canvas.frameRate > RENDER_LIMITS.maxFrameRate) {
    throw new RenderContractError(
      `Render frame rate must not exceed ${RENDER_LIMITS.maxFrameRate}`,
    );
  }

  if (canvas.durationMs > RENDER_LIMITS.maxDurationMs) {
    throw new RenderContractError(
      `Render duration must not exceed ${RENDER_LIMITS.maxDurationMs}ms`,
    );
  }

  if (layers.length > RENDER_LIMITS.maxLayers) {
    throw new RenderContractError(
      `A render may contain at most ${RENDER_LIMITS.maxLayers} layers`,
    );
  }
}

function validateLayer(value: unknown, path: string): SceneGraphLayer {
  const layer = expectObject(value, path);

  if (!isVisualLayerType(layer.type)) {
    throw new RenderContractError(`${path}.type is invalid`);
  }

  if (!isVisualFitMode(layer.fit)) {
    throw new RenderContractError(`${path}.fit is invalid`);
  }

  if (typeof layer.visible !== "boolean") {
    throw new RenderContractError(`${path}.visible must be a boolean`);
  }

  if (layer.assetRef !== null && typeof layer.assetRef !== "string") {
    throw new RenderContractError(`${path}.assetRef must be a string or null`);
  }

  if (layer.textContent !== null && typeof layer.textContent !== "string") {
    throw new RenderContractError(`${path}.textContent must be a string or null`);
  }

  const id = expectString(layer.id, `${path}.id`);

  if (!Array.isArray(layer.keyframes)) {
    throw new RenderContractError(`${path}.keyframes must be an array`);
  }

  if (!Array.isArray(layer.effects)) {
    throw new RenderContractError(`${path}.effects must be an array`);
  }

  const keyframes = layer.keyframes.map((keyframe, index) => {
    const entry = expectObject(keyframe, `${path}.keyframes[${index}]`);

    if (!isMotionProperty(entry.property)) {
      throw new RenderContractError(`${path}.keyframes[${index}].property is invalid`);
    }

    if (!isMotionEasing(entry.easing)) {
      throw new RenderContractError(`${path}.keyframes[${index}].easing is invalid`);
    }

    return {
      id: expectString(entry.id, `${path}.keyframes[${index}].id`),
      property: entry.property,
      timeMs: expectNonNegativeInt(entry.timeMs, `${path}.keyframes[${index}].timeMs`),
      fromValue: expectFinite(entry.fromValue, `${path}.keyframes[${index}].fromValue`),
      toValue: expectFinite(entry.toValue, `${path}.keyframes[${index}].toValue`),
      easing: entry.easing,
    };
  });

  const effects = layer.effects.map((effect, index) => {
    const entry = expectObject(effect, `${path}.effects[${index}]`);

    if (!isVisualEffectType(entry.type)) {
      throw new RenderContractError(`${path}.effects[${index}].type is invalid`);
    }

    return {
      id: expectString(entry.id, `${path}.effects[${index}].id`),
      type: entry.type,
      amount: expectNonNegativeNumber(entry.amount, `${path}.effects[${index}].amount`),
      enabled: entry.enabled === true,
    };
  });

  return {
    id,
    name: typeof layer.name === "string" ? layer.name : "",
    type: layer.type,
    assetRef: layer.assetRef ?? null,
    textContent: layer.textContent ?? null,
    x: expectFinite(layer.x, `${path}.x`),
    y: expectFinite(layer.y, `${path}.y`),
    width: expectNonNegativeNumber(layer.width, `${path}.width`),
    height: expectNonNegativeNumber(layer.height, `${path}.height`),
    rotation: expectFinite(layer.rotation, `${path}.rotation`),
    opacity: clamp01(expectFinite(layer.opacity, `${path}.opacity`)),
    fit: layer.fit,
    cropX: expectFinite(layer.cropX, `${path}.cropX`),
    cropY: expectFinite(layer.cropY, `${path}.cropY`),
    cropWidth:
      layer.cropWidth === null
        ? null
        : expectPositiveNumber(layer.cropWidth, `${path}.cropWidth`),
    cropHeight:
      layer.cropHeight === null
        ? null
        : expectPositiveNumber(layer.cropHeight, `${path}.cropHeight`),
    zIndex: Number.isFinite(layer.zIndex) ? Math.trunc(layer.zIndex as number) : 0,
    visible: layer.visible,
    keyframes,
    effects,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RenderContractError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RenderContractError(`${path} must be a non-empty string`);
  }
  return value;
}

function expectFinite(value: unknown, path: string): number {
  if (!isFiniteNumber(value)) {
    throw new RenderContractError(`${path} must be a finite number`);
  }
  return value;
}

function expectNonNegativeNumber(value: unknown, path: string): number {
  const number = expectFinite(value, path);
  if (number < 0) throw new RenderContractError(`${path} must be zero or greater`);
  return number;
}

function expectPositiveNumber(value: unknown, path: string): number {
  const number = expectFinite(value, path);
  if (number <= 0) throw new RenderContractError(`${path} must be greater than zero`);
  return number;
}

function expectNonNegativeInt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new RenderContractError(`${path} must be a non-negative integer`);
  }
  return value;
}

function expectPositiveInt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new RenderContractError(`${path} must be a positive integer`);
  }
  return value;
}
