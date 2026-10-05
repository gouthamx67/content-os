import type {
  AdaptationSourceSnapshot,
  GeneratedImageSourceSnapshot,
  VisualCompositionSourceSnapshot,
  WritingSourceSnapshot,
} from "../domain/types";
import { ADAPTATION_SOURCE_TYPES } from "../domain/types";
import { ADAPTATION_ERRORS, AdaptationError } from "../errors";

function fail(): never {
  throw new AdaptationError(
    "ADAPTATION_OUTPUT_INVALID",
    ADAPTATION_ERRORS.ADAPTATION_OUTPUT_INVALID,
    500,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  source: Record<string, unknown>,
  key: string,
): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) fail();
  return value;
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") fail();
  return value;
}

function requirePositiveNumber(
  source: Record<string, unknown>,
  key: string,
): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail();
  }
  return value;
}

function requireStringArray(
  source: Record<string, unknown>,
  key: string,
): string[] {
  const value = source[key];
  if (!Array.isArray(value)) fail();
  return value.map((entry) => {
    if (typeof entry !== "string") fail();
    return entry;
  });
}

function requireBoolean(
  source: Record<string, unknown>,
  key: string,
): boolean {
  const value = source[key];
  if (typeof value !== "boolean") fail();
  return value;
}

/**
 * The shape a snapshot must have before a worker is allowed to act on it.
 *
 * This is deliberately structural rather than exhaustive: it checks that the
 * fields the adapters read exist and are the right primitive type. A snapshot
 * that passes here can still be nonsense (a scene with no layers, say), which is
 * the adapter's job to refuse.
 */
export function validateSnapshot(value: unknown): AdaptationSourceSnapshot {
  if (!isRecord(value)) fail();

  const sourceType = value["sourceType"];
  if (
    typeof sourceType !== "string" ||
    !(ADAPTATION_SOURCE_TYPES as readonly string[]).includes(sourceType)
  ) {
    fail();
  }

  if (sourceType === "WRITING_VARIANT") {
    const claims = value["claims"];
    if (!Array.isArray(claims)) fail();

    return {
      sourceType,
      variantId: requireString(value, "variantId"),
      documentId: requireString(value, "documentId"),
      label: optionalString(value, "label") ?? "",
      text: requireString(value, "text"),
      textSha256: requireString(value, "textSha256"),
      claims: claims.map((claim) => {
        if (!isRecord(claim)) fail();
        const status = claim["status"];
        if (
          status !== "GROUNDED" &&
          status !== "UNSUPPORTED" &&
          status !== "REVIEW"
        ) {
          fail();
        }
        return {
          text: requireString(claim, "text"),
          status,
          sourceIds: requireStringArray(claim, "sourceIds"),
        };
      }),
    } satisfies WritingSourceSnapshot;
  }

  if (sourceType === "GENERATED_IMAGE") {
    return {
      sourceType,
      assetId: requireString(value, "assetId"),
      storageKey: requireString(value, "storageKey"),
      mimeType: requireString(value, "mimeType"),
      width: requirePositiveNumber(value, "width"),
      height: requirePositiveNumber(value, "height"),
      checksumSha256: requireString(value, "checksumSha256"),
      transparent: requireBoolean(value, "transparent"),
    } satisfies GeneratedImageSourceSnapshot;
  }

  const layers = value["layers"];
  if (!Array.isArray(layers)) fail();

  return {
    sourceType: "VISUAL_COMPOSITION",
    compositionId: requireString(value, "compositionId"),
    width: requirePositiveNumber(value, "width"),
    height: requirePositiveNumber(value, "height"),
    frameRate: requirePositiveNumber(value, "frameRate"),
    durationMs: requirePositiveNumber(value, "durationMs"),
    layers,
  } satisfies VisualCompositionSourceSnapshot;
}