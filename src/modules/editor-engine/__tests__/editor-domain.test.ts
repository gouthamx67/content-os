import { describe, expect, it } from "vitest";
import {
  EDITOR_DOCUMENT_VERSION,
  EDITOR_OPERATION_TYPES,
  type EditorAudioSettings,
  type EditorNode,
  type EditorSnapshot,
} from "../domain/types";
import { EditorError } from "../errors";
import { validateSnapshot } from "../domain/validation";
import {
  ASSET_REF_OWNER,
  assertAssetSupportsNodeType,
  parseAssetRef,
} from "../assets/asset-ref";
import {
  canonicalizeSnapshot,
  parseAndVerifySnapshot,
  serializeSnapshot,
  snapshotSha256,
} from "../serialization/editor-snapshot";
import { assertOperationAllowedFromWire, validateOperation } from "../operations/validate-operation";
import { applyOperation } from "../operations/apply-operation";
import { emptyStyle } from "../domain/types";

function node(overrides: Partial<EditorNode> & { id: string }): EditorNode {
  return {
    parentId: null,
    type: "TEXT",
    name: "Node",
    zIndex: 0,
    transform: { x: 0, y: 0, width: 400, height: 200, rotation: 0, opacity: 1 },
    visible: true,
    asset: null,
    text: { value: "" },
    style: emptyStyle(),
    trim: null,
    audio: null,
    shape: null,
    motion: null,
    effects: [],
    automation: [],
    provenance: null,
    ...overrides,
  };
}

function snapshot(nodes: EditorNode[]): EditorSnapshot {
  return {
    version: EDITOR_DOCUMENT_VERSION,
    documentId: "edoc-1",
    width: 1080,
    height: 1920,
    durationMs: 15_000,
    frameRate: 30,
    nodes,
  };
}

const IMAGE_ASSET = {
  ref: "generated:img-1",
  assetId: "img-1",
  kind: "IMAGE" as const,
  origin: "GENERATED_IMAGE" as const,
  sourceType: "GENERATED_IMAGE",
  sourceId: "img-1",
  mimeType: "image/png",
  byteSize: 1_024,
  width: 1_920,
  height: 1_080,
  durationMs: null,
};

const VIDEO_ASSET = {
  ref: "adaptation:adapt-1",
  assetId: "adapt-1",
  kind: "VIDEO" as const,
  origin: "ADAPTATION_JOB" as const,
  sourceType: "ADAPTATION_JOB",
  sourceId: "adapt-1",
  mimeType: "video/mp4",
  byteSize: 4_096,
  width: 1_920,
  height: 1_080,
  durationMs: 8_000,
};

const AUDIO_ASSET = {
  ref: "capture:take-1",
  assetId: "take-1",
  kind: "AUDIO" as const,
  origin: "VISUAL_COMPOSITION" as const,
  sourceType: "CAPTURE_TAKE",
  sourceId: "take-1",
  mimeType: "audio/mpeg",
  byteSize: 2_048,
  width: null,
  height: null,
  durationMs: 6_000,
};

const AUDIO_SETTINGS: EditorAudioSettings = {
  gainDb: 0,
  muted: false,
  pan: 0,
  fadeInMs: 0,
  fadeOutMs: 0,
  sourceOffsetMs: 0,
  solo: false,
  duckVoiceoverDb: null,
};

describe("snapshot serialization", () => {
  it("serializes the same document to the same bytes regardless of node order", () => {
    const a = snapshot([node({ id: "n1", zIndex: 0 }), node({ id: "n2", zIndex: 1 })]);
    const b = snapshot([node({ id: "n2", zIndex: 1 }), node({ id: "n1", zIndex: 0 })]);

    expect(serializeSnapshot(b)).toBe(serializeSnapshot(a));
    expect(snapshotSha256(b)).toBe(snapshotSha256(a));
  });

  it("sorts provenance source ids so a set of ids hashes stably", () => {
    const a = snapshot([
      node({ id: "n1", provenance: { origin: "BLANK", sourceType: "BLANK", sourceId: null, sourceIds: ["s2", "s1"], label: null } }),
    ]);
    const b = snapshot([
      node({ id: "n1", provenance: { origin: "BLANK", sourceType: "BLANK", sourceId: null, sourceIds: ["s1", "s2"], label: null } }),
    ]);

    expect(snapshotSha256(b)).toBe(snapshotSha256(a));
  });

  it("refuses a snapshot whose bytes do not match the hash recorded with them", () => {
    const original = snapshot([node({ id: "n1", text: { value: "Approved" } })]);
    const tampered = serializeSnapshot(original).replace("Approved", "Amended");

    expect(() => parseAndVerifySnapshot(tampered, snapshotSha256(original))).toThrow(
      /does not match its recorded hash/i,
    );
  });

  it("canonicalizes without mutating the caller's snapshot", () => {
    const input = snapshot([node({ id: "n2", zIndex: 1 }), node({ id: "n1", zIndex: 0 })]);
    const canonical = canonicalizeSnapshot(input);

    expect(input.nodes.map((n) => n.id)).toEqual(["n2", "n1"]);
    expect(canonical.nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
  });
});

describe("snapshot validation", () => {
  it("refuses a parent cycle rather than looping forever", () => {
    const cyclic = snapshot([
      node({ id: "g1", type: "GROUP", parentId: "n2", text: null }),
      node({ id: "n2", parentId: "g1", text: { value: "child" } }),
    ]);

    expect(() => validateSnapshot(cyclic)).toThrow(EditorError);
  });

  it("refuses an orphan whose parent does not exist", () => {
    expect(() =>
      validateSnapshot(snapshot([node({ id: "n1", parentId: "missing" })])),
    ).toThrow(/parent/i);
  });

  it("refuses more nodes than a document is allowed to hold", () => {
    const many = snapshot(
      Array.from({ length: 501 }, (_, index) =>
        node({ id: `n${index}`, zIndex: index }),
      ),
    );

    expect(() => validateSnapshot(many)).toThrow(/500/);
  });

  it("refuses a text node longer than the paste limit", () => {
    const long = snapshot([
      node({ id: "n1", text: { value: "x".repeat(30_001) } }),
    ]);

    expect(() => validateSnapshot(long)).toThrow(/30,000|30000/);
  });

  it("refuses an image node carrying an audio reference", () => {
    const wrong = snapshot([
      node({ id: "n1", type: "IMAGE", text: null, asset: { ...VIDEO_ASSET, ref: "adaptation:adapt-1", kind: "AUDIO" } }),
    ]);

    expect(() => validateSnapshot(wrong)).toThrow(EditorError);
  });
});

describe("asset references", () => {
  it("parses each prefix into an opaque id, with no storage key left in it", () => {
    expect(parseAssetRef("capture:cap-1")).toEqual({ prefix: "capture", id: "cap-1", ref: "capture:cap-1" });
    expect(parseAssetRef("generated:img-1").prefix).toBe("generated");
    expect(parseAssetRef("brand:brand-1").prefix).toBe("brand");
    expect(parseAssetRef("product:prod-1").prefix).toBe("product");
    expect(parseAssetRef("adaptation:adapt-1").prefix).toBe("adaptation");
    expect(parseAssetRef("writing:wvar-1").prefix).toBe("writing");
  });

  it("names the owning checkpoint for every prefix", () => {
    expect(ASSET_REF_OWNER).toEqual({
      capture: "CP13_CAPTURE",
      generated: "CP17_IMAGE",
      brand: "CP02_BRAND",
      product: "CP03_PRODUCT",
      asset: "CP02_BRAND_CP03_PRODUCT",
      adaptation: "CP19_MULTIFORMAT",
      writing: "CP18_WRITING",
    });
  });

  it("refuses a raw storage key or an unknown owner", () => {
    expect(() => parseAssetRef("projects/p1/owner/o1/file.png")).toThrow(/prefix|ref/i);
    expect(() => parseAssetRef("gcs://bucket/file.png")).toThrow(/prefix|ref/i);
    expect(() => parseAssetRef("unknown:thing-1")).toThrow(EditorError);
  });

  it("refuses to point a media node at writing copy, which is text", () => {
    expect(() =>
      assertAssetSupportsNodeType("writing:wvar-1", "VIDEO"),
    ).toThrow(/text/i);
  });

  it("refuses to put any asset on a text or shape node", () => {
    expect(() => assertAssetSupportsNodeType("generated:img-1", "TEXT")).toThrow(EditorError);
    expect(() => assertAssetSupportsNodeType("generated:img-1", "SHAPE")).toThrow(EditorError);
  });

  it("rejects an image whose recorded size is not a real image size", () => {
    expect(() =>
      validateSnapshot(
        snapshot([node({ id: "n1", type: "IMAGE", text: null, asset: { ...IMAGE_ASSET, width: 0 } })]),
      ),
    ).toThrow(EditorError);
  });
});

describe("operation validation", () => {
  it("refuses RESTORE from the wire, which only the service may issue", () => {
    expect(() =>
      assertOperationAllowedFromWire({ type: "RESTORE", targetRevisionId: "edrev-1" }),
    ).toThrow(/restore/i);
  });

  it("refuses an unknown operation type instead of ignoring it", () => {
    expect(() =>
      validateOperation({ type: "DESTROY_EVERYTHING", nodeId: "n1" } as never),
    ).toThrow(/unknown|operation/i);
  });

  it("refuses SET_TEXT over the character limit", () => {
    expect(() =>
      validateOperation({ type: "SET_TEXT", nodeId: "n1", value: "x".repeat(30_001) }),
    ).toThrow(/30,000|30000/);
  });

  it("refuses a SET_GAIN outside the audible range", () => {
    expect(() => validateOperation({ type: "SET_GAIN", nodeId: "n1", gainDb: -90 })).toThrow(/between/i);
    expect(() => validateOperation({ type: "SET_OPACITY", nodeId: "n1", opacity: 1.4 })).toThrow(/between/i);
    expect(() => validateOperation({ type: "RESIZE", nodeId: "n1", width: 0, height: 10 })).toThrow(/between/i);
  });
});

describe("operation application", () => {
  it("rejects a move of a node that is not there", () => {
    const start = snapshot([node({ id: "n1" })]);

    expect(() =>
      applyOperation(start, { type: "MOVE", nodeId: "ghost", x: 10, y: 10 }),
    ).toThrow(EditorError);
  });

  it("moves a group by translating every child, since the group has no transform of its own", () => {
    const start = snapshot([
      node({ id: "g1", type: "GROUP", parentId: null, text: null, transform: { x: 0, y: 0, width: 800, height: 600, rotation: 0, opacity: 1 } }),
      node({ id: "c1", parentId: "g1", transform: { x: 100, y: 100, width: 200, height: 100, rotation: 0, opacity: 1 } }),
      node({ id: "c2", parentId: "g1", transform: { x: 400, y: 200, width: 200, height: 100, rotation: 0, opacity: 1 } }),
    ]);

    const { snapshot: moved } = applyOperation(start, { type: "MOVE", nodeId: "g1", x: 50, y: -25 });

    // The group stays at the origin, so a group's position is its children's.
    expect(moved.nodes.find((n) => n.id === "g1")?.transform).toMatchObject({ x: 0, y: 0 });
    expect(moved.nodes.find((n) => n.id === "c1")?.transform).toMatchObject({ x: 150, y: 75 });
    expect(moved.nodes.find((n) => n.id === "c2")?.transform).toMatchObject({ x: 450, y: 175 });
  });

  it("translates a group of a group, so nesting does not leave a node behind", () => {
    const start = snapshot([
      node({ id: "g1", type: "GROUP", text: null }),
      node({ id: "g2", type: "GROUP", parentId: "g1", text: null }),
      node({ id: "c1", parentId: "g2", transform: { x: 10, y: 20, width: 100, height: 100, rotation: 0, opacity: 1 } }),
    ]);

    const { snapshot: moved } = applyOperation(start, { type: "MOVE", nodeId: "g1", x: 5, y: 5 });

    expect(moved.nodes.find((n) => n.id === "c1")?.transform).toMatchObject({ x: 15, y: 25 });
  });

  it("refuses to resize a group, which would need a layout decision", () => {
    const start = snapshot([
      node({ id: "g1", type: "GROUP", text: null }),
      node({ id: "c1", parentId: "g1" }),
    ]);

    expect(() =>
      applyOperation(start, { type: "RESIZE", nodeId: "g1", width: 800, height: 600 }),
    ).toThrow(/group/i);
  });

  it("refuses to resize a group even when it has no children yet", () => {
    expect(() =>
      applyOperation(snapshot([node({ id: "g1", type: "GROUP", text: null })]), {
        type: "RESIZE",
        nodeId: "g1",
        width: 800,
        height: 600,
      }),
    ).toThrow(/group/i);
  });

  it("renumbers siblings densely so no z-index is ever skipped", () => {
    const start = snapshot([
      node({ id: "n1", zIndex: 0 }),
      node({ id: "n2", zIndex: 1 }),
      node({ id: "n3", zIndex: 2 }),
    ]);

    const { snapshot: reordered } = applyOperation(start, {
      type: "REORDER",
      nodeId: "n3",
      zIndex: 0,
    });

    const order = [...reordered.nodes]
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((n) => n.id);

    expect(order).toEqual(["n3", "n1", "n2"]);
    expect(reordered.nodes.map((n) => n.zIndex).sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("reparents without renumbering the old parent's remaining children twice", () => {
    const start = snapshot([
      node({ id: "g1", type: "GROUP", text: null }),
      node({ id: "n1", zIndex: 0 }),
      node({ id: "n2", zIndex: 1 }),
      node({ id: "n3", zIndex: 2 }),
    ]);

    const { snapshot: reparented } = applyOperation(start, {
      type: "REORDER",
      nodeId: "n3",
      zIndex: 1,
      parentId: "g1",
    });

    // Top-level siblings now include the group itself, and they stay dense.
    const topLevel = reparented.nodes.filter((n) => n.parentId === null);
    expect(topLevel.map((n) => n.id).sort()).toEqual(["g1", "n1", "n2"]);
    expect(topLevel.map((n) => n.zIndex).sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect(reparented.nodes.find((n) => n.id === "n3")).toMatchObject({ parentId: "g1", zIndex: 0 });
  });

  it("duplicates a subtree rather than just the node asked for", () => {
    const start = snapshot([
      node({ id: "g1", type: "GROUP", text: null }),
      node({ id: "c1", parentId: "g1", text: { value: "inside" } }),
    ]);

    const { snapshot: copied, result } = applyOperation(
      start,
      { type: "DUPLICATE", nodeId: "g1", newNodeId: "g2" },
      { newNodeId: "g2" },
    );

    expect(result.createdNodeIds).toEqual(["g2", "g2__0"]);
    expect(copied.nodes.find((n) => n.id === "g2")).toMatchObject({ type: "GROUP", text: null });
    expect(copied.nodes.find((n) => n.id === "g2__0")).toMatchObject({ parentId: "g2", text: { value: "inside" } });
    expect(copied.nodes).toHaveLength(4);
  });

  it("refuses a duplicate whose new id is already taken", () => {
    const start = snapshot([node({ id: "n1" }), node({ id: "n2", zIndex: 1 })]);

    expect(() =>
      applyOperation(start, { type: "DUPLICATE", nodeId: "n1", newNodeId: "n2" }),
    ).toThrow(/already in use/i);
  });

  it("deletes a subtree, since a group cannot outlive its children", () => {
    const start = snapshot([
      node({ id: "g1", type: "GROUP", text: null }),
      node({ id: "c1", parentId: "g1" }),
      node({ id: "c2", parentId: "c1" }),
      node({ id: "keep", zIndex: 1 }),
    ]);

    const { snapshot: pruned, result } = applyOperation(start, { type: "DELETE", nodeId: "g1" });

    expect(pruned.nodes.map((n) => n.id)).toEqual(["keep"]);
    expect(result.removedNodeIds.sort()).toEqual(["c1", "c2", "g1"]);
  });

  it("splits media into every non-empty segment instead of keeping one", () => {
    const start = snapshot([
      node({ id: "v1", type: "VIDEO", text: null, asset: VIDEO_ASSET, trim: null }),
    ]);

    const { snapshot: split, result } = applyOperation(
      start,
      { type: "SPLIT", nodeId: "v1", startMs: 2_000, endMs: 5_000 },
      { newNodeIds: ["v2", "v3"] },
    );

    expect(result.createdNodeIds).toEqual(["v2", "v3"]);
    const videoNodes = split.nodes.filter((n) => n.type === "VIDEO").sort((a, b) => a.id.localeCompare(b.id));
    expect(videoNodes.map((n) => n.trim)).toEqual([
      { startMs: 0, endMs: 2_000 },
      { startMs: 2_000, endMs: 5_000 },
      { startMs: 5_000, endMs: 8_000 },
    ]);
  });

  it("drops the empty trailing segment when the split reaches the end of the media", () => {
    const start = snapshot([
      node({ id: "v1", type: "VIDEO", text: null, asset: VIDEO_ASSET, trim: { startMs: 0, endMs: 8_000 } }),
    ]);

    const { snapshot: split } = applyOperation(
      start,
      { type: "SPLIT", nodeId: "v1", startMs: 3_000, endMs: 8_000 },
      { newNodeIds: ["v2"] },
    );

    const videoNodes = split.nodes.filter((n) => n.type === "VIDEO");
    expect(videoNodes).toHaveLength(2);
    expect(videoNodes.map((n) => n.trim)).toEqual([
      { startMs: 0, endMs: 3_000 },
      { startMs: 3_000, endMs: 8_000 },
    ]);
  });

  it("refuses a split at the very start, which would create nothing", () => {
    const start = snapshot([
      node({ id: "v1", type: "VIDEO", text: null, asset: VIDEO_ASSET, trim: { startMs: 0, endMs: 8_000 } }),
    ]);

    expect(() =>
      applyOperation(start, { type: "SPLIT", nodeId: "v1", startMs: 0, endMs: 3_000 }),
    ).toThrow(/strictly inside/i);
  });

  it("refuses a split whose end is not after its start, rather than storing nothing", () => {
    const start = snapshot([
      node({ id: "v1", type: "VIDEO", text: null, asset: VIDEO_ASSET, trim: null }),
    ]);

    expect(() =>
      applyOperation(start, { type: "SPLIT", nodeId: "v1", startMs: 2_000, endMs: 2_000 }),
    ).toThrow(/follow its start/i);
  });

  it("refuses a split at a boundary outside the media's own duration", () => {
    const start = snapshot([
      node({ id: "v1", type: "VIDEO", text: null, asset: VIDEO_ASSET, trim: null }),
    ]);

    expect(() =>
      applyOperation(start, { type: "SPLIT", nodeId: "v1", startMs: 9_000 }),
    ).toThrow(/inside/i);
  });

  it("clears a stale trim when the asset behind a node is replaced", () => {
    const start = snapshot([
      node({
        id: "v1",
        type: "VIDEO",
        text: null,
        asset: VIDEO_ASSET,
        trim: { startMs: 1_000, endMs: 4_000 },
      }),
    ]);

    const { snapshot: swapped } = applyOperation(start, {
      type: "REPLACE_ASSET",
      nodeId: "v1",
      asset: { ...IMAGE_ASSET, kind: "VIDEO", ref: "adaptation:adapt-2", assetId: "adapt-2", durationMs: 3_000 },
    });

    expect(swapped.nodes[0]?.trim).toBeNull();
    expect(swapped.nodes[0]?.asset?.assetId).toBe("adapt-2");
  });

  it("refuses to move a node inside its own subtree", () => {
    const start = snapshot([
      node({ id: "g1", type: "GROUP", text: null }),
      node({ id: "c1", parentId: "g1" }),
    ]);

    expect(() =>
      applyOperation(start, { type: "REORDER", nodeId: "g1", zIndex: 0, parentId: "c1" }),
    ).toThrow(EditorError);
  });

  it("refuses RESTORE, because restore is the service's job and not an operation", () => {
    expect(() =>
      applyOperation(snapshot([node({ id: "n1" })]), { type: "RESTORE", targetRevisionId: "edrev-9" }),
    ).toThrow(/restore/i);
  });

  it("returns a clean snapshot after every operation, so no drift accumulates", () => {
    let current = snapshot([
      node({ id: "n1", type: "IMAGE", text: null, asset: IMAGE_ASSET }),
      node({ id: "n2", zIndex: 1, text: { value: "Hello" } }),
    ]);

    const ops = [
      { type: "MOVE" as const, nodeId: "n2", x: 5, y: 5 },
      { type: "SET_TEXT" as const, nodeId: "n2", value: "Hello again" },
      { type: "SET_OPACITY" as const, nodeId: "n1", opacity: 0.5 },
      { type: "CREATE" as const, node: node({ id: "n3", zIndex: 2, type: "SHAPE", text: null, shape: { shapeType: "ELLIPSE" } }) },
      { type: "DUPLICATE" as const, nodeId: "n3", newNodeId: "n4" },
      { type: "REORDER" as const, nodeId: "n4", zIndex: 0 },
      { type: "DELETE" as const, nodeId: "n1" },
    ];

    for (const op of ops) {
      current = applyOperation(current, op, { newNodeId: op.type === "DUPLICATE" ? op.newNodeId : undefined }).snapshot;
      expect(() => validateSnapshot(current)).not.toThrow();
    }

    expect(current.nodes.map((n) => n.id).sort()).toEqual(["n2", "n3", "n4"]);
  });
});

describe("strict style validation", () => {
  it("has no SELECT operation, because selection is transient UI state", () => {
    expect(EDITOR_OPERATION_TYPES).not.toContain("SELECT");
    expect(() =>
      validateOperation({ type: "SELECT", nodeId: "n1" } as never),
    ).toThrow(/unknown/i);
  });

  it("accepts an allowlisted style patch untouched", () => {
    expect(
      validateOperation({
        type: "SET_STYLE",
        nodeId: "n1",
        style: { fontSize: 24, align: "CENTER", color: "#ffffff" },
      }),
    ).toEqual({
      type: "SET_STYLE",
      nodeId: "n1",
      style: { fontSize: 24, align: "CENTER", color: "#ffffff" },
    });
  });

  it("refuses a style patch with a field the editor does not control", () => {
    expect(() =>
      validateOperation({ type: "SET_STYLE", nodeId: "n1", style: { bogus: 1 } }),
    ).toThrow(/unknown style field/i);
  });

  it("refuses mistyped style fields instead of coercing them", () => {
    expect(() =>
      validateOperation({ type: "SET_STYLE", nodeId: "n1", style: { fontSize: "24" } }),
    ).toThrow(/font size/i);
    expect(() =>
      validateOperation({ type: "SET_STYLE", nodeId: "n1", style: { color: 5 } }),
    ).toThrow(/color/i);
    expect(() =>
      validateOperation({ type: "SET_STYLE", nodeId: "n1", style: { align: "MIDDLE" } }),
    ).toThrow(/alignment/i);
    expect(() =>
      validateOperation({ type: "SET_STYLE", nodeId: "n1", style: { radius: -1 } }),
    ).toThrow(/radius/i);
  });

  it("refuses an unknown style field during application, not just at the wire", () => {
    const start = snapshot([node({ id: "n1", text: { value: "Hi" } })]);

    expect(() =>
      applyOperation(start, {
        type: "SET_STYLE",
        nodeId: "n1",
        style: { bogus: 1 } as never,
      }),
    ).toThrow(/unknown style field/i);
  });

  it("merges a patch and lets null clear a single field", () => {
    const start = snapshot([
      node({ id: "n1", text: { value: "hi" }, style: { ...emptyStyle(), fontSize: 12 } }),
    ]);

    const { snapshot: out } = applyOperation(start, {
      type: "SET_STYLE",
      nodeId: "n1",
      style: { align: "RIGHT", fontSize: null },
    });

    expect(out.nodes[0]?.style).toEqual({ ...emptyStyle(), align: "RIGHT" });
  });
});

describe("strict node validation", () => {
  it("refuses a node whose type is not one of the six", () => {
    expect(() =>
      validateSnapshot(snapshot([node({ id: "n1", type: "VIDEO_GAME" as never })])),
    ).toThrow(/unknown node type/i);
  });

  it("refuses a node whose id or name is not text", () => {
    expect(() =>
      validateSnapshot(snapshot([node({ id: 7 as never })])),
    ).toThrow(/string id/i);
    expect(() =>
      validateSnapshot(snapshot([node({ id: "n1", name: 9 as never })])),
    ).toThrow(/name must be text/i);
  });

  it("refuses a node whose visibility is not a boolean", () => {
    expect(() =>
      validateSnapshot(snapshot([node({ id: "n1", visible: "yes" as never })])),
    ).toThrow(/visibility/i);
  });

  it("refuses an audio node that carries no settings", () => {
    expect(() =>
      validateSnapshot(
        snapshot([
          node({ id: "a1", type: "AUDIO", text: null, asset: AUDIO_ASSET, audio: null }),
        ]),
      ),
    ).toThrow(/audio settings/i);
  });

  it("refuses audio settings on a node that is not audio", () => {
    expect(() =>
      validateSnapshot(snapshot([node({ id: "n1", audio: AUDIO_SETTINGS })])),
    ).toThrow(/cannot carry audio settings/i);
  });

  it("refuses a trim on a node that has no playable window", () => {
    expect(() =>
      validateSnapshot(
        snapshot([node({ id: "n1", trim: { startMs: 0, endMs: 1_000 } })]),
      ),
    ).toThrow(/cannot be trimmed/i);
  });

  it("refuses malformed motion, effects or provenance rather than storing them", () => {
    expect(() =>
      validateSnapshot(snapshot([node({ id: "n1", motion: { keyframes: "nope" } as never })])),
    ).toThrow(/keyframe/i);
    expect(() =>
      validateSnapshot(snapshot([node({ id: "n1", effects: {} as never })])),
    ).toThrow(/effects/i);
    expect(() =>
      validateSnapshot(
        snapshot([node({ id: "n1", provenance: { origin: "MYSTERY" } as never })]),
      ),
    ).toThrow(/provenance/i);
  });

  it("refuses asset metadata that could not be real", () => {
    expect(() =>
      validateSnapshot(
        snapshot([
          node({
            id: "n1",
            type: "IMAGE",
            text: null,
            asset: { ...IMAGE_ASSET, byteSize: "big" as never },
          }),
        ]),
      ),
    ).toThrow(/finite number/i);
    expect(() =>
      validateSnapshot(
        snapshot([
          node({
            id: "n1",
            type: "IMAGE",
            text: null,
            asset: { ...IMAGE_ASSET, origin: "MYSTERY" as never },
          }),
        ]),
      ),
    ).toThrow(/origin/i);
  });
});

describe("strict creation", () => {
  it("refuses to create an audio node without its settings", () => {
    expect(() =>
      applyOperation(snapshot([]), {
        type: "CREATE",
        node: node({ id: "a1", type: "AUDIO", text: null, asset: AUDIO_ASSET, audio: null }),
      }),
    ).toThrow(/audio settings/i);
  });

  it("completes a created node's style from the canonical empty style", () => {
    const { snapshot: out } = applyOperation(snapshot([]), {
      type: "CREATE",
      node: node({
        id: "n1",
        text: { value: "" },
        style: { fontSize: 20 } as never,
      }),
    });

    expect(out.nodes[0]?.style).toEqual({ ...emptyStyle(), fontSize: 20 });
  });

  it("refuses to create a text node carrying a shape", () => {
    expect(() =>
      applyOperation(snapshot([]), {
        type: "CREATE",
        node: node({
          id: "n1",
          text: { value: "hi" },
          shape: { shapeType: "RECT" },
        }),
      }),
    ).toThrow(/cannot carry/i);
  });
});
