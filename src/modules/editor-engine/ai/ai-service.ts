import { createId } from "../../../lib/id";
import { EditorError } from "../errors";
import type { EditorService, EditorDocumentDetail } from "../editor-service";
import type { WritingRepository } from "../../../core/ports/writing-repository";
import type { AIProvider } from "../../../core/ports/ai-provider";
import {
  assertOperationAllowedFromWire,
  validateOperation,
} from "../operations/validate-operation";
import { parseWritingContext } from "../../writing-engine/recipe/snapshot";
import { validateVariant } from "../../writing-engine/claims/validate-variant";
import type { WritingContext } from "../../writing-engine/domain/types";
import type {
  EditorNode,
  EditorOperation,
  EditorSnapshot,
} from "../domain/types";

export type EditorAIProviderKind = "LOCAL" | "REMOTE";

/**
 * What the server knows about an edited string's grounding.
 *
 * `NO_CONTEXT` means the node is not backed by a CP18 writing document, so there
 * is no fact set to check against; the edit is still allowed, but the client
 * sees that nothing was verified. `SUPPORTED` means the text passed the same
 * claim screen every generated variant passes.
 */
export type EditorAIGrounding = {
  status: "SUPPORTED" | "NO_CONTEXT";
  reason: string | null;
  claims: string[];
};

export type EditorAIProposal = {
  proposalId: string;
  baseRevision: string;
  summary: string;
  operation: EditorOperation;
  provider: EditorAIProviderKind;
  grounding: EditorAIGrounding;
};

export type EditorAIDeps = {
  editor: EditorService;
  writing: WritingRepository;
  /** A remote model is only reachable when a working provider is wired. */
  remote?: { provider: AIProvider } | null;
  newId?: (prefix: string) => string;
};

export type EditorAIProposeArgs = {
  projectId: string;
  documentId: string;
  userId: string;
  baseRevision: string;
  instructions: string;
  nodeId?: string | null;
  provider?: EditorAIProviderKind;
};

export type EditorAIApplyArgs = {
  projectId: string;
  documentId: string;
  userId: string;
  baseRevision: string;
  proposalId: string | null;
  operation: EditorOperation;
  provider?: EditorAIProviderKind;
};

/**
 * Propose → preview → explicit apply.
 *
 * A proposal never touches the document: `propose` only derives an operation and
 * screens it (validation, wire rules, grounding). Applying is a separate call
 * that re-runs the same screen against the current head, so a proposal accepted
 * on one revision cannot be pushed onto a document that moved underneath it —
 * that stale write returns the usual revision conflict like any other edit.
 */
export class EditorAIService {
  private readonly newId: (prefix: string) => string;

  constructor(private readonly deps: EditorAIDeps) {
    this.newId = deps.newId ?? createId;
  }

  async propose(args: EditorAIProposeArgs): Promise<EditorAIProposal> {
    const { snapshot } = await this.deps.editor.getDocument({
      projectId: args.projectId,
      documentId: args.documentId,
      userId: args.userId,
    });

    const target = args.nodeId
      ? findNode(snapshot, args.nodeId)
      : null;

    const provider = args.provider ?? "LOCAL";
    let operation: EditorOperation | null;
    if (provider === "REMOTE") {
      operation = await this.proposeRemote(args.instructions, target, snapshot);
    } else {
      operation = interpretLocal(args.instructions, target, snapshot, this.newId);
    }

    if (!operation) {
      throw new EditorError(
        "EDITOR_INVALID_OPERATION",
        "No usable edit could be derived from those instructions",
      );
    }

    const validated = validateOperation(operation);
    assertOperationAllowedFromWire(validated);

    const grounding = await this.evaluateGrounding({
      projectId: args.projectId,
      documentId: args.documentId,
      snapshot,
      target,
      operation: validated,
    });

    return {
      proposalId: this.newId("eprop"),
      baseRevision: args.baseRevision,
      summary: describe(validated, target),
      operation: validated,
      provider,
      grounding,
    };
  }

  async apply(args: EditorAIApplyArgs): Promise<EditorDocumentDetail> {
    const operation = validateOperation(args.operation);
    assertOperationAllowedFromWire(operation);

    const document = await this.deps.editor.getDocument({
      projectId: args.projectId,
      documentId: args.documentId,
      userId: args.userId,
    });

    const target =
      "nodeId" in operation
        ? findNode(document.snapshot, operation.nodeId)
        : null;

    await this.evaluateGrounding({
      projectId: args.projectId,
      documentId: args.documentId,
      snapshot: document.snapshot,
      target: target ?? null,
      operation,
    });

    return this.deps.editor.applyOperation({
      projectId: args.projectId,
      documentId: args.documentId,
      userId: args.userId,
      baseRevision: args.baseRevision,
      operation,
      sourceType: "AI",
      sourceId: args.proposalId,
      provenanceSourceIds: target?.provenance?.sourceIds ?? [],
    });
  }

  private async proposeRemote(
    instructions: string,
    target: EditorNode | null,
    snapshot: EditorSnapshot,
  ): Promise<EditorOperation | null> {
    if (!this.deps.remote) {
      throw new EditorError(
        "EDITOR_PROVIDER_UNAVAILABLE",
        "No remote editor model is configured",
      );
    }

    const targetLine = target
      ? `target node: ${target.type} "${target.name}" (${target.id})`
      : "no target node";
    const lines = snapshot.nodes
      .map((node) => `${node.type} ${node.id} "${node.name}"`)
      .slice(0, 40)
      .join("\n");

    let response: string;
    try {
      const result = await this.deps.remote.provider.generate({
        model: undefined,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You convert an editing request into exactly one JSON operation. " +
              "The only allowed operation objects are the union: " +
              '{"type":"SET_TEXT","nodeId":"...","value":"..."}, {"type":"MOVE","nodeId":"...","x":0,"y":0}, ' +
              '{"type":"RESIZE","nodeId":"...","width":0,"height":0}, {"type":"ROTATE","nodeId":"...","rotation":0}, ' +
              '{"type":"SET_OPACITY","nodeId":"...","opacity":0}, {"type":"SET_STYLE","nodeId":"...","style":{}}, ' +
              '{"type":"TRIM","nodeId":"...","startMs":0,"endMs":0}, {"type":"SET_GAIN","nodeId":"...","gainDb":0}, ' +
              '{"type":"SET_MUTE","nodeId":"...","muted":true}, {"type":"SET_VISIBILITY","nodeId":"...","visible":true}, ' +
              '{"type":"REORDER","nodeId":"...","zIndex":0}, {"type":"DUPLICATE","nodeId":"...","newNodeId":"..."}, ' +
              '{"type":"SPLIT","nodeId":"...","startMs":0}. Reply with only the JSON.',
          },
          {
            role: "user",
            content:
              `${targetLine}\n\ndocument nodes:\n${lines}\n\nrequest: ${instructions}`,
          },
        ],
      });
      response = typeof result.text === "string" ? result.text : "";
    } catch (error) {
      throw new EditorError(
        "EDITOR_PROVIDER_UNAVAILABLE",
        "The remote editor model failed to respond",
        { cause: error },
      );
    }

    return parseRemoteOperation(response);
  }

  private async evaluateGrounding(args: {
    projectId: string;
    documentId: string;
    snapshot: EditorSnapshot;
    target: EditorNode | null;
    operation: EditorOperation;
  }): Promise<EditorAIGrounding> {
    if (args.operation.type !== "SET_TEXT") {
      return { status: "NO_CONTEXT", reason: null, claims: [] };
    }

    const context = await this.resolveContext(args.projectId, args.target);

    if (!context) {
      return {
        status: "NO_CONTEXT",
        reason: "No grounded copy context is attached to this node",
        claims: [],
      };
    }

    const verdict = validateVariant(args.operation.value, context);
    if (verdict.accepted) {
      return {
        status: "SUPPORTED",
        reason: null,
        claims: verdict.claims.map((claim) => claim.text),
      };
    }

    throw new EditorError(
      "EDITOR_UNSUPPORTED_CLAIM",
      `The proposed text makes a claim the project cannot support: ${verdict.reason ?? "unknown"}`,
      { claims: verdict.claims.map((claim) => claim.text) },
    );
  }

  private async resolveContext(
    projectId: string,
    target: EditorNode | null,
  ): Promise<WritingContext | null> {
    if (!target?.provenance) return null;
    if (
      target.provenance.sourceType === "WRITING_VARIANT" &&
      target.provenance.sourceId
    ) {
      const document = await this.deps.writing.getDocumentByVariant(
        projectId,
        target.provenance.sourceId,
      );
      if (!document) return null;
      try {
        return parseWritingContext(document.contextSnapshot);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function findNode(snapshot: EditorSnapshot, nodeId: string): EditorNode {
  const node = snapshot.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new EditorError(
      "EDITOR_NODE_NOT_FOUND",
      `Node ${nodeId} is not in this document`,
    );
  }
  return node;
}

function parseRemoteOperation(value: string): EditorOperation | null {
  const trimmed = value.trim();
  const json = trimmed.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return validateOperation(JSON.parse(json));
  } catch {
    return null;
  }
}

function describe(
  operation: EditorOperation,
  target: EditorNode | null,
): string {
  const name = target ? `“${target.name}”` : "the target";
  switch (operation.type) {
    case "SET_TEXT":
      return `Reword ${name}`;
    case "MOVE":
      return `Move ${name} to (${operation.x}, ${operation.y})`;
    case "RESIZE":
      return `Resize ${name} to ${operation.width}×${operation.height}`;
    case "ROTATE":
      return `Rotate ${name} to ${operation.rotation}°`;
    case "SET_OPACITY":
      return `Set ${name} opacity to ${Math.round(operation.opacity * 100)}%`;
    case "SET_STYLE":
      return `Restyle ${name}`;
    case "TRIM":
      return `Trim ${name}`;
    case "SET_GAIN":
      return `Set ${name} gain to ${operation.gainDb} dB`;
    case "SET_MUTE":
      return operation.muted ? `Mute ${name}` : `Unmute ${name}`;
    case "SET_VISIBILITY":
      return operation.visible ? `Show ${name}` : `Hide ${name}`;
    case "REORDER":
      return `Reorder ${name}`;
    case "DUPLICATE":
      return `Duplicate ${name}`;
    case "DELETE":
      return `Delete ${name}`;
    case "SPLIT":
      return `Split ${name}`;
    case "CREATE":
      return "Create a node";
    case "REPLACE_ASSET":
      return `Swap the media on ${name}`;
    case "RESTORE":
      return "Restore a revision";
  }
}

/**
 * Deterministic local interpretation of a plain-English instruction.
 *
 * This is the editor counterpart of the writing engine's local-rules provider:
 * it understands a fixed vocabulary with no model involved, so the proposing
 * path works offline, deterministically and cheaply. Anything it cannot parse is
 * refused rather than guessed at.
 */
function interpretLocal(
  instructions: string,
  target: EditorNode | null,
  snapshot: EditorSnapshot,
  newId: (prefix: string) => string,
): EditorOperation | null {
  if (!target) {
    if (/duplicate/i.test(instructions)) return null;
    return null;
  }

  const text = instructions.trim();

  let match = /^trim to (\d+(?:\.\d+)?)\s*(?:sec|s|seconds)?$/i.exec(text);
  if (match) {
    const endMs = Math.round(parseFloat(match[1]!) * 1000);
    const source =
      target.asset?.durationMs ??
      (target.trim ? target.trim.endMs : snapshot.durationMs);
    return {
      type: "TRIM",
      nodeId: target.id,
      startMs: target.trim?.startMs ?? 0,
      endMs: Math.min(endMs, source),
    };
  }

  match = /^trim to (\d+(?:\.\d+)?)\s*s\s*-\s*(\d+(?:\.\d+)?)\s*s$/i.exec(text);
  if (match) {
    const startMs = Math.round(parseFloat(match[1]!) * 1000);
    const endMs = Math.round(parseFloat(match[2]!) * 1000);
    return { type: "TRIM", nodeId: target.id, startMs, endMs };
  }

  match = /^move (left|right|up|down) by (\d+(?:\.\d+)?)\s*px?$/i.exec(text);
  if (match) {
    const delta = parseFloat(match[2]!);
    const { x, y } = target.transform;
    switch (match[1]!.toLowerCase()) {
      case "left":
        return { type: "MOVE", nodeId: target.id, x: x - delta, y };
      case "right":
        return { type: "MOVE", nodeId: target.id, x: x + delta, y };
      case "up":
        return { type: "MOVE", nodeId: target.id, x, y: y - delta };
      case "down":
        return { type: "MOVE", nodeId: target.id, x, y: y + delta };
    }
  }

  match = /^resize to (\d+)x(\d+)$/i.exec(text);
  if (match) {
    return {
      type: "RESIZE",
      nodeId: target.id,
      width: parseInt(match[1]!, 10),
      height: parseInt(match[2]!, 10),
    };
  }

  match = /^rotate (to )?(-?\d+(?:\.\d+)?)\s*(?:degrees|deg|°)?$/i.exec(text);
  if (match) {
    return {
      type: "ROTATE",
      nodeId: target.id,
      rotation: parseFloat(match[2]!),
    };
  }

  match = /^set opacity to (\d+(?:\.\d+)?)(%|)$/i.exec(text);
  if (match) {
    const raw = parseFloat(match[1]!);
    const opacity = match[2] === "%" ? raw / 100 : raw;
    return { type: "SET_OPACITY", nodeId: target.id, opacity };
  }

  match = /^set gain to (-?\d+(?:\.\d+)?)\s*(db|dB)?$/i.exec(text);
  if (match) {
    return { type: "SET_GAIN", nodeId: target.id, gainDb: parseFloat(match[1]!) };
  }

  if (/^mute$/i.test(text)) {
    return { type: "SET_MUTE", nodeId: target.id, muted: true };
  }
  if (/^unmute$/i.test(text)) {
    return { type: "SET_MUTE", nodeId: target.id, muted: false };
  }
  if (/^hide$/i.test(text)) {
    return { type: "SET_VISIBILITY", nodeId: target.id, visible: false };
  }
  if (/^show$/i.test(text)) {
    return { type: "SET_VISIBILITY", nodeId: target.id, visible: true };
  }
  if (/^duplicate$/i.test(text)) {
    return { type: "DUPLICATE", nodeId: target.id, newNodeId: newId("enode") };
  }
  if (/^delete$/i.test(text)) {
    return { type: "DELETE", nodeId: target.id };
  }

  match = /^(?:set text to|change text to|reword to)\s+(.+?)\s*$/i.exec(text);
  if (match) {
    return {
      type: "SET_TEXT",
      nodeId: target.id,
      value: match[1]!.replace(/^["'“”]+|["'“”]+$/g, ""),
    };
  }

  match = /^set (font size|font family|bold|color|background) to (.+)$/i.exec(text);
  if (match) {
    const property = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    const style: Record<string, unknown> = {};
    if (property === "font size") {
      const size = /^(\d+)\s*px$/.exec(value);
      if (!size) return null;
      style["fontSize"] = parseInt(size[1]!, 10);
    } else if (property === "font family") {
      style["fontFamily"] = value;
    } else if (property === "bold") {
      style["fontWeight"] = value === "true" ? 700 : 400;
    } else if (property === "color") {
      style["color"] = value;
    } else if (property === "background") {
      style["backgroundColor"] = value;
    }
    return { type: "SET_STYLE", nodeId: target.id, style };
  }

  match = /^move to (front|back)$/i.exec(text);
  if (match) {
    const zIndex =
      match[1]!.toLowerCase() === "front"
        ? Math.max(...snapshot.nodes.map((node) => node.zIndex), 0)
        : 0;
    return { type: "REORDER", nodeId: target.id, zIndex };
  }

  match = /^split at (\d+(?:\.\d+)?)\s*(sec|s|seconds)?$/i.exec(text);
  if (match) {
    return {
      type: "SPLIT",
      nodeId: target.id,
      startMs: Math.round(parseFloat(match[1]!) * 1000),
    };
  }

  return null;
}