import type { EditorRevisionRecord, EditorRevisionSummary } from "../domain/types";

/**
 * How a revision was produced, recovered from its persisted payload.
 *
 * A RESTORE copies another revision's bytes, so the interesting question is not
 * "what does this revision contain" but "where was the user before and where can
 * they go next". Both answers live in the payload rather than in the caller,
 * because the browser is not a trustworthy place to keep a history pointer.
 */
export type RestoreDirection = "UNDO" | "REDO" | "EXPLICIT";

export type RestoreLineage = {
  direction: RestoreDirection;
  /** The revision whose bytes this one copied. */
  targetRevisionId: string;
  /** Where the next undo goes, or null when there is nothing left to undo. */
  undoPointerRevisionId: string | null;
  /** Where the next redo goes, or null when the redo chain is exhausted. */
  redoPointerRevisionId: string | null;
};

export function isRestoreRevision(
  revision: Pick<EditorRevisionRecord, "operationType">,
): boolean {
  return revision.operationType === "RESTORE";
}

/**
 * Reads the lineage off a restore revision.
 *
 * A restore whose payload cannot be read is treated as having no pointers at
 * all rather than throwing: the safest reading of a damaged pointer is that the
 * user has nothing further to step to, which refuses a move instead of inventing
 * one.
 */
export function readRestoreLineage(
  revision: Pick<EditorRevisionRecord, "operationType" | "operationPayload">,
): RestoreLineage | null {
  if (revision.operationType !== "RESTORE") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(revision.operationPayload);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const payload = parsed as Record<string, unknown>;
  const direction = payload["direction"];
  const targetRevisionId = payload["targetRevisionId"];

  if (
    (direction !== "UNDO" && direction !== "REDO" && direction !== "EXPLICIT") ||
    typeof targetRevisionId !== "string"
  ) {
    return null;
  }

  return {
    direction,
    targetRevisionId,
    undoPointerRevisionId: readPointer(payload, "undoPointerRevisionId"),
    redoPointerRevisionId: readPointer(payload, "redoPointerRevisionId"),
  };
}

function readPointer(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function serializeRestorePayload(lineage: RestoreLineage): string {
  return JSON.stringify({
    type: "RESTORE",
    direction: lineage.direction,
    targetRevisionId: lineage.targetRevisionId,
    undoPointerRevisionId: lineage.undoPointerRevisionId,
    redoPointerRevisionId: lineage.redoPointerRevisionId,
  });
}

export type RevisionHistory = {
  revisions: readonly EditorRevisionSummary[];
};

/**
 * Revisions arrive newest-first, which is the order a history panel shows them
 * in and the order a bounded scan needs: capping a scan keeps the head and its
 * immediate predecessors instead of keeping the oldest revisions nobody is about.
 */
export function headOf(history: RevisionHistory): EditorRevisionSummary | null {
  return history.revisions[0] ?? null;
}

export function findRevision(
  history: RevisionHistory,
  revisionId: string,
): EditorRevisionSummary | null {
  return history.revisions.find((revision) => revision.id === revisionId) ?? null;
}

/** The revision immediately older than `revision`. */
export function revisionBefore(
  history: RevisionHistory,
  revision: EditorRevisionSummary,
): EditorRevisionSummary | null {
  return history.revisions[indexOf(history, revision) + 1] ?? null;
}

/** The revision immediately newer than `revision`. */
export function revisionAfter(
  history: RevisionHistory,
  revision: EditorRevisionSummary,
): EditorRevisionSummary | null {
  const index = indexOf(history, revision);
  return index <= 0 ? null : history.revisions[index - 1];
}

function indexOf(history: RevisionHistory, revision: EditorRevisionSummary): number {
  return history.revisions.findIndex((candidate) => candidate.id === revision.id);
}
