import { EditorError } from "../errors";
import {
  EDITOR_OPERATION_TYPES,
  type EditorNode,
  type EditorOperation,
} from "../domain/types";
import { EDITOR_LIMITS, parseStyleInput } from "../domain/validation";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function invalid(message: string): EditorError {
  return new EditorError("EDITOR_INVALID_OPERATION", message);
}

function requireNodeId(value: unknown, operation: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(`${operation} requires a nodeId`);
  }
  return value;
}

function requireNumber(value: unknown, operation: string): number {
  if (!isFiniteNumber(value)) {
    throw invalid(`${operation} requires a finite number`);
  }
  return value;
}

function requireRange(
  value: unknown,
  operation: string,
  field: string,
  min: number,
  max: number,
): number {
  const number = requireNumber(value, operation);

  if (number < min || number > max) {
    throw invalid(
      `${operation} ${field} must sit between ${min} and ${max}`,
    );
  }

  return number;
}

/**
 * Validates an operation arriving from a request body.
 *
 * This is a wire check, not a semantic one: it confirms the request names a
 * known operation and that the fields that operation requires are the right
 * primitive types. Whether the node exists, is the right type, and can legally
 * take this change is `applyOperation`'s job, run server-side against the real
 * snapshot.
 */
export function validateOperation(value: unknown): EditorOperation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid("An operation must be an object");
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate["type"] !== "string") {
    throw invalid("An operation must name a type");
  }

  const type = candidate["type"];

  if (!(EDITOR_OPERATION_TYPES as readonly string[]).includes(type)) {
    throw invalid(`Unknown operation type: ${type}`);
  }

  switch (type) {
    case "CREATE": {
      const node = candidate["node"];
      if (typeof node !== "object" || node === null || Array.isArray(node)) {
        throw invalid("CREATE requires a node object");
      }
      return { type: "CREATE", node: node as EditorNode };
    }

    case "SET_TEXT": {
      const value = candidate["value"];
      if (typeof value !== "string") {
        throw invalid("SET_TEXT requires a string value");
      }
      // A paste limit is enforced here as well as in the snapshot, so an
      // oversized body is refused before it is copied into the reducer.
      if (value.length > EDITOR_LIMITS.maxTextLength) {
        throw invalid(
          `SET_TEXT accepts at most ${EDITOR_LIMITS.maxTextLength.toLocaleString("en-US")} characters`,
        );
      }
      return {
        type: "SET_TEXT",
        nodeId: requireNodeId(candidate["nodeId"], type),
        value,
      };
    }

    case "REPLACE_ASSET": {
      const asset = candidate["asset"];
      if (typeof asset !== "object" || asset === null || Array.isArray(asset)) {
        throw invalid("REPLACE_ASSET requires an asset object");
      }
      return {
        type: "REPLACE_ASSET",
        nodeId: requireNodeId(candidate["nodeId"], type),
        asset: asset as never,
      };
    }

    case "MOVE":
      return {
        type: "MOVE",
        nodeId: requireNodeId(candidate["nodeId"], type),
        x: requireNumber(candidate["x"], type),
        y: requireNumber(candidate["y"], type),
      };

    case "RESIZE":
      return {
        type: "RESIZE",
        nodeId: requireNodeId(candidate["nodeId"], type),
        width: requireRange(
          candidate["width"],
          type,
          "width",
          EDITOR_LIMITS.minDimensionPx,
          EDITOR_LIMITS.maxDimensionPx,
        ),
        height: requireRange(
          candidate["height"],
          type,
          "height",
          EDITOR_LIMITS.minDimensionPx,
          EDITOR_LIMITS.maxDimensionPx,
        ),
      };

    case "ROTATE":
      return {
        type: "ROTATE",
        nodeId: requireNodeId(candidate["nodeId"], type),
        rotation: requireNumber(candidate["rotation"], type),
      };

    case "SET_OPACITY":
      return {
        type: "SET_OPACITY",
        nodeId: requireNodeId(candidate["nodeId"], type),
        opacity: requireRange(candidate["opacity"], type, "opacity", 0, 1),
      };

    case "SET_STYLE": {
      // A validated subset of the controlled style fields: unknown fields and
      // mistyped values are refused here rather than merged into the node.
      const style = parseStyleInput(candidate["style"]);
      return {
        type: "SET_STYLE",
        nodeId: requireNodeId(candidate["nodeId"], type),
        style,
      };
    }

    case "TRIM":
      return {
        type: "TRIM",
        nodeId: requireNodeId(candidate["nodeId"], type),
        startMs: requireRange(
          candidate["startMs"],
          type,
          "startMs",
          0,
          EDITOR_LIMITS.maxDurationMs,
        ),
        endMs: requireRange(
          candidate["endMs"],
          type,
          "endMs",
          0,
          EDITOR_LIMITS.maxDurationMs,
        ),
      };

    case "SET_GAIN":
      return {
        type: "SET_GAIN",
        nodeId: requireNodeId(candidate["nodeId"], type),
        gainDb: requireRange(
          candidate["gainDb"],
          type,
          "gainDb",
          EDITOR_LIMITS.minGainDb,
          EDITOR_LIMITS.maxGainDb,
        ),
      };

    case "SET_MUTE": {
      const muted = candidate["muted"];
      if (typeof muted !== "boolean") {
        throw invalid("SET_MUTE requires a boolean muted value");
      }
      return {
        type: "SET_MUTE",
        nodeId: requireNodeId(candidate["nodeId"], type),
        muted,
      };
    }

    case "SET_VISIBILITY": {
      const visible = candidate["visible"];
      if (typeof visible !== "boolean") {
        throw invalid("SET_VISIBILITY requires a boolean visible value");
      }
      return {
        type: "SET_VISIBILITY",
        nodeId: requireNodeId(candidate["nodeId"], type),
        visible,
      };
    }

    case "REORDER": {
      const parentId = candidate["parentId"];
      if (parentId !== undefined && parentId !== null && typeof parentId !== "string") {
        throw invalid("REORDER parentId must be a string, null or absent");
      }
      return {
        type: "REORDER",
        nodeId: requireNodeId(candidate["nodeId"], type),
        zIndex: requireNumber(candidate["zIndex"], type),
        parentId: (parentId ?? null) as string | null,
      };
    }

    case "DUPLICATE": {
      const newNodeId = requireNodeId(candidate["newNodeId"], type);
      return {
        type: "DUPLICATE",
        nodeId: requireNodeId(candidate["nodeId"], type),
        newNodeId,
      };
    }

    case "DELETE":
      return { type: "DELETE", nodeId: requireNodeId(candidate["nodeId"], type) };

    case "SPLIT": {
      const endMs = candidate["endMs"];
      const newNodeIds = candidate["newNodeIds"];
      if (endMs !== undefined && !isFiniteNumber(endMs)) {
        throw invalid("SPLIT endMs must be a finite number when present");
      }
      if (
        newNodeIds !== undefined &&
        (!Array.isArray(newNodeIds) ||
          newNodeIds.some((id) => typeof id !== "string" || id.length === 0))
      ) {
        throw invalid("SPLIT newNodeIds must be a list of node ids");
      }
      return {
        type: "SPLIT",
        nodeId: requireNodeId(candidate["nodeId"], type),
        startMs: requireNumber(candidate["startMs"], type),
        endMs: endMs as number | undefined,
        newNodeIds: newNodeIds as string[] | undefined,
      };
    }

    case "RESTORE":
      return {
        type: "RESTORE",
        targetRevisionId: requireNodeId(
          candidate["targetRevisionId"],
          type,
        ),
      };

    default:
      throw invalid(`Unknown operation type: ${String(type)}`);
  }
}

/**
 * Rejects a RESTORE aimed at a revision rather than letting it through.
 *
 * Undo and redo are not operations a client may submit directly: they are
 * server decisions about the branch the document is on. Accepting a bare
 * RESTORE from the wire would let a caller rewrite history to any revision
 * number they liked, so only the service may build one.
 */
export function assertOperationAllowedFromWire(
  operation: EditorOperation,
): void {
  if (operation.type === "RESTORE") {
    throw invalid("RESTORE may only be produced by undo, redo or an explicit restore");
  }
}
