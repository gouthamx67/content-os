/**
 * One error shape for every editor failure.
 *
 * The code is the contract a client branches on; the message is for a human.
 * Splitting them is what lets the UI say "someone else edited this" without
 * pattern-matching English.
 */
export const EDITOR_ERROR_CODES = [
  "EDITOR_DOCUMENT_NOT_FOUND",
  "EDITOR_DOCUMENT_DELETED",
  "EDITOR_REVISION_NOT_FOUND",
  "EDITOR_REVISION_CONFLICT",
  "EDITOR_INVALID_OPERATION",
  "EDITOR_NODE_NOT_FOUND",
  "EDITOR_NODE_TYPE_MISMATCH",
  "EDITOR_INVALID_ASSET_REFERENCE",
  "EDITOR_CROSS_PROJECT_ASSET",
  "EDITOR_ASSET_OWNERSHIP_UNKNOWN",
  "EDITOR_NO_UNDO",
  "EDITOR_NO_REDO",
  "EDITOR_DOCUMENT_LIMIT_EXCEEDED",
  "EDITOR_TEXT_LIMIT_EXCEEDED",
  "EDITOR_GROUP_LIMIT_EXCEEDED",
  "EDITOR_UNSUPPORTED_GROUP_TRANSFORM",
  "EDITOR_DOCUMENT_LOCKED",
  "EDITOR_PROVIDER_UNAVAILABLE",
  "EDITOR_UNSUPPORTED_CLAIM",
  "EDITOR_ASSET_UNAVAILABLE",
] as const;
export type EditorErrorCode = (typeof EDITOR_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<EditorErrorCode, number> = {
  EDITOR_DOCUMENT_NOT_FOUND: 404,
  EDITOR_DOCUMENT_DELETED: 410,
  EDITOR_REVISION_NOT_FOUND: 404,
  EDITOR_REVISION_CONFLICT: 409,
  EDITOR_INVALID_OPERATION: 400,
  EDITOR_NODE_NOT_FOUND: 404,
  EDITOR_NODE_TYPE_MISMATCH: 400,
  EDITOR_INVALID_ASSET_REFERENCE: 400,
  EDITOR_CROSS_PROJECT_ASSET: 403,
  EDITOR_ASSET_OWNERSHIP_UNKNOWN: 403,
  EDITOR_NO_UNDO: 409,
  EDITOR_NO_REDO: 409,
  EDITOR_DOCUMENT_LIMIT_EXCEEDED: 400,
  EDITOR_TEXT_LIMIT_EXCEEDED: 400,
  EDITOR_GROUP_LIMIT_EXCEEDED: 400,
  EDITOR_UNSUPPORTED_GROUP_TRANSFORM: 400,
  EDITOR_DOCUMENT_LOCKED: 409,
  EDITOR_PROVIDER_UNAVAILABLE: 501,
  EDITOR_UNSUPPORTED_CLAIM: 422,
  EDITOR_ASSET_UNAVAILABLE: 404,
};

export class EditorError extends Error {
  readonly code: EditorErrorCode;
  readonly status: number;
  readonly extras: Record<string, unknown>;

  constructor(
    code: EditorErrorCode,
    message: string,
    extras: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "EditorError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.extras = extras;
  }
}

export function isEditorError(error: unknown): error is EditorError {
  return error instanceof EditorError;
}
