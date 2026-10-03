import {
  MOTION_EASINGS,
  MOTION_PROPERTIES,
  VISUAL_COMPOSITION_STATUSES,
  VISUAL_EFFECT_TYPES,
  VISUAL_FIT_MODES,
  VISUAL_LAYER_TYPES,
  type MotionEasing,
  type MotionProperty,
  type VisualCompositionStatus,
  type VisualEffectType,
  type VisualFitMode,
  type VisualLayerType,
} from "./types";

/**
 * A request the user can fix: a bad dimension, an unknown enum, an asset
 * reference that points outside the project. It carries its own status so the
 * HTTP layer never has to guess whether a failure was the caller's fault.
 */
export class VisualValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "VisualValidationError";
  }
}

export const COMPOSITION_LIMITS = {
  minDimension: 1,
  maxDimension: 7680,
  maxFrameRate: 240,
  maxDurationMs: 60 * 60 * 1000,
} as const;

export const LAYER_LIMITS = {
  minSize: 0,
  maxSize: 7680,
  maxRotationDegrees: 3600,
  minZIndex: -1000,
  maxZIndex: 1000,
} as const;

const ASSET_REF_PATTERN = /^(capture|asset|generated):[A-Za-z0-9_-]+$/;

const FORBIDDEN_REF_FRAGMENTS = [
  "..",
  "/",
  "\\",
  "file:",
  "http:",
  "https:",
  "data:",
  "\u0000",
];

export function isVisualCompositionStatus(
  value: unknown,
): value is VisualCompositionStatus {
  return (
    typeof value === "string" &&
    (VISUAL_COMPOSITION_STATUSES as readonly string[]).includes(value)
  );
}

export function isVisualLayerType(value: unknown): value is VisualLayerType {
  return (
    typeof value === "string" &&
    (VISUAL_LAYER_TYPES as readonly string[]).includes(value)
  );
}

export function isVisualFitMode(value: unknown): value is VisualFitMode {
  return (
    typeof value === "string" &&
    (VISUAL_FIT_MODES as readonly string[]).includes(value)
  );
}

export function isVisualEffectType(value: unknown): value is VisualEffectType {
  return (
    typeof value === "string" &&
    (VISUAL_EFFECT_TYPES as readonly string[]).includes(value)
  );
}

export function isMotionProperty(value: unknown): value is MotionProperty {
  return (
    typeof value === "string" &&
    (MOTION_PROPERTIES as readonly string[]).includes(value)
  );
}

export function isMotionEasing(value: unknown): value is MotionEasing {
  return (
    typeof value === "string" &&
    (MOTION_EASINGS as readonly string[]).includes(value)
  );
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * An asset reference names a CP13 take or a CP06 asset, and nothing else.
 *
 * The point of the canonical `kind:id` form is that it cannot carry a path. A
 * bare filesystem path, a `file://` URL or a `../` traversal is rejected here
 * rather than trusted to the resolver: a reference that never reaches the
 * database cannot be used to read a file the project does not own.
 */
export function normalizeAssetRef(value: unknown): string {
  if (typeof value !== "string") {
    throw new VisualValidationError("assetRef must be a string");
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new VisualValidationError("assetRef must not be empty");
  }

  const lowered = trimmed.toLowerCase();

  for (const fragment of FORBIDDEN_REF_FRAGMENTS) {
    if (lowered.includes(fragment)) {
      throw new VisualValidationError(
        "assetRef must be a capture:, asset: or generated: reference, not a path or URL",
      );
    }
  }

  if (!ASSET_REF_PATTERN.test(trimmed)) {
    throw new VisualValidationError(
      "assetRef must be a capture:, asset: or generated: reference",
    );
  }

  return trimmed;
}

export type CompositionInput = {
  name: string;
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
};

export function validateCompositionInput(input: CompositionInput): void {
  const name = input.name.trim();

  if (name.length === 0) {
    throw new VisualValidationError("Composition name is required");
  }

  if (name.length > 160) {
    throw new VisualValidationError(
      "Composition name must be 160 characters or fewer",
    );
  }

  validateDimension("width", input.width);
  validateDimension("height", input.height);

  if (
    !isFiniteNumber(input.frameRate) ||
    input.frameRate <= 0 ||
    input.frameRate > COMPOSITION_LIMITS.maxFrameRate
  ) {
    throw new VisualValidationError(
      `frameRate must be greater than 0 and at most ${COMPOSITION_LIMITS.maxFrameRate}`,
    );
  }

  if (
    !isPositiveInt(input.durationMs) ||
    input.durationMs > COMPOSITION_LIMITS.maxDurationMs
  ) {
    throw new VisualValidationError(
      `durationMs must be a positive integer no greater than ${COMPOSITION_LIMITS.maxDurationMs}`,
    );
  }
}

function validateDimension(field: "width" | "height", value: number): void {
  if (
    !isPositiveInt(value) ||
    value < COMPOSITION_LIMITS.minDimension ||
    value > COMPOSITION_LIMITS.maxDimension
  ) {
    throw new VisualValidationError(
      `${field} must be an integer between ${COMPOSITION_LIMITS.minDimension} and ${COMPOSITION_LIMITS.maxDimension}`,
    );
  }
}

export type LayerInput = {
  type: VisualLayerType;
  assetRef: string | null;
  textContent: string | null;
  width: number;
  height: number;
  opacity: number;
  rotation?: number;
  zIndex?: number;
  cropX?: number;
  cropY?: number;
  cropWidth?: number | null;
  cropHeight?: number | null;
};

export function validateLayerInput(input: LayerInput): void {
  if (!isVisualLayerType(input.type)) {
    throw new VisualValidationError("Invalid layer type");
  }

  if (input.type === "MEDIA") {
    if (input.assetRef === null) {
      throw new VisualValidationError("A media layer requires an assetRef");
    }
    normalizeAssetRef(input.assetRef);
  }

  if (input.type === "TEXT" && (input.textContent ?? "").trim().length === 0) {
    throw new VisualValidationError("A text layer requires textContent");
  }

  if (
    !isFiniteNumber(input.width) ||
    !isFiniteNumber(input.height) ||
    input.width < LAYER_LIMITS.minSize ||
    input.height < LAYER_LIMITS.minSize ||
    input.width > LAYER_LIMITS.maxSize ||
    input.height > LAYER_LIMITS.maxSize
  ) {
    throw new VisualValidationError(
      `Layer width and height must be between ${LAYER_LIMITS.minSize} and ${LAYER_LIMITS.maxSize}`,
    );
  }

  if (
    !isFiniteNumber(input.opacity) ||
    input.opacity < 0 ||
    input.opacity > 1
  ) {
    throw new VisualValidationError("Layer opacity must be between 0 and 1");
  }

  if (
    input.rotation !== undefined &&
    (!isFiniteNumber(input.rotation) ||
      Math.abs(input.rotation) > LAYER_LIMITS.maxRotationDegrees)
  ) {
    throw new VisualValidationError(
      `Layer rotation must be between -${LAYER_LIMITS.maxRotationDegrees} and ${LAYER_LIMITS.maxRotationDegrees}`,
    );
  }

  if (input.zIndex !== undefined && !Number.isInteger(input.zIndex)) {
    throw new VisualValidationError("Layer zIndex must be an integer");
  }

  if (input.cropX !== undefined && (!isFiniteNumber(input.cropX) || input.cropX < 0)) {
    throw new VisualValidationError("cropX must be zero or greater");
  }

  if (input.cropY !== undefined && (!isFiniteNumber(input.cropY) || input.cropY < 0)) {
    throw new VisualValidationError("cropY must be zero or greater");
  }

  if (
    input.cropWidth !== undefined &&
    input.cropWidth !== null &&
    (!isFiniteNumber(input.cropWidth) || input.cropWidth <= 0)
  ) {
    throw new VisualValidationError("cropWidth must be greater than 0");
  }

  if (
    input.cropHeight !== undefined &&
    input.cropHeight !== null &&
    (!isFiniteNumber(input.cropHeight) || input.cropHeight <= 0)
  ) {
    throw new VisualValidationError("cropHeight must be greater than 0");
  }
}

export function validateEffectAmount(
  type: VisualEffectType,
  amount: number,
): void {
  if (!isVisualEffectType(type)) {
    throw new VisualValidationError("Invalid effect type");
  }

  if (!isFiniteNumber(amount) || amount < 0) {
    throw new VisualValidationError("Effect amount must be zero or greater");
  }

  if (type === "GRAYSCALE" && amount > 1) {
    throw new VisualValidationError(
      "Grayscale amount is a fraction between 0 and 1",
    );
  }

  if (type !== "GRAYSCALE" && amount > 10) {
    throw new VisualValidationError("Effect amount is out of range");
  }
}

export type KeyframeInput = {
  property: MotionProperty;
  timeMs: number;
  fromValue: number;
  toValue: number;
  easing: MotionEasing;
};

export function validateKeyframeInput(input: KeyframeInput): void {
  if (!isMotionProperty(input.property)) {
    throw new VisualValidationError("Invalid motion property");
  }

  if (!isMotionEasing(input.easing)) {
    throw new VisualValidationError("Invalid motion easing");
  }

  if (!Number.isInteger(input.timeMs) || input.timeMs < 0) {
    throw new VisualValidationError("Keyframe timeMs must be zero or greater");
  }

  if (!isFiniteNumber(input.fromValue) || !isFiniteNumber(input.toValue)) {
    throw new VisualValidationError("Keyframe values must be finite numbers");
  }

  if (input.property === "OPACITY") {
    for (const value of [input.fromValue, input.toValue]) {
      if (value < 0 || value > 1) {
        throw new VisualValidationError(
          "Opacity keyframe values must be between 0 and 1",
        );
      }
    }
  }
}
