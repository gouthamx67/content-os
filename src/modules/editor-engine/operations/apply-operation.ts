import { EditorError } from "../errors";
import {
  EDITOR_LIMITS,
  parseStyleInput,
  validateSnapshot,
} from "../domain/validation";
import {
  emptyStyle,
  type EditorAudioSettings,
  type EditorMotionKeyframe,
  type EditorNode,
  type EditorNodeAsset,
  type EditorNodeStyle,
  type EditorOperation,
  type EditorOperationResult,
  type EditorSnapshot,
} from "../domain/types";
import {
  assertAssetKindMatchesNode,
  assertAssetMetadataPlausible,
  assertAssetSupportsNodeType,
  assetRef,
} from "../assets/asset-ref";

export type ApplyOperationContext = {
  /**
   * Ids minted by the service. Ids are the caller's so that a CREATE arriving
   * from two retries cannot silently collide with a node created in between.
   */
  newNodeIds?: string[];
  newNodeId?: string;
};

function fail(message: string): never {
  throw new EditorError("EDITOR_INVALID_OPERATION", message);
}

function requireNode(snapshot: EditorSnapshot, nodeId: string): EditorNode {
  const node = snapshot.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new EditorError("EDITOR_NODE_NOT_FOUND", `No node with id ${nodeId}`);
  }
  return node;
}

function requireMediaNode(snapshot: EditorSnapshot, nodeId: string): EditorNode {
  const node = requireNode(snapshot, nodeId);
  if (node.type !== "VIDEO" && node.type !== "AUDIO") {
    throw new EditorError(
      "EDITOR_NODE_TYPE_MISMATCH",
      `Node ${nodeId} is a ${node.type} node and cannot be trimmed`,
    );
  }
  return node;
}

function requireAudioNode(snapshot: EditorSnapshot, nodeId: string): EditorNode {
  const node = requireNode(snapshot, nodeId);
  if (node.type !== "AUDIO") {
    throw new EditorError(
      "EDITOR_NODE_TYPE_MISMATCH",
      `Node ${nodeId} is a ${node.type} node and has no gain`,
    );
  }
  return node;
}

/** An `AUDIO` node always has settings; this narrows it without a cast. */
function requireAudioSettings(node: EditorNode): EditorAudioSettings {
  if (!node.audio) {
    throw new EditorError(
      "EDITOR_NODE_TYPE_MISMATCH",
      `Audio node ${node.id} has no audio settings`,
    );
  }
  return node.audio;
}

/** A node and every node beneath it. */
export function descendantsOf(
  snapshot: EditorSnapshot,
  nodeId: string,
): EditorNode[] {
  const byParent = new Map<string, EditorNode[]>();
  for (const node of snapshot.nodes) {
    if (node.parentId === null) continue;
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }

  const collected: EditorNode[] = [];
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of byParent.get(current) ?? []) {
      collected.push(child);
      queue.push(child.id);
    }
  }

  return collected;
}

/**
 * Renumbers the siblings of `parentId` densely from zero.
 *
 * Denseness is what keeps `sortIndex` and `zIndex` the same number. Two separate
 * orderings that agree today and drift tomorrow is exactly the bug a flat
 * snapshot is supposed to make impossible.
 */
function renumberSiblings(
  nodes: EditorNode[],
  parentId: string | null,
): void {
  const siblings = nodes
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));

  siblings.forEach((node, index) => {
    node.zIndex = index;
  });
}

/**
 * Moves `node` to `zIndex` among its siblings and renumbers them densely.
 *
 * The node has to be lifted out of the list before its target slot is chosen.
 * Sorting by `(zIndex, id)` while the node is still in the list gives it no claim
 * to the slot it was dropped onto — it collides with the node already there and
 * the tie-break on id silently sends it one place further down, which is how a
 * drag to the top of the layer list ends up second.
 */
function placeNode(
  snapshot: EditorSnapshot,
  node: EditorNode,
  zIndex: number,
): void {
  const siblings = snapshot.nodes
    .filter((candidate) => candidate.parentId === node.parentId)
    .filter((candidate) => candidate.id !== node.id)
    .sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));

  const index = Math.min(Math.max(Math.trunc(zIndex), 0), siblings.length);

  siblings.splice(index, 0, node);
  siblings.forEach((member, position) => {
    member.zIndex = position;
  });
}

/**
 * Applies one operation to a snapshot and returns a new snapshot.
 *
 * Pure: nothing here reads a clock, a database or a random source, and the input
 * is never mutated. That is what makes an operation replayable — the revision
 * log can be re-verified by running the same operations over the same starting
 * snapshot and comparing hashes.
 */
export function applyOperation(
  snapshot: EditorSnapshot,
  operation: EditorOperation,
  context: ApplyOperationContext = {},
): { snapshot: EditorSnapshot; result: EditorOperationResult } {
  const nodes = snapshot.nodes.map((node) => ({
    ...node,
    transform: { ...node.transform },
    style: { ...node.style },
    asset: node.asset ? { ...node.asset } : null,
    text: node.text ? { ...node.text } : null,
    trim: node.trim ? { ...node.trim } : null,
    audio: node.audio ? { ...node.audio } : null,
    shape: node.shape ? { ...node.shape } : null,
    motion: node.motion
      ? { keyframes: node.motion.keyframes.map((keyframe) => ({ ...keyframe })) }
      : null,
    provenance: node.provenance
      ? { ...node.provenance, sourceIds: [...node.provenance.sourceIds] }
      : null,
  }));

  const working: EditorSnapshot = { ...snapshot, nodes };
  const result = reduce(working, operation, context);

  const validated = validateSnapshot(working);

  return { snapshot: validated, result };
}

function reduce(
  snapshot: EditorSnapshot,
  operation: EditorOperation,
  context: ApplyOperationContext,
): EditorOperationResult {
  switch (operation.type) {
    case "CREATE":
      return create(snapshot, operation.node);
    case "SET_TEXT":
      return setText(snapshot, operation.nodeId, operation.value);
    case "REPLACE_ASSET":
      return replaceAsset(snapshot, operation.nodeId, operation.asset);
    case "MOVE":
      return move(snapshot, operation.nodeId, operation.x, operation.y);
    case "RESIZE":
      return resize(snapshot, operation.nodeId, operation.width, operation.height);
    case "ROTATE":
      return rotate(snapshot, operation.nodeId, operation.rotation);
    case "SET_OPACITY":
      return setOpacity(snapshot, operation.nodeId, operation.opacity);
    case "SET_STYLE":
      return setStyle(snapshot, operation.nodeId, operation.style);
    case "TRIM":
      return trim(snapshot, operation.nodeId, operation.startMs, operation.endMs);
    case "SET_GAIN":
      return setGain(snapshot, operation.nodeId, operation.gainDb);
    case "SET_MUTE":
      return setMute(snapshot, operation.nodeId, operation.muted);
    case "SET_VISIBILITY":
      return setVisibility(snapshot, operation.nodeId, operation.visible);
    case "REORDER":
      return reorder(snapshot, operation.nodeId, operation.zIndex, operation.parentId);
    case "DUPLICATE":
      return duplicate(snapshot, operation.nodeId, operation.newNodeId);
    case "DELETE":
      return remove(snapshot, operation.nodeId);
    case "SPLIT":
      return split(snapshot, operation, context);
    case "RESTORE":
      // A RESTORE never changes a snapshot: the service resolves the target
      // revision and applies the *bytes* it holds. Refusing here keeps the one
      // path that bypasses the reducer from being reachable by mistake.
      throw new EditorError(
        "EDITOR_INVALID_OPERATION",
        "RESTORE is applied by copying a stored snapshot, not by this reducer",
      );
  }
}

function emptyResult(): EditorOperationResult {
  return {
    affectedNodeIds: [],
    createdNodeIds: [],
    removedNodeIds: [],
    restoredRevisionId: null,
  };
}

function create(
  snapshot: EditorSnapshot,
  node: EditorNode,
): EditorOperationResult {
  if (snapshot.nodes.some((existing) => existing.id === node.id)) {
    fail(`A node with id ${node.id} already exists`);
  }

  if (snapshot.nodes.length >= EDITOR_LIMITS.maxNodesPerDocument) {
    throw new EditorError(
      "EDITOR_DOCUMENT_LIMIT_EXCEEDED",
      `A document may hold at most ${EDITOR_LIMITS.maxNodesPerDocument} nodes`,
    );
  }

  if (node.parentId !== null) {
    const parent = requireNode(snapshot, node.parentId);
    if (parent.type !== "GROUP") {
      throw new EditorError(
        "EDITOR_INVALID_OPERATION",
        `Only a group may hold children, and ${parent.id} is a ${parent.type}`,
      );
    }
  }

  // Audio settings are the audio node's own surface: an audio node must carry
  // them (or SET_GAIN and SET_MUTE have nothing to change), and nothing else may.
  if (node.type === "AUDIO") {
    if (!node.audio) {
      fail("An audio node must carry audio settings");
    }
  } else if (node.audio) {
    fail("Audio settings belong on audio nodes only");
  }

  if (node.asset) {
    const parsed = assertAssetSupportsNodeType(node.asset.ref, node.type);
    assertAssetKindMatchesNode(node.asset, node.type);
    assertAssetMetadataPlausible(node.asset);
    // The stored ref is rebuilt from the validated prefix and id so a request
    // cannot smuggle a differently-spelled ref past the check.
    node.asset.ref = assetRef(parsed.prefix, parsed.id);
    node.asset.assetId = parsed.id;
  }

  // The style is completed from the canonical empty style so a freshly created
  // node always carries every controlled field, and the supplied part is
  // validated rather than copied through.
  node.style = { ...emptyStyle(), ...parseStyleInput(node.style) };

  snapshot.nodes.push(node);
  renumberSiblings(snapshot.nodes, node.parentId);

  const result = emptyResult();
  result.createdNodeIds = [node.id];
  result.affectedNodeIds = [node.id];
  return result;
}

function setText(
  snapshot: EditorSnapshot,
  nodeId: string,
  value: string,
): EditorOperationResult {
  const node = requireNode(snapshot, nodeId);
  if (node.type !== "TEXT") {
    throw new EditorError(
      "EDITOR_NODE_TYPE_MISMATCH",
      `Node ${nodeId} is a ${node.type} node and holds no text`,
    );
  }
  node.text = { value };
  const result = emptyResult();
  result.affectedNodeIds = [nodeId];
  return result;
}

function replaceAsset(
  snapshot: EditorSnapshot,
  nodeId: string,
  asset: EditorNodeAsset,
): EditorOperationResult {
  const node = requireNode(snapshot, nodeId);
  if (node.type !== "IMAGE" && node.type !== "VIDEO" && node.type !== "AUDIO") {
    throw new EditorError(
      "EDITOR_NODE_TYPE_MISMATCH",
      `Node ${nodeId} is a ${node.type} node and holds no asset`,
    );
  }

  const parsed = assertAssetSupportsNodeType(asset.ref, node.type);
  assertAssetKindMatchesNode(asset, node.type);
  assertAssetMetadataPlausible(asset);

  node.asset = { ...asset, ref: assetRef(parsed.prefix, parsed.id), assetId: parsed.id };

  // A new asset is a new file: the trim that pointed into the old file's
  // timeline no longer means anything, and keeping it would clip the new media
  // at an arbitrary point.
  node.trim = null;

  const result = emptyResult();
  result.affectedNodeIds = [nodeId];
  return result;
}

function move(
  snapshot: EditorSnapshot,
  nodeId: string,
  x: number,
  y: number,
): EditorOperationResult {
  const node = requireNode(snapshot, nodeId);

  if (node.type === "GROUP") {
    translateGroup(snapshot, node, x - node.transform.x, y - node.transform.y);
  } else {
    node.transform.x = x;
    node.transform.y = y;
  }

  const result = emptyResult();
  result.affectedNodeIds = [nodeId];
  return result;
}

/**
 * Moves a group by moving its children.
 *
 * A group has no transform of its own: it is a parent pointer, so the only
 * honest way to move one is to move everything inside it by the same delta. The
 * group's own transform stays at the origin so the two never double-count.
 */
function translateGroup(
  snapshot: EditorSnapshot,
  group: EditorNode,
  dx: number,
  dy: number,
): void {
  group.transform.x = 0;
  group.transform.y = 0;

  for (const child of descendantsOf(snapshot, group.id)) {
    const node = snapshot.nodes.find((candidate) => candidate.id === child.id);
    if (!node) continue;
    node.transform.x += dx;
    node.transform.y += dy;
  }
}

function resize(
  snapshot: EditorSnapshot,
  nodeId: string,
  width: number,
  height: number,
): EditorOperationResult {
  const node = requireNode(snapshot, nodeId);
  if (node.type === "GROUP") {
    throw new EditorError(
      "EDITOR_UNSUPPORTED_GROUP_TRANSFORM",
      "A group cannot be scaled: its size is decided by the children it holds",
    );
  }
  node.transform.width = width;
  node.transform.height = height;
  const result = emptyResult();
  result.affectedNodeIds = [nodeId];
  return result;
}

function rotate(
  snapshot: EditorSnapshot,
  nodeId: string,
  rotation: number,
): EditorOperationResult {
  const node = requireNode(snapshot, nodeId);
  if (node.type === "GROUP") {
    throw new EditorError(
      "EDITOR_UNSUPPORTED_GROUP_TRANSFORM",
      "A group cannot be rotated: its children own their own rotation",
    );
  }
  node.transform.rotation = rotation;
  const result = emptyResult();
  result.affectedNodeIds = [nodeId];
  return result;
}

function setOpacity(
  snapshot: EditorSnapshot,
  nodeId: string,
  opacity: number,
): EditorOperationResult {
  const node = requireNode(snapshot, nodeId);
  node.transform.opacity = opacity;
  const result = emptyResult();
  result.affectedNodeIds = [nodeId];
  return result;
}

function setStyle(
  snapshot: EditorSnapshot,
  nodeId: string,
  style: Partial<EditorNodeStyle>,
): EditorOperationResult {
  const node = requireNode(snapshot, nodeId);
  node.style = { ...node.style, ...style };
  const result = emptyResult();
  result.affectedNodeIds = [nodeId];
  return result;
}

function trim(
  snapshot: EditorSnapshot,
  nodeId: string,
  startMs: number,
  endMs: number,
): EditorOperationResult {
  const node = requireMediaNode(snapshot, nodeId);

  if (startMs < 0 || endMs <= startMs) {
    fail("A trim must be a forward window starting at or after 0");
  }

  if (node.asset?.durationMs != null && endMs > node.asset.durationMs) {
    fail(`A trim cannot run past the ${node.asset.durationMs}ms source`);
  }

  node.trim = { startMs, endMs };
  const result = emptyResult();
  result.affectedNodeIds = [nodeId];
  return result;
}

function setGain(
  snapshot: EditorSnapshot,
  nodeId: string,
  gainDb: number,
): EditorOperationResult {
  const node = requireAudioNode(snapshot, nodeId);
  node.audio = { ...requireAudioSettings(node), gainDb };
  const result = emptyResult();
  result.affectedNodeIds = [nodeId];
  return result;
}

function setMute(
  snapshot: EditorSnapshot,
  nodeId: string,
  muted: boolean,
): EditorOperationResult {
  const node = requireAudioNode(snapshot, nodeId);
  node.audio = { ...requireAudioSettings(node), muted };
  const result = emptyResult();
  result.affectedNodeIds = [nodeId];
  return result;
}

function setVisibility(
  snapshot: EditorSnapshot,
  nodeId: string,
  visible: boolean,
): EditorOperationResult {
  const node = requireNode(snapshot, nodeId);
  node.visible = visible;
  const result = emptyResult();
  result.affectedNodeIds = [nodeId];
  return result;
}

function reorder(
  snapshot: EditorSnapshot,
  nodeId: string,
  zIndex: number,
  parentId: string | null | undefined,
): EditorOperationResult {
  const node = requireNode(snapshot, nodeId);

  // An omitted `parentId` means "stay where you are". Normalising it to `null`
  // first is what makes that true: comparing the raw `undefined` against a real
  // `null` would take the reparent path for every top-level reorder and drop the
  // node into the wrong slot.
  const nextParentId: string | null = parentId ?? null;

  if (nextParentId !== null) {
    const parent = requireNode(snapshot, nextParentId);
    if (parent.type !== "GROUP") {
      throw new EditorError(
        "EDITOR_INVALID_OPERATION",
        `Only a group may hold children, and ${parent.id} is a ${parent.type}`,
      );
    }
    if (
      nextParentId === nodeId ||
      descendantsOf(snapshot, nodeId).some((child) => child.id === nextParentId)
    ) {
      throw new EditorError(
        "EDITOR_INVALID_OPERATION",
        "A group cannot be moved inside itself",
      );
    }
  }

  const previousParentId = node.parentId;

  node.parentId = nextParentId;
  placeNode(snapshot, node, zIndex);

  // The parent it left now has a hole where the node used to be.
  if (previousParentId !== nextParentId) {
    renumberSiblings(snapshot.nodes, previousParentId);
  }

  const result = emptyResult();
  result.affectedNodeIds = [nodeId];
  return result;
}

function duplicate(
  snapshot: EditorSnapshot,
  nodeId: string,
  newNodeId: string,
): EditorOperationResult {
  const node = requireNode(snapshot, nodeId);
  const subtree = [node, ...descendantsOf(snapshot, nodeId)];

  // Descendants are numbered from zero, not from their position in the subtree,
  // so the first child's id is `<newNodeId>__0` rather than `__1` and a client can
  // predict the whole set from the one id it chose.
  const idMap = new Map<string, string>();

  for (const [index, member] of subtree.entries()) {
    idMap.set(
      member.id,
      index === 0 ? newNodeId : `${newNodeId}__${index - 1}`,
    );
  }

  // The check is against the *new* ids. Comparing against the map's keys would
  // ask whether a node already owns a source id, which is true of every node and
  // would refuse every duplicate.
  const newIds = new Set(idMap.values());

  if (snapshot.nodes.some((existing) => newIds.has(existing.id))) {
    fail("The id for the duplicate is already in use");
  }

  if (snapshot.nodes.length + subtree.length > EDITOR_LIMITS.maxNodesPerDocument) {
    throw new EditorError(
      "EDITOR_DOCUMENT_LIMIT_EXCEEDED",
      `A document may hold at most ${EDITOR_LIMITS.maxNodesPerDocument} nodes`,
    );
  }

  const copies = subtree.map((member) => copyNode(member, idMap));

  copies[0].name = `${node.name} copy`;
  copies[0].zIndex = node.zIndex + 1;
  renumberSiblings(snapshot.nodes, node.parentId);

  snapshot.nodes.push(...copies);
  renumberSiblings(snapshot.nodes, node.parentId);

  const result = emptyResult();
  result.createdNodeIds = copies.map((copy) => copy.id);
  result.affectedNodeIds = copies.map((copy) => copy.id);
  return result;
}

function copyNode(node: EditorNode, idMap: Map<string, string>): EditorNode {
  return {
    ...node,
    id: idMap.get(node.id) ?? node.id,
    parentId: node.parentId === null ? null : (idMap.get(node.parentId) ?? node.parentId),
    transform: { ...node.transform },
    style: { ...node.style },
    asset: node.asset ? { ...node.asset } : null,
    text: node.text ? { ...node.text } : null,
    trim: node.trim ? { ...node.trim } : null,
    audio: node.audio ? { ...node.audio } : null,
    shape: node.shape ? { ...node.shape } : null,
    motion: node.motion
      ? {
          keyframes: node.motion.keyframes.map((keyframe) => ({
            ...keyframe,
            id: `${keyframe.id}__copy-${node.id}`,
          })),
        }
      : null,
    provenance: node.provenance
      ? { ...node.provenance, sourceIds: [...node.provenance.sourceIds] }
      : null,
  };
}

function remove(
  snapshot: EditorSnapshot,
  nodeId: string,
): EditorOperationResult {
  requireNode(snapshot, nodeId);
  const doomed = [nodeId, ...descendantsOf(snapshot, nodeId).map((node) => node.id)];
  const doomedSet = new Set(doomed);
  const parentId = requireNode(snapshot, nodeId).parentId;

  snapshot.nodes = snapshot.nodes.filter((node) => !doomedSet.has(node.id));
  renumberSiblings(snapshot.nodes, parentId);

  const result = emptyResult();
  result.removedNodeIds = doomed;
  result.affectedNodeIds = doomed;
  return result;
}

/**
 * Splits a media node into adjacent segments, preserving all of them.
 *
 * The node keeps `[trimStart, startMs)`; `[startMs, endMs)` becomes a new node;
 * anything after `endMs` becomes another. Empty windows are dropped rather than
 * written as zero-length clips, so splitting repeatedly never fills a document
 * with nodes that play nothing.
 */
function split(
  snapshot: EditorSnapshot,
  operation: Extract<EditorOperation, { type: "SPLIT" }>,
  context: ApplyOperationContext,
): EditorOperationResult {
  const node = requireMediaNode(snapshot, operation.nodeId);

  const sourceStart = node.trim?.startMs ?? 0;
  const sourceEnd =
    node.trim?.endMs ??
    node.asset?.durationMs ??
    operation.startMs + (operation.endMs ?? operation.startMs);

  const startMs = operation.startMs;
  const endMs = operation.endMs ?? sourceEnd;

  if (startMs <= sourceStart || startMs >= sourceEnd) {
    fail("A split point must fall strictly inside the node's current window");
  }

  if (endMs <= startMs || endMs > sourceEnd) {
    fail("A split end must follow its start and stay inside the current window");
  }

  const windows: { startMs: number; endMs: number }[] = [
    { startMs: sourceStart, endMs: startMs },
    { startMs, endMs },
  ];

  if (endMs < sourceEnd) {
    windows.push({ startMs: endMs, endMs: sourceEnd });
  }

  const extraCount = windows.length - 1;
  const minted = operation.newNodeIds ?? [];
  const pool = context.newNodeIds ?? [];

  if (minted.length !== 0 && minted.length !== extraCount) {
    fail(`Splitting here needs exactly ${extraCount} new node ids`);
  }

  const ids: string[] = [];
  for (let index = 0; index < extraCount; index += 1) {
    const id = minted[index] ?? pool[index];
    if (!id) {
      fail("The service did not mint enough ids to complete the split");
    }
    if (snapshot.nodes.some((existing) => existing.id === id)) {
      fail(`Node id ${id} is already in use`);
    }
    ids.push(id);
  }

  node.trim = windows[0];

  const created: EditorNode[] = [];
  for (let index = 0; index < extraCount; index += 1) {
    const copy = copyNode(node, new Map([[node.id, ids[index]]]));
    copy.trim = windows[index + 1];
    copy.name = `${node.name} part ${index + 1}`;
    // A segment starts its own playback, so it must not inherit the parent's
    // keyframes: those describe motion across the whole original window.
    copy.motion = { keyframes: [] };
    created.push(copy);
  }

  // Inserting after the original keeps the segments in playback order, which is
  // the whole point of a split.
  const insertAt = snapshot.nodes.findIndex((candidate) => candidate.id === node.id) + 1;
  snapshot.nodes.splice(insertAt, 0, ...created);
  renumberSiblings(snapshot.nodes, node.parentId);

  const result = emptyResult();
  result.createdNodeIds = created.map((copy) => copy.id);
  result.affectedNodeIds = [node.id, ...created.map((copy) => copy.id)];
  return result;
}

/**
 * Flattens a snapshot into paint order.
 *
 * Children paint inside their group and groups paint by their own `zIndex`, so a
 * single ordered walk is the one place that rule is written down.
 */
export function nodesInPaintOrder(snapshot: EditorSnapshot): EditorNode[] {
  const byParent = new Map<string, EditorNode[]>();
  const roots: EditorNode[] = [];

  for (const node of snapshot.nodes) {
    if (node.parentId === null) {
      roots.push(node);
      continue;
    }
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }

  const ordered: EditorNode[] = [];

  const visit = (node: EditorNode): void => {
    ordered.push(node);
    const children = (byParent.get(node.id) ?? []).sort(
      (a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id),
    );
    for (const child of children) visit(child);
  };

  for (const root of roots.sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))) {
    visit(root);
  }

  return ordered;
}

export function extractKeyframes(
  snapshot: EditorSnapshot,
): { nodeId: string; keyframes: EditorMotionKeyframe[] }[] {
  return snapshot.nodes
    .filter((node) => (node.motion?.keyframes.length ?? 0) > 0)
    .map((node) => ({
      nodeId: node.id,
      keyframes: [...(node.motion?.keyframes ?? [])].sort(
        (a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id),
      ),
    }));
}
