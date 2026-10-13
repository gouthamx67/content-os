import { EditorError } from "../errors";
import {
  assertAssetMetadataPlausible,
  assertAssetSupportsNodeType,
} from "../assets/asset-ref";
import {
  EDITOR_AUDIO_AUTOMATION_TARGETS,
  EDITOR_EFFECT_TYPES,
  EDITOR_MOTION_EASINGS,
  EDITOR_MOTION_PROPERTIES,
  EDITOR_NODE_TYPES,
  EDITOR_PROVENANCE_ORIGINS,
  EDITOR_SHAPE_TYPES,
  EDITOR_TEXT_ALIGNMENTS,
  isMediaNodeType,
  type EditorMotionKeyframe,
  type EditorNode,
  type EditorNodeStyle,
  type EditorSnapshot,
} from "./types";

/**
 * The bounds the editor will hold.
 *
 * These exist so a bad request fails with a code the UI understands instead of
 * writing a document that no later checkpoint can render. The numbers are the
 * ceiling for a single stage a person edits by hand, not a quota.
 */
export const EDITOR_LIMITS = {
  maxNodesPerDocument: 500,
  maxTextLength: 30_000,
  minDimensionPx: 1,
  maxGroupChildren: 200,
  maxDimensionPx: 4096,
  maxDurationMs: 600_000,
  maxGainDb: 24,
  minGainDb: -60,
  maxNameLength: 120,
} as const;

function fail(
  code:
    | "EDITOR_DOCUMENT_LIMIT_EXCEEDED"
    | "EDITOR_TEXT_LIMIT_EXCEEDED"
    | "EDITOR_GROUP_LIMIT_EXCEEDED"
    | "EDITOR_INVALID_OPERATION"
    | "EDITOR_NODE_TYPE_MISMATCH",
  message: string,
): never {
  throw new EditorError(code, message);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateTransform(node: EditorNode): void {
  const { transform } = node;

  for (const key of [
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "opacity",
  ] as const) {
    if (!isFiniteNumber(transform[key])) {
      fail("EDITOR_INVALID_OPERATION", `Node ${node.id} has a non-numeric ${key}`);
    }
  }

  if (transform.width <= 0 || transform.height <= 0) {
    fail("EDITOR_INVALID_OPERATION", `Node ${node.id} must have a positive size`);
  }

  if (
    transform.width > EDITOR_LIMITS.maxDimensionPx ||
    transform.height > EDITOR_LIMITS.maxDimensionPx
  ) {
    fail(
      "EDITOR_DOCUMENT_LIMIT_EXCEEDED",
      `Node ${node.id} exceeds the ${EDITOR_LIMITS.maxDimensionPx}px dimension limit`,
    );
  }

  if (transform.opacity < 0 || transform.opacity > 1) {
    fail(
      "EDITOR_INVALID_OPERATION",
      `Node ${node.id} opacity must be between 0 and 1`,
    );
  }
}

/**
 * Enforces the shape each node type promises.
 *
 * The rule is that a node's type decides which payloads may exist: a `TEXT` node
 * always carries text, a media node always carries an asset of the matching
 * kind, and a `GROUP` never carries either. A node that breaks its own contract
 * would reach CP15 or CP16 as a null dereference, so it is refused here.
 */
export function validateNodeShape(node: EditorNode): void {
  if (typeof node.id !== "string" || node.id.length === 0) {
    fail("EDITOR_INVALID_OPERATION", "A node must have a non-empty string id");
  }

  if (!(EDITOR_NODE_TYPES as readonly string[]).includes(node.type)) {
    fail("EDITOR_NODE_TYPE_MISMATCH", `Unknown node type: ${String(node.type)}`);
  }

  if (typeof node.name !== "string") {
    fail("EDITOR_INVALID_OPERATION", `Node ${node.id} name must be text`);
  }

  if (node.name.length > EDITOR_LIMITS.maxNameLength) {
    fail(
      "EDITOR_DOCUMENT_LIMIT_EXCEEDED",
      `Node ${node.id} name exceeds ${EDITOR_LIMITS.maxNameLength} characters`,
    );
  }

  if (typeof node.visible !== "boolean") {
    fail("EDITOR_INVALID_OPERATION", `Node ${node.id} visibility must be true or false`);
  }

  if (node.parentId !== null && typeof node.parentId !== "string") {
    fail("EDITOR_INVALID_OPERATION", `Node ${node.id} parent must be an id or empty`);
  }

  if (!Number.isInteger(node.zIndex) || node.zIndex < 0) {
    fail(
      "EDITOR_INVALID_OPERATION",
      `Node ${node.id} must have a non-negative integer zIndex`,
    );
  }

  if (!isPlainObject(node.transform)) {
    fail("EDITOR_INVALID_OPERATION", `Node ${node.id} has no transform`);
  }

  validateTransform(node);

  if (node.text !== null && !isPlainObject(node.text)) {
    fail("EDITOR_INVALID_OPERATION", `Node ${node.id} text must be an object or empty`);
  }

  if (node.text !== null && typeof node.text.value !== "string") {
    fail("EDITOR_INVALID_OPERATION", `Node ${node.id} text must be a string`);
  }

  if (node.text !== null && node.text.value.length > EDITOR_LIMITS.maxTextLength) {
    fail(
      "EDITOR_TEXT_LIMIT_EXCEEDED",
      `Node ${node.id} exceeds ${EDITOR_LIMITS.maxTextLength} characters`,
    );
  }

  if (node.motion !== null) {
    if (!isPlainObject(node.motion) || !Array.isArray(node.motion.keyframes)) {
      fail("EDITOR_INVALID_OPERATION", `Node ${node.id} motion must carry a keyframe list`);
    }
  }

  if (!Array.isArray(node.effects)) {
    fail("EDITOR_INVALID_OPERATION", `Node ${node.id} effects must be a list`);
  }

  if (!Array.isArray(node.automation)) {
    fail("EDITOR_INVALID_OPERATION", `Node ${node.id} automation must be a list`);
  }

  if (node.provenance !== null) {
    if (
      !isPlainObject(node.provenance) ||
      !isProvenanceOrigin(node.provenance.origin) ||
      typeof node.provenance.sourceType !== "string" ||
      (node.provenance.sourceId !== null &&
        typeof node.provenance.sourceId !== "string") ||
      !Array.isArray(node.provenance.sourceIds) ||
      node.provenance.sourceIds.some((id) => typeof id !== "string") ||
      (node.provenance.label !== null && typeof node.provenance.label !== "string")
    ) {
      fail("EDITOR_INVALID_OPERATION", `Node ${node.id} has malformed provenance`);
    }
  }

  switch (node.type) {
    case "TEXT":
      if (!node.text) {
        fail("EDITOR_NODE_TYPE_MISMATCH", `Text node ${node.id} has no text`);
      }
      if (node.asset || node.shape) {
        fail(
          "EDITOR_NODE_TYPE_MISMATCH",
          `Text node ${node.id} cannot carry an asset or a shape`,
        );
      }
      break;

    case "IMAGE":
    case "VIDEO":
    case "AUDIO":
      if (!node.asset) {
        fail("EDITOR_NODE_TYPE_MISMATCH", `Media node ${node.id} has no asset`);
      }
      if (node.asset.kind !== node.type) {
        fail(
          "EDITOR_NODE_TYPE_MISMATCH",
          `Node ${node.id} is a ${node.type} node but its asset is ${node.asset.kind}`,
        );
      }
      if (node.text || node.shape) {
        fail(
          "EDITOR_NODE_TYPE_MISMATCH",
          `Media node ${node.id} cannot carry text or a shape`,
        );
      }
      // A ref that could not have come from a real artifact would render as a
      // broken frame later, where the cause is no longer visible.
      assertAssetSupportsNodeType(node.asset.ref, node.type);
      assertAssetMetadataPlausible(node.asset);
      break;

    case "SHAPE":
      if (!node.shape) {
        fail("EDITOR_NODE_TYPE_MISMATCH", `Shape node ${node.id} has no shape`);
      }
      if (!(EDITOR_SHAPE_TYPES as readonly string[]).includes(node.shape.shapeType)) {
        fail("EDITOR_NODE_TYPE_MISMATCH", `Shape node ${node.id} has an unknown shape type`);
      }
      if (node.asset || node.text) {
        fail(
          "EDITOR_NODE_TYPE_MISMATCH",
          `Shape node ${node.id} cannot carry an asset or text`,
        );
      }
      break;

    case "GROUP":
      if (node.asset || node.text || node.shape) {
        fail(
          "EDITOR_NODE_TYPE_MISMATCH",
          `Group ${node.id} cannot carry an asset, text or shape`,
        );
      }
      break;
  }

  // Audio settings are the audio node's own surface. A track is never a property
  // of a text or image node, and an audio node without settings has no gain,
  // pan or fades for SET_GAIN and SET_MUTE to change.
  if (node.type === "AUDIO") {
    if (!node.audio) {
      fail("EDITOR_NODE_TYPE_MISMATCH", `Audio node ${node.id} has no audio settings`);
    }
  } else if (node.audio) {
    fail("EDITOR_NODE_TYPE_MISMATCH", `Node ${node.id} is a ${node.type} and cannot carry audio settings`);
  }

  // Only video and audio carry a playable window; a trim on anything else would
  // be stored and then silently ignored by playback.
  if (node.trim !== null && node.type !== "VIDEO" && node.type !== "AUDIO") {
    fail("EDITOR_NODE_TYPE_MISMATCH", `Node ${node.id} is a ${node.type} and cannot be trimmed`);
  }

  if (node.audio) {
    if (typeof node.audio.muted !== "boolean" || typeof node.audio.solo !== "boolean") {
      fail("EDITOR_INVALID_OPERATION", `Node ${node.id} audio flags must be true or false`);
    }
    if (
      !isFiniteNumber(node.audio.gainDb) ||
      node.audio.gainDb > EDITOR_LIMITS.maxGainDb ||
      node.audio.gainDb < EDITOR_LIMITS.minGainDb
    ) {
      fail(
        "EDITOR_INVALID_OPERATION",
        `Node ${node.id} gain must sit between ${EDITOR_LIMITS.minGainDb} and ${EDITOR_LIMITS.maxGainDb} dB`,
      );
    }
    if (
      !isFiniteNumber(node.audio.pan) ||
      node.audio.pan < -1 ||
      node.audio.pan > 1
    ) {
      fail(
        "EDITOR_INVALID_OPERATION",
        `Node ${node.id} pan must sit between -1 and 1`,
      );
    }
    for (const [label, value] of [
      ["fade-in", node.audio.fadeInMs],
      ["fade-out", node.audio.fadeOutMs],
      ["source offset", node.audio.sourceOffsetMs],
    ] as const) {
      if (!isFiniteNumber(value) || value < 0) {
        fail(
          "EDITOR_INVALID_OPERATION",
          `Node ${node.id} ${label} cannot be negative`,
        );
      }
    }
    if (
      node.audio.duckVoiceoverDb !== null &&
      (!isFiniteNumber(node.audio.duckVoiceoverDb) ||
        node.audio.duckVoiceoverDb > 0)
    ) {
      fail(
        "EDITOR_INVALID_OPERATION",
        `Node ${node.id} ducking must null or below 0dB`,
      );
    }
  }

  if (node.trim) {
    const { startMs, endMs } = node.trim;
    if (!isFiniteNumber(startMs) || !isFiniteNumber(endMs)) {
      fail("EDITOR_INVALID_OPERATION", `Node ${node.id} has a non-numeric trim`);
    }
    if (startMs < 0 || endMs <= startMs) {
      fail(
        "EDITOR_INVALID_OPERATION",
        `Node ${node.id} trim must be a forward window starting at or after 0`,
      );
    }
    if (endMs > EDITOR_LIMITS.maxDurationMs) {
      fail(
        "EDITOR_DOCUMENT_LIMIT_EXCEEDED",
        `Node ${node.id} trim exceeds the maximum duration`,
      );
    }
  }

  for (const keyframe of node.motion?.keyframes ?? []) {
    validateKeyframe(node.id, keyframe);
  }

  for (const effect of node.effects ?? []) {
    if (
      !EDITOR_EFFECT_TYPES.includes(effect.type) ||
      typeof effect.enabled !== "boolean" ||
      !isFiniteNumber(effect.amount) ||
      effect.amount < 0 ||
      effect.amount > 1
    ) {
      fail(
        "EDITOR_INVALID_OPERATION",
        `Node ${node.id} has an invalid effect`,
      );
    }
  }

  for (const point of node.automation ?? []) {
    if (
      !EDITOR_AUDIO_AUTOMATION_TARGETS.includes(point.type) ||
      !EDITOR_MOTION_EASINGS.includes(point.easing) ||
      !isFiniteNumber(point.timeMs) ||
      point.timeMs < 0 ||
      point.timeMs > EDITOR_LIMITS.maxDurationMs
    ) {
      fail(
        "EDITOR_INVALID_OPERATION",
        `Node ${node.id} has an invalid automation point`,
      );
    }
    if (
      point.type === "VOLUME_DB" &&
      (!isFiniteNumber(point.value) ||
        point.value > EDITOR_LIMITS.maxGainDb ||
        point.value < EDITOR_LIMITS.minGainDb)
    ) {
      fail(
        "EDITOR_INVALID_OPERATION",
        `Node ${node.id} automation must sit within the gain range`,
      );
    }
  }
}

function validateKeyframe(nodeId: string, keyframe: EditorMotionKeyframe): void {
  if (
    !EDITOR_MOTION_PROPERTIES.includes(keyframe.property) ||
    !EDITOR_MOTION_EASINGS.includes(keyframe.easing)
  ) {
    fail(
      "EDITOR_INVALID_OPERATION",
      `Node ${nodeId} has a keyframe with an unknown property or easing`,
    );
  }

  if (
    !isFiniteNumber(keyframe.timeMs) ||
    keyframe.timeMs < 0 ||
    keyframe.timeMs > EDITOR_LIMITS.maxDurationMs ||
    !isFiniteNumber(keyframe.fromValue) ||
    !isFiniteNumber(keyframe.toValue)
  ) {
    fail("EDITOR_INVALID_OPERATION", `Node ${nodeId} has an out-of-range keyframe`);
  }
}

/**
 * The only style fields the editor accepts.
 *
 * SET_STYLE is a public endpoint, so "a partial object" is not enough: an
 * unknown key or a string where a number belongs would otherwise be spread into
 * the node and persisted into the canonical bytes. The allowlist is the one
 * place that decides what a style field may be.
 */
const STYLE_FIELDS = [
  "fontSize",
  "fontFamily",
  "fontWeight",
  "color",
  "backgroundColor",
  "align",
  "radius",
] as const;

/**
 * Validates one style field and returns it unchanged.
 *
 * Null clears a field, so it is always legal; anything else must match the field
 * exactly. A wrong type is refused rather than coerced so a client cannot store
 * a value the renderer would later misread.
 */
function validateStyleField(field: string, value: unknown): unknown {
  if (value === null) return null;

  switch (field) {
    case "fontSize":
      if (!isFiniteNumber(value) || value <= 0 || value > 512) {
        fail("EDITOR_INVALID_OPERATION", "Font size must sit between 1 and 512");
      }
      return value;
    case "fontWeight":
      if (!isFiniteNumber(value) || value <= 0) {
        fail("EDITOR_INVALID_OPERATION", "Font weight must be a positive number");
      }
      return value;
    case "radius":
      if (!isFiniteNumber(value) || value < 0) {
        fail("EDITOR_INVALID_OPERATION", "Corner radius cannot be negative");
      }
      return value;
    case "fontFamily":
    case "color":
    case "backgroundColor":
      if (typeof value !== "string" || value.length === 0 || value.length > 256) {
        fail("EDITOR_INVALID_OPERATION", `Style field ${field} must be a short non-empty string`);
      }
      return value;
    case "align":
      if (!(EDITOR_TEXT_ALIGNMENTS as readonly string[]).includes(value as string)) {
        fail("EDITOR_INVALID_OPERATION", "Unknown text alignment");
      }
      return value;
    default:
      fail("EDITOR_INVALID_OPERATION", `Unknown style field: ${field}`);
  }
}

/**
 * Validates a SET_STYLE payload, which is a partial style.
 *
 * Unknown fields are refused rather than copied through: the reducer merges this
 * into the node's style, so anything it accepts becomes part of the document.
 */
export function parseStyleInput(value: unknown): Partial<EditorNodeStyle> {
  if (!isPlainObject(value)) {
    fail("EDITOR_INVALID_OPERATION", "SET_STYLE requires a style object");
  }

  const style: Partial<EditorNodeStyle> = {};
  for (const key of Object.keys(value)) {
    if (!(STYLE_FIELDS as readonly string[]).includes(key)) {
      fail("EDITOR_INVALID_OPERATION", `Unknown style field: ${key}`);
    }
    (style as Record<string, unknown>)[key] = validateStyleField(key, value[key]);
  }

  return style;
}

function validateStyle(style: EditorNodeStyle): void {
  if (!isPlainObject(style)) {
    fail("EDITOR_INVALID_OPERATION", "A node style must be an object");
  }

  for (const key of Object.keys(style)) {
    if (!(STYLE_FIELDS as readonly string[]).includes(key)) {
      fail("EDITOR_INVALID_OPERATION", `Unknown style field: ${key}`);
    }
  }

  for (const field of STYLE_FIELDS) {
    if (!(field in style)) {
      fail("EDITOR_INVALID_OPERATION", `A node style is missing ${field}`);
    }
    validateStyleField(field, (style as unknown as Record<string, unknown>)[field]);
  }
}

/** Runs after a snapshot is parsed from storage or a request body. */
export function validateSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  if (!snapshot || !isPlainObject(snapshot)) {
    fail("EDITOR_INVALID_OPERATION", "A snapshot must be an object");
  }

  if (snapshot.version !== 1) {
    fail(
      "EDITOR_INVALID_OPERATION",
      `Unsupported editor snapshot version: ${String(snapshot.version)}`,
    );
  }

  if (
    !isFiniteNumber(snapshot.width) ||
    !isFiniteNumber(snapshot.height) ||
    snapshot.width <= 0 ||
    snapshot.height <= 0
  ) {
    fail("EDITOR_INVALID_OPERATION", "A snapshot must have a positive canvas size");
  }

  if (
    snapshot.width > EDITOR_LIMITS.maxDimensionPx ||
    snapshot.height > EDITOR_LIMITS.maxDimensionPx
  ) {
    fail(
      "EDITOR_DOCUMENT_LIMIT_EXCEEDED",
      `Canvas exceeds the ${EDITOR_LIMITS.maxDimensionPx}px dimension limit`,
    );
  }

  if (
    !isFiniteNumber(snapshot.durationMs) ||
    snapshot.durationMs <= 0 ||
    snapshot.durationMs > EDITOR_LIMITS.maxDurationMs
  ) {
    fail(
      "EDITOR_DOCUMENT_LIMIT_EXCEEDED",
      `Document duration must sit between 1ms and ${EDITOR_LIMITS.maxDurationMs}ms`,
    );
  }

  if (!isFiniteNumber(snapshot.frameRate) || snapshot.frameRate <= 0) {
    fail("EDITOR_INVALID_OPERATION", "A snapshot must have a positive frame rate");
  }

  if (!Array.isArray(snapshot.nodes)) {
    fail("EDITOR_INVALID_OPERATION", "A snapshot must carry a node list");
  }

  if (snapshot.nodes.length > EDITOR_LIMITS.maxNodesPerDocument) {
    fail(
      "EDITOR_DOCUMENT_LIMIT_EXCEEDED",
      `A document may hold at most ${EDITOR_LIMITS.maxNodesPerDocument} nodes`,
    );
  }

  const byId = new Map<string, EditorNode>();
  for (const node of snapshot.nodes) {
    validateNodeShape(node);
    validateStyle(node.style);
    if (byId.has(node.id)) {
      fail("EDITOR_INVALID_OPERATION", `Duplicate node id: ${node.id}`);
    }
    byId.set(node.id, node);
  }

  const childrenPerParent = new Map<string, number>();
  for (const node of snapshot.nodes) {
    if (node.parentId === null) continue;
    const parent = byId.get(node.parentId);
    if (!parent) {
      fail(
        "EDITOR_INVALID_OPERATION",
        `Node ${node.id} points at a parent that does not exist`,
      );
    }
    if (parent.type !== "GROUP") {
      fail(
        "EDITOR_INVALID_OPERATION",
        `Node ${node.id} is parented to ${parent.id}, which is not a group`,
      );
    }
    childrenPerParent.set(
      node.parentId,
      (childrenPerParent.get(node.parentId) ?? 0) + 1,
    );
  }

  for (const [parentId, count] of childrenPerParent) {
    if (count > EDITOR_LIMITS.maxGroupChildren) {
      fail(
        "EDITOR_GROUP_LIMIT_EXCEEDED",
        `Group ${parentId} exceeds ${EDITOR_LIMITS.maxGroupChildren} children`,
      );
    }
  }

  for (const node of snapshot.nodes) {
    if (hasCycle(node, byId)) {
      fail("EDITOR_INVALID_OPERATION", `Node ${node.id} is its own ancestor`);
    }
  }

  return snapshot;
}

/**
 * A group may not contain itself, directly or through any number of hops.
 *
 * Walks up with a step budget rather than a visited set: the limit is well above
 * the node ceiling, so a walk that long means the parent links are already
 * broken and should fail loudly instead of spinning.
 */
function hasCycle(
  node: EditorNode,
  byId: Map<string, EditorNode>,
): boolean {
  let current = node;
  for (let depth = 0; depth <= EDITOR_LIMITS.maxNodesPerDocument; depth += 1) {
    if (current.parentId === null) return false;
    if (current.parentId === node.id) return true;
    const parent = byId.get(current.parentId);
    if (!parent) return false;
    current = parent;
  }
  return true;
}

export function isProvenanceOrigin(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (EDITOR_PROVENANCE_ORIGINS as readonly string[]).includes(value)
  );
}

export { isMediaNodeType };
