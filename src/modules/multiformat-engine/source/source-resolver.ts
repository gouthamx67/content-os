import type {
  AdaptationSourceSnapshot,
  AdaptationSourceType,
  GeneratedImageSourceSnapshot,
  VisualCompositionSourceSnapshot,
  WritingSourceSnapshot,
} from "../domain/types";
import { AdaptationError } from "../errors";

/**
 * How CP19 reaches the three canonical sources it adapts.
 *
 * Every method is project-scoped, so a correctly shaped id belonging to another
 * project resolves to nothing before any of it is read.
 */
export interface MultiFormatSourceResolver {
  /**
   * Freezes one canonical source as it exists right now.
   *
   * Called once, at batch creation: the returned snapshot is what the worker
   * adapts, so a later edit to the source cannot change an in-flight request.
   */
  resolve(args: {
    projectId: string;
    sourceType: AdaptationSourceType;
    sourceId: string;
  }): Promise<AdaptationSourceSnapshot>;

  /**
   * Reads the bytes a snapshotted source points at, after checking that they are
   * still the bytes the snapshot describes.
   *
   * Text and scenes are adapted from the snapshot itself; only raster bytes have
   * to come back off disk, and their digest is verified first.
   */
  readSourceBytes(args: {
    projectId: string;
    snapshot: AdaptationSourceSnapshot;
  }): Promise<Buffer>;
}

export function isWritingSource(
  snapshot: AdaptationSourceSnapshot,
): snapshot is WritingSourceSnapshot {
  return snapshot.sourceType === "WRITING_VARIANT";
}

export function isGeneratedImageSource(
  snapshot: AdaptationSourceSnapshot,
): snapshot is GeneratedImageSourceSnapshot {
  return snapshot.sourceType === "GENERATED_IMAGE";
}

export function isVisualCompositionSource(
  snapshot: AdaptationSourceSnapshot,
): snapshot is VisualCompositionSourceSnapshot {
  return snapshot.sourceType === "VISUAL_COMPOSITION";
}

export function assertSourceTypeMatches(
  snapshot: AdaptationSourceSnapshot,
  expected: AdaptationSourceType,
): void {
  if (snapshot.sourceType !== expected) {
    throw new AdaptationError(
      "ADAPTATION_SOURCE_TYPE_UNSUPPORTED",
      `Snapshot is a ${snapshot.sourceType}, not a ${expected}`,
      422,
    );
  }
}