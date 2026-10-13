import { EditorError } from "../errors";
import type { EditorRevisionSummary } from "../domain/types";
import {
  headOf,
  readRestoreLineage,
  revisionBefore,
  type RevisionHistory,
} from "./lineage";

export type UndoTarget = {
  /** The revision whose bytes the undo will restore. */
  target: EditorRevisionSummary;
  /** Where a further undo would step to once this one lands. */
  nextUndoPointer: string | null;
};

/**
 * Works out what undo means for the current head.
 *
 * Two rules, and they are different rules:
 *
 * - A plain edit is undone by the revision before it. That is derivable from the
 *   revision number, so no state is stored for it.
 * - A restore is undone by whatever it recorded. When the user undoes twice,
 *   the second step must reach the state *before* the first undo, not the state
 *   the first undo produced — which is why a restore carries its own pointer
 *   instead of relying on document order.
 */
export function computeUndoTarget(history: RevisionHistory): UndoTarget {
  const head = headOf(history);

  if (!head) {
    throw new EditorError("EDITOR_NO_UNDO", "There is no revision to undo");
  }

  const lineage = readRestoreLineage(head);

  if (lineage) {
    const pointer = lineage.undoPointerRevisionId;

    if (!pointer) {
      throw new EditorError(
        "EDITOR_NO_UNDO",
        "The earliest recorded revision is already in view",
      );
    }

    const target = history.revisions.find((revision) => revision.id === pointer);

    if (!target) {
      throw new EditorError(
        "EDITOR_NO_UNDO",
        "The revision this restore came from is no longer in the document's history",
      );
    }

    return { target, nextUndoPointer: nextUndoPointerOf(target, history) };
  }

  const previous = revisionBefore(history, head);

  if (!previous) {
    throw new EditorError(
      "EDITOR_NO_UNDO",
      "The earliest recorded revision is already in view",
    );
  }

  return { target: previous, nextUndoPointer: nextUndoPointerOf(previous, history) };
}

function nextUndoPointerOf(
  revision: EditorRevisionSummary,
  history: RevisionHistory,
): string | null {
  const lineage = readRestoreLineage(revision);
  if (lineage) return lineage.undoPointerRevisionId;
  return revisionBefore(history, revision)?.id ?? null;
}
