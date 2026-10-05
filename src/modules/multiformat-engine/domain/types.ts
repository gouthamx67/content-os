import type { ClaimStatus } from "../../writing-engine/domain/types";
import type { SceneGraphLayer } from "../../visual-motion-engine/serialization/scene-graph";
import type { VisualFitMode } from "../../visual-motion-engine/domain/types";

export const ADAPTATION_BATCH_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "PARTIAL",
  "FAILED",
  "CANCEL_REQUESTED",
  "CANCELLED",
] as const;
export type AdaptationBatchStatus = (typeof ADAPTATION_BATCH_STATUSES)[number];

export const ADAPTATION_JOB_STATUSES = [
  "QUEUED",
  "RUNNING",
  "WAITING_RENDER",
  "SUCCEEDED",
  "FAILED",
  "CANCEL_REQUESTED",
  "CANCELLED",
] as const;
export type AdaptationJobStatus = (typeof ADAPTATION_JOB_STATUSES)[number];

export const ADAPTATION_SOURCE_TYPES = [
  "WRITING_VARIANT",
  "GENERATED_IMAGE",
  "VISUAL_COMPOSITION",
] as const;
export type AdaptationSourceType = (typeof ADAPTATION_SOURCE_TYPES)[number];

export const ADAPTATION_KINDS = ["COPY", "IMAGE", "VIDEO"] as const;
export type AdaptationKind = (typeof ADAPTATION_KINDS)[number];

/**
 * A target may name no platform at all — "just give me the vertical cut".
 *
 * That is recorded as the empty string rather than a nullable column because a
 * job always has a destination of some kind, and `""` cannot collide with a real
 * CP09 platform id.
 */
export const NO_PLATFORM = "";

export type AdaptationBatchRecord = {
  id: string;
  projectId: string;
  requestedById: string;
  sourceType: AdaptationSourceType;
  sourceId: string;
  sourceSnapshot: string;
  sourceSha256: string;
  targetCount: number;
  status: AdaptationBatchStatus;
  progressPct: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type AdaptationJobRecord = {
  id: string;
  batchId: string;
  projectId: string;
  requestedById: string;
  platformId: string;
  formatId: string;
  kind: AdaptationKind;
  recipe: string;
  recipeSha256: string;
  status: AdaptationJobStatus;
  progressPct: number;
  outputText: string | null;
  outputMimeType: string | null;
  outputStorageKey: string | null;
  outputByteSize: number | null;
  outputChecksumSha256: string | null;
  outputWidth: number | null;
  outputHeight: number | null;
  renderJobId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

/** Where a raster inside a target rectangle sits when its aspect ratio differs. */
export type ImagePosition = "center";

/**
 * The server-owned contract for one output format.
 *
 * Dimensions, fit and limits live here and nowhere else: a client names a
 * `formatId`, never a width. That is what stops a request from inventing a
 * canvas the platform never asked for.
 */
export type FormatContract = {
  id: string;
  label: string;
  kind: AdaptationKind;
  image?: {
    mimeType: string;
    extension: "png" | "jpg";
    width: number;
    height: number;
    fit: VisualFitMode;
    position: ImagePosition;
    alpha: boolean;
  };
  copy?: {
    maxCharacters: number;
    maxWords: number;
  };
  video?: {
    width: number;
    height: number;
  };
};

export type ResolvedOutputContract = {
  formatId: string;
  kind: AdaptationKind;
  platformId: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  fit: VisualFitMode | null;
  position: ImagePosition | null;
  alpha: boolean | null;
  maxCharacters: number | null;
  maxWords: number | null;
};

export type SnapshotClaim = {
  text: string;
  status: ClaimStatus;
  /** CP06 `Source` ids only — never a variant, asset or batch id. */
  sourceIds: string[];
};

export type WritingSourceSnapshot = {
  sourceType: "WRITING_VARIANT";
  variantId: string;
  documentId: string;
  label: string;
  text: string;
  textSha256: string;
  claims: SnapshotClaim[];
};

export type GeneratedImageSourceSnapshot = {
  sourceType: "GENERATED_IMAGE";
  assetId: string;
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
  checksumSha256: string;
  transparent: boolean;
};

/**
 * The whole scene, not a frame of it.
 *
 * A video adaptation has to move every layer, so the snapshot carries the full
 * layer graph with its keyframes and effects. Anything less would silently drop
 * the animation when the aspect ratio changes.
 */
export type VisualCompositionSourceSnapshot = {
  sourceType: "VISUAL_COMPOSITION";
  compositionId: string;
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
  layers: SceneGraphLayer[];
};

export type AdaptationSourceSnapshot =
  | WritingSourceSnapshot
  | GeneratedImageSourceSnapshot
  | VisualCompositionSourceSnapshot;

export type AdaptationRecipe = {
  recipeVersion: number;
  formatId: string;
  kind: AdaptationKind;
  platformId: string | null;
  sourceType: AdaptationSourceType;
  sourceId: string;
  sourceSha256: string;
  output: {
    mimeType: string;
    width: number | null;
    height: number | null;
    fit: VisualFitMode | null;
    position: ImagePosition | null;
    maxCharacters: number | null;
    maxWords: number | null;
  };
  provenanceSourceIds: string[];
  outputStorageKey: string;
};

export type CopyAdaptation = {
  text: string;
  truncated: boolean;
  claims: SnapshotClaim[];
};

export type AdaptedCopyOutput = {
  outputText: string;
  outputChecksumSha256: string;
  provenanceSourceIds: string[];
  claims: SnapshotClaim[];
  truncated: boolean;
};

export type AdaptedImageOutput = {
  storageKey: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  width: number;
  height: number;
};

export function isAdaptationJobStatus(
  value: unknown,
): value is AdaptationJobStatus {
  return (
    typeof value === "string" &&
    (ADAPTATION_JOB_STATUSES as readonly string[]).includes(value)
  );
}