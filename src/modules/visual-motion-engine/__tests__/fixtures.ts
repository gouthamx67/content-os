import type {
  MotionKeyframeRecord,
  VisualCompositionRecord,
  VisualEffectRecord,
  VisualLayerRecord,
} from "../domain/types";

let counter = 0;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

export function makeKeyframe(
  overrides: Partial<MotionKeyframeRecord> = {},
): MotionKeyframeRecord {
  return {
    id: nextId("key"),
    layerId: "layer_1",
    property: "OPACITY",
    timeMs: 0,
    fromValue: 0,
    toValue: 1,
    easing: "LINEAR",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeEffect(
  overrides: Partial<VisualEffectRecord> = {},
): VisualEffectRecord {
  return {
    id: nextId("eff"),
    layerId: "layer_1",
    type: "BLUR",
    amount: 4,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeLayer(
  overrides: Partial<VisualLayerRecord> = {},
): VisualLayerRecord {
  return {
    id: nextId("layer"),
    compositionId: "comp_1",
    name: "Layer",
    type: "SHAPE",
    assetRef: null,
    textContent: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    fit: "CONTAIN",
    cropX: 0,
    cropY: 0,
    cropWidth: null,
    cropHeight: null,
    zIndex: 0,
    visible: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    keyframes: [],
    effects: [],
    ...overrides,
  };
}

export function makeComposition(
  overrides: Partial<VisualCompositionRecord> = {},
): VisualCompositionRecord {
  return {
    id: "comp_1",
    projectId: "proj_1",
    shotId: null,
    name: "Composition",
    width: 1080,
    height: 1920,
    frameRate: 30,
    durationMs: 1000,
    status: "DRAFT",
    createdById: "user_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    layers: [],
    ...overrides,
  };
}
