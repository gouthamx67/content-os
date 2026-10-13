/**
 * The editor's canonical vocabulary.
 *
 * Everything a user edits lives in an `EditorSnapshot`. Nodes carry the geometry,
 * media reference and styling; the document is the whole stage. `order` inside a
 * node is deliberately absent — `zIndex` is the single ordering truth, and the
 * repository mirrors it into the `sortIndex` column used for ordered reads. Two
 * orderings that can disagree are one ordering bug waiting to happen.
 */

/** Bumped only when a snapshot stops being readable by an older editor. */
export const EDITOR_DOCUMENT_VERSION = 1 as const;

export const EDITOR_DOCUMENT_STATUSES = [
  "DRAFT",
  "READY",
  "ARCHIVED",
] as const;
export type EditorDocumentStatus = (typeof EDITOR_DOCUMENT_STATUSES)[number];

export const EDITOR_NODE_TYPES = [
  "TEXT",
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "SHAPE",
  "GROUP",
] as const;
export type EditorNodeType = (typeof EDITOR_NODE_TYPES)[number];

export const EDITOR_OPERATION_TYPES = [
  "CREATE",
  "SET_TEXT",
  "REPLACE_ASSET",
  "MOVE",
  "RESIZE",
  "ROTATE",
  "SET_OPACITY",
  "SET_STYLE",
  "TRIM",
  "SET_GAIN",
  "SET_MUTE",
  "SET_VISIBILITY",
  "REORDER",
  "DUPLICATE",
  "DELETE",
  "SPLIT",
  "RESTORE",
] as const;
export type EditorOperationType = (typeof EDITOR_OPERATION_TYPES)[number];

/** Where a piece of media came from, so a reader can trace it back. */
export const EDITOR_PROVENANCE_ORIGINS = [
  "BLANK",
  "VISUAL_COMPOSITION",
  "GENERATED_IMAGE",
  "WRITING_VARIANT",
  "ADAPTATION_JOB",
] as const;
export type EditorProvenanceOrigin = (typeof EDITOR_PROVENANCE_ORIGINS)[number];

export const EDITOR_MEDIA_KINDS = ["IMAGE", "VIDEO", "AUDIO"] as const;
export type EditorMediaKind = (typeof EDITOR_MEDIA_KINDS)[number];

export const EDITOR_TEXT_ALIGNMENTS = ["LEFT", "CENTER", "RIGHT"] as const;
export type EditorTextAlignment = (typeof EDITOR_TEXT_ALIGNMENTS)[number];

export const EDITOR_SHAPE_TYPES = ["RECT", "ELLIPSE", "POLYGON", "LINE"] as const;
export type EditorShapeType = (typeof EDITOR_SHAPE_TYPES)[number];

export const EDITOR_MOTION_PROPERTIES = [
  "X",
  "Y",
  "SCALE",
  "ROTATION",
  "OPACITY",
] as const;
export type EditorMotionProperty = (typeof EDITOR_MOTION_PROPERTIES)[number];

export const EDITOR_MOTION_EASINGS = [
  "LINEAR",
  "EASE_IN",
  "EASE_OUT",
  "EASE_IN_OUT",
] as const;
export type EditorMotionEasing = (typeof EDITOR_MOTION_EASINGS)[number];

/**
 * Visual effects carried over from a CP14 scene graph. Kept as typed metadata on
 * the node (not folded into the transform) so an import never flattens them.
 */
export const EDITOR_EFFECT_TYPES = [
  "BLUR",
  "BRIGHTNESS",
  "CONTRAST",
  "SATURATION",
  "GRAYSCALE",
] as const;
export type EditorEffectType = (typeof EDITOR_EFFECT_TYPES)[number];

/** What an audio-automation point drives. One target keeps the model small. */
export const EDITOR_AUDIO_AUTOMATION_TARGETS = ["VOLUME_DB"] as const;
export type EditorAudioAutomationTarget = (typeof EDITOR_AUDIO_AUTOMATION_TARGETS)[number];

/**
 * A controlled reference to a media artifact owned by an earlier checkpoint.
 *
 * The prefix is the only thing the editor understands: the id after the colon is
 * resolved through the owning module, so CP20 never dereferences storage itself
 * and a raw storage key can never reach the browser.
 */
export type EditorAssetRef = string;

export type EditorTransform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
};

export type EditorNodeStyle = {
  fontSize: number | null;
  fontFamily: string | null;
  fontWeight: number | null;
  color: string | null;
  backgroundColor: string | null;
  align: EditorTextAlignment | null;
  radius: number | null;
};

/** Half-open millisecond window into the node's source media. */
export type EditorTrim = {
  startMs: number;
  endMs: number;
};

/**
 * The editable surface of an audio node.
 *
 * Pan, fades, the source offset and the ducking level are carried through from a
 * CP16 track rather than flattened into a generic gain, so a track imported into
 * the editor still holds everything the audio engine knew about it.
 */
export type EditorAudioSettings = {
  gainDb: number;
  muted: boolean;
  pan: number;
  fadeInMs: number;
  fadeOutMs: number;
  sourceOffsetMs: number;
  solo: boolean;
  duckVoiceoverDb: number | null;
};

export type EditorNodeAsset = {
  ref: EditorAssetRef;
  assetId: string;
  kind: EditorMediaKind;
  origin: EditorProvenanceOrigin;
  sourceType: string;
  sourceId: string | null;
  mimeType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

export type EditorNodeText = {
  value: string;
};

export type EditorNodeShape = {
  shapeType: EditorShapeType;
};

export type EditorMotionKeyframe = {
  id: string;
  property: EditorMotionProperty;
  timeMs: number;
  fromValue: number;
  toValue: number;
  easing: EditorMotionEasing;
};

export type EditorNodeMotion = {
  keyframes: EditorMotionKeyframe[];
};

export type EditorNodeEffect = {
  id: string;
  type: EditorEffectType;
  amount: number;
  enabled: boolean;
};

export type EditorAudioAutomationPoint = {
  id: string;
  type: EditorAudioAutomationTarget;
  timeMs: number;
  value: number;
  easing: EditorMotionEasing;
};

export type EditorNodeProvenance = {
  origin: EditorProvenanceOrigin;
  sourceType: string;
  sourceId: string | null;
  /** CP06 source ids this node's content was built from, when known. */
  sourceIds: string[];
  label: string | null;
};

export type EditorNode = {
  id: string;
  parentId: string | null;
  type: EditorNodeType;
  name: string;
  zIndex: number;
  transform: EditorTransform;
  visible: boolean;
  asset: EditorNodeAsset | null;
  text: EditorNodeText | null;
  style: EditorNodeStyle;
  trim: EditorTrim | null;
  audio: EditorAudioSettings | null;
  shape: EditorNodeShape | null;
  motion: EditorNodeMotion | null;
  effects: EditorNodeEffect[];
  automation: EditorAudioAutomationPoint[];
  provenance: EditorNodeProvenance | null;
};

/**
 * The whole editable document.
 *
 * Nodes are stored as a flat list ordered by `(parentId, zIndex)` rather than
 * nested: a group is a parent pointer, and a flat list means a move or a delete
 * can never have to rewrite an arbitrarily deep subtree's nesting.
 */
export type EditorSnapshot = {
  version: typeof EDITOR_DOCUMENT_VERSION;
  documentId: string;
  width: number;
  height: number;
  durationMs: number;
  frameRate: number;
  nodes: EditorNode[];
};

/**
 * Every mutation the editor accepts.
 *
 * This union is closed: an operation that is not listed here cannot be
 * persisted, validated or audited, which is what keeps a hand-crafted request
 * from smuggling in a mutation the UI never offered.
 */
export type EditorOperation =
  | { type: "CREATE"; node: EditorNode }
  | { type: "SET_TEXT"; nodeId: string; value: string }
  | { type: "REPLACE_ASSET"; nodeId: string; asset: EditorNodeAsset }
  | { type: "MOVE"; nodeId: string; x: number; y: number }
  | { type: "RESIZE"; nodeId: string; width: number; height: number }
  | { type: "ROTATE"; nodeId: string; rotation: number }
  | { type: "SET_OPACITY"; nodeId: string; opacity: number }
  | { type: "SET_STYLE"; nodeId: string; style: Partial<EditorNodeStyle> }
  | { type: "TRIM"; nodeId: string; startMs: number; endMs: number }
  | { type: "SET_GAIN"; nodeId: string; gainDb: number }
  | { type: "SET_MUTE"; nodeId: string; muted: boolean }
  | { type: "SET_VISIBILITY"; nodeId: string; visible: boolean }
  | { type: "REORDER"; nodeId: string; zIndex: number; parentId?: string | null }
  | { type: "DUPLICATE"; nodeId: string; newNodeId: string }
  | { type: "DELETE"; nodeId: string }
  | {
      type: "SPLIT";
      nodeId: string;
      startMs: number;
      endMs?: number;
      newNodeIds?: string[];
    }
  | { type: "RESTORE"; targetRevisionId: string };

/** What one applied operation changed, so a caller can update just that. */
export type EditorOperationResult = {
  affectedNodeIds: string[];
  createdNodeIds: string[];
  removedNodeIds: string[];
  restoredRevisionId: string | null;
};

export type EditorDocumentRecord = {
  id: string;
  projectId: string;
  name: string;
  status: EditorDocumentStatus;
  documentVersion: number;
  currentRevisionId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  revisionCount: number;
  lastOperation: EditorOperationType | null;
};

export type EditorNodeRecord = {
  id: string;
  documentId: string;
  parentId: string | null;
  type: EditorNodeType;
  name: string;
  zIndex: number;
  sortIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type EditorRevisionRecord = {
  id: string;
  documentId: string;
  revisionNumber: number;
  operationType: EditorOperationType;
  operationPayload: string;
  snapshot: string;
  snapshotSha256: string;
  createdById: string;
  sourceType: string;
  sourceId: string | null;
  provenanceSourceIds: string[];
  restoredFromRevisionId: string | null;
  createdAt: string;
};

/**
 * A revision as history lists it: everything except the snapshot bytes.
 *
 * The operation payload is kept because it is the only record of where a
 * restore came from and where undo and redo should step next. The snapshot is
 * dropped because a history list has no reason to carry a copy of the document.
 */
export type EditorRevisionSummary = Omit<EditorRevisionRecord, "snapshot">;

export function isMediaNodeType(type: EditorNodeType): type is EditorMediaKind {
  return type === "IMAGE" || type === "VIDEO" || type === "AUDIO";
}

export function emptyStyle(): EditorNodeStyle {
  return {
    fontSize: null,
    fontFamily: null,
    fontWeight: null,
    color: null,
    backgroundColor: null,
    align: null,
    radius: null,
  };
}
