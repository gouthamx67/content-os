import { EditorError } from "../errors";
import type { EditorRevisionSummary } from "../domain/types";
import { headOf, readRestoreLineage, type RevisionHistory } from "./lineage";

export type RedoTarget = {
  /** The revision whose bytes the redo will restore. */
  target: EditorRevisionSummary;
  /** Where a further undo would step to once the redo lands. */
  nextUndoPointer: string;
  /**
   * Where a second redo would step to. Unchanged by this step: the redo chain is
   * walked one entry per redo, so it has to survive onto the new revision.
   */
  nextRedoPointer: string | null;
};

/**
 * Works out what redo means for the current head.
 *
 * Only a restore can be redone. An ordinary edit has nothing ahead of it, and an
 * explicit "restore this version" deliberately drops the forward chain: the user
 * asked to go to that state, not to resume an abandoned branch. Because each
 * redo re-points at the same forward chain, stepping forward twice walks the
 * chain rather than sticking on its first entry.
 */
export function computeRedoTarget(history: RevisionHistory): RedoTarget {
  const head = headOf(history);

  if (!head) {
    throw new EditorError("EDITOR_NO_REDO", "There is no revision to redo");
  }

  const lineage = readRestoreLineage(head);

  if (!lineage) {
    throw new EditorError(
      "EDITOR_NO_REDO",
      "Nothing has been undone from this document",
    );
  }

  const pointer = lineage.redoPointerRevisionId;

  if (!pointer) {
    throw new EditorError(
      "EDITOR_NO_REDO",
      "The redo chain has been exhausted",
    );
  }

  const target = history.revisions.find((revision) => revision.id === pointer);

  if (!target) {
    throw new EditorError(
      "EDITOR_NO_REDO",
      "The revision to redo is no longer in the document's history",
    );
  }

  // Undoing after a redo walks back to where the redo started, which is the
  // revision the redo was taken from.
  return {
    target,
    nextUndoPointer: head.id,
    nextRedoPointer: lineage.redoPointerRevisionId,
  };
}
