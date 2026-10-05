import type { AdaptationSourceSnapshot } from "../domain/types";
import { sha256Hex } from "../serialization/hash-adaptation";
import {
  assertSourceTypeMatches,
  isGeneratedImageSource,
  isWritingSource,
} from "./source-resolver";
import { AdaptationError } from "../errors";

/**
 * Re-checks the live source against the frozen snapshot before anything is
 * adapted from it.
 *
 * A snapshot records what the source looked like when the request was made, not
 * what it looks like now. For copy and video the snapshot *is* the content, so
 * the only thing that can have gone wrong is substitution, and the snapshot
 * digest already covers it. For raster bytes the file itself can be replaced
 * under us, so the bytes are read and hashed again here: a mismatch fails the
 * job with a code the caller can act on rather than adapting an image that was
 * never reviewed.
 */
export async function verifySourceIntegrity(args: {
  projectId: string;
  snapshot: AdaptationSourceSnapshot;
  readSourceBytes: (input: {
    projectId: string;
    snapshot: AdaptationSourceSnapshot;
  }) => Promise<Buffer>;
}): Promise<void> {
  if (isWritingSource(args.snapshot)) {
    assertSourceTypeMatches(args.snapshot, "WRITING_VARIANT");

    if (sha256Hex(args.snapshot.text) !== args.snapshot.textSha256) {
      throw new AdaptationError(
        "ADAPTATION_SOURCE_CHANGED_SINCE_SNAPSHOT",
        "The snapshotted text no longer matches its digest",
        409,
      );
    }

    return;
  }

  if (isGeneratedImageSource(args.snapshot)) {
    assertSourceTypeMatches(args.snapshot, "GENERATED_IMAGE");

    const bytes = await args.readSourceBytes({
      projectId: args.projectId,
      snapshot: args.snapshot,
    });

    if (sha256Hex(bytes) !== args.snapshot.checksumSha256) {
      throw new AdaptationError(
        "ADAPTATION_SOURCE_CHANGED_SINCE_SNAPSHOT",
        "The source image on disk no longer matches the snapshotted checksum",
        409,
      );
    }

    return;
  }

  assertSourceTypeMatches(args.snapshot, "VISUAL_COMPOSITION");

  if (args.snapshot.width <= 0 || args.snapshot.height <= 0) {
    throw new AdaptationError(
      "ADAPTATION_SOURCE_CHANGED_SINCE_SNAPSHOT",
      "The snapshotted composition has no usable canvas",
      409,
    );
  }
}