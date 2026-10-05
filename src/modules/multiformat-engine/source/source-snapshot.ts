import { ADAPTATION_LIMITS } from "../limits";
import type { AdaptationSourceSnapshot } from "../domain/types";
import { sha256Hex } from "../serialization/hash-adaptation";
import { stableStringify } from "../../video-rendering/serialization/stable-json";
import { AdaptationError } from "../errors";
import { validateSnapshot } from "./validate-snapshot";

/**
 * Snapshots travel as text, so a malformed one has to fail loudly rather than
 * turn into a worker that adapts `undefined`.
 *
 * The digest is checked on the way in for the same reason: a snapshot that does
 * not match its recorded hash is either corrupt or tampered with, and both mean
 * the bytes we are about to adapt are not the bytes that were reviewed.
 */
export function serializeSourceSnapshot(
  snapshot: AdaptationSourceSnapshot,
): string {
  return stableStringify(snapshot);
}

export function hashSourceSnapshot(serialized: string): string {
  return sha256Hex(serialized);
}

export function parseSourceSnapshot(serialized: string): AdaptationSourceSnapshot {
  if (!serialized || serialized.length > ADAPTATION_LIMITS.maxSnapshotCharacters) {
    throw new AdaptationError(
      "ADAPTATION_OUTPUT_INVALID",
      "The stored adaptation snapshot is unusable",
      500,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new AdaptationError(
      "ADAPTATION_OUTPUT_INVALID",
      "The stored adaptation snapshot is not valid JSON",
      500,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AdaptationError(
      "ADAPTATION_OUTPUT_INVALID",
      "The stored adaptation snapshot is not an object",
      500,
    );
  }

  return validateSnapshot(parsed);
}

/**
 * Rejects a snapshot whose digest no longer matches its contents.
 *
 * The check is on read rather than only on write so a row edited outside this
 * engine cannot feed an adaptation bytes nobody verified.
 */
export function assertSnapshotIntegrity(args: {
  serialized: string;
  expectedSha256: string;
}): AdaptationSourceSnapshot {
  const snapshot = parseSourceSnapshot(args.serialized);

  if (hashSourceSnapshot(args.serialized) !== args.expectedSha256) {
    throw new AdaptationError(
      "ADAPTATION_SOURCE_CHANGED_SINCE_SNAPSHOT",
      "The stored adaptation snapshot no longer matches its digest",
      409,
    );
  }

  return snapshot;
}