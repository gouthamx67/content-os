import { HttpError } from "./http";
import { EditorError } from "../modules/editor-engine/errors";
import {
  assertOperationAllowedFromWire,
  validateOperation,
} from "../modules/editor-engine/operations/validate-operation";
import type { EditorOperation } from "../modules/editor-engine/domain/types";

/**
 * One error shape for every editor route.
 *
 * Editor errors carry their own HTTP status; everything else is either the
 * caller's session (401) or an unexpected server failure (500).
 */
export function editorErrorResponse(error: unknown): Response {
  if (error instanceof EditorError) {
    return Response.json(
      {
        error: error.message,
        code: error.code,
        ...error.extras,
      },
      { status: error.status },
    );
  }

  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  return Response.json({ error: "Request failed" }, { status: 500 });
}

/**
 * `validateOperation` is exported for the wire: the closed union is the contract
 * routes enforce, and asserting the wire rules here stops a hand-crafted body
 * from smuggling in a `RESTORE`.
 */
export function parseEditorOperation(value: unknown): EditorOperation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new EditorError(
      "EDITOR_INVALID_OPERATION",
      "Expected an editor operation object",
    );
  }
  const operation = validateOperation(value as Record<string, unknown>);
  assertOperationAllowedFromWire(operation);
  return operation;
}