import { createHash } from "node:crypto";
import { stableStringify } from "../../video-rendering/serialization/stable-json";
import { EditorError } from "../errors";
import {
  EDITOR_DOCUMENT_VERSION,
  type EditorSnapshot,
} from "../domain/types";

/**
 * Canonical JSON for a whole editor snapshot.
 *
 * Nodes are sorted by `(parentId, zIndex, id)` before serialising so two
 * equivalent documents produce identical bytes. Without that, the same edit made
 * through two clients would hash differently and the revision log would claim a
 * difference that does not exist.
 *
 * `undefined` never reaches here: a field that is absent and a field that is
 * `null` are different states, so every optional is written explicitly.
 */
export function serializeSnapshot(snapshot: EditorSnapshot): string {
  return stableStringify(canonicalizeSnapshot(snapshot));
}

export function snapshotSha256(snapshot: EditorSnapshot): string {
  return sha256Hex(serializeSnapshot(snapshot));
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256")
    .update(typeof value === "string" ? Buffer.from(value, "utf8") : value)
    .digest("hex");
}

/**
 * The one order a snapshot is ever written or compared in.
 *
 * Root nodes first, then each group immediately before its children, so the
 * sorted list also reads as a valid creation order — which matters because a
 * restore replays nothing: it copies the list wholesale.
 */
export function canonicalizeSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  const nodes = [...snapshot.nodes].sort(compareNodesForSerialization);

  return {
    version: EDITOR_DOCUMENT_VERSION,
    documentId: snapshot.documentId,
    width: snapshot.width,
    height: snapshot.height,
    durationMs: snapshot.durationMs,
    frameRate: snapshot.frameRate,
    nodes: nodes.map((node) => ({
      id: node.id,
      parentId: node.parentId,
      type: node.type,
      name: node.name,
      zIndex: node.zIndex,
      transform: { ...node.transform },
      visible: node.visible,
      asset: node.asset ? { ...node.asset } : null,
      text: node.text ? { value: node.text.value } : null,
      style: { ...node.style },
      trim: node.trim ? { ...node.trim } : null,
      audio: node.audio ? { ...node.audio } : null,
      shape: node.shape ? { ...node.shape } : null,
      motion: node.motion
        ? {
            keyframes: [...node.motion.keyframes]
              .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id))
              .map((keyframe) => ({ ...keyframe })),
          }
        : null,
      effects: [...node.effects]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((effect) => ({ ...effect })),
      automation: [...node.automation]
        .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id))
        .map((point) => ({ ...point })),
      provenance: node.provenance
        ? {
            ...node.provenance,
            // Provenance is a set of grounding sources: two imports that found
            // the same sources in a different order are the same provenance.
            sourceIds: [...node.provenance.sourceIds].sort(),
          }
        : null,
    })),
  };
}

function compareNodesForSerialization(
  a: EditorSnapshot["nodes"][number],
  b: EditorSnapshot["nodes"][number],
): number {
  const parentOrder = (a.parentId ?? "").localeCompare(b.parentId ?? "");
  if (parentOrder !== 0) return parentOrder;
  if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
  return a.id.localeCompare(b.id);
}

/**
 * Parses a stored snapshot and refuses to guess.
 *
 * A snapshot that fails to parse is a corrupted revision, not a document to be
 * repaired: rewriting it would silently discard the user's history. The caller
 * gets a code and leaves the row alone.
 */
export function parseSnapshot(serialized: string): EditorSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new EditorError(
      "EDITOR_INVALID_OPERATION",
      "The stored snapshot is not valid JSON",
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new EditorError(
      "EDITOR_INVALID_OPERATION",
      "The stored snapshot is not an object",
    );
  }

  const snapshot = parsed as EditorSnapshot;
  if (snapshot.version !== EDITOR_DOCUMENT_VERSION) {
    throw new EditorError(
      "EDITOR_INVALID_OPERATION",
      `The stored snapshot has an unsupported version: ${String(snapshot.version)}`,
    );
  }

  if (!Array.isArray(snapshot.nodes)) {
    throw new EditorError(
      "EDITOR_INVALID_OPERATION",
      "The stored snapshot has no node list",
    );
  }

  return snapshot;
}

/**
 * Checks a snapshot against the hash recorded beside it.
 *
 * The hash is what makes a corrupted row detectable instead of merely wrong, so
 * a mismatch is reported rather than repaired.
 */
export function assertSnapshotIntegrity(
  snapshot: EditorSnapshot,
  expectedSha256: string,
): void {
  if (snapshotSha256(snapshot) !== expectedSha256) {
    throw new EditorError(
      "EDITOR_INVALID_OPERATION",
      "The stored snapshot does not match its recorded hash",
    );
  }
}

export function parseAndVerifySnapshot(
  serialized: string,
  expectedSha256: string,
): EditorSnapshot {
  const snapshot = parseSnapshot(serialized);
  assertSnapshotIntegrity(snapshot, expectedSha256);
  return snapshot;
}
