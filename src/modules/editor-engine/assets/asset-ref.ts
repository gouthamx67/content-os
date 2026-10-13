import { EditorError } from "../errors";
import {
  EDITOR_MEDIA_KINDS,
  EDITOR_PROVENANCE_ORIGINS,
  isMediaNodeType,
  type EditorMediaKind,
  type EditorNode,
  type EditorNodeAsset,
} from "../domain/types";

/**
 * The only asset references the editor will store.
 *
 * A ref is `<prefix>:<id>`, and the prefix names the module that owns the
 * artifact. That indirection is the security property: the editor never holds a
 * storage key, so it cannot hand one to the browser, and an id from another
 * project is refused at resolution time rather than rendered.
 */
export const ASSET_REF_PREFIXES = [
  "capture",
  "generated",
  "brand",
  "product",
  "asset",
  "adaptation",
  "writing",
] as const;
export type AssetRefPrefix = (typeof ASSET_REF_PREFIXES)[number];

/** Which CP module owns each prefix, for the stream route and lineage. */
export const ASSET_REF_OWNER: Record<AssetRefPrefix, string> = {
  capture: "CP13_CAPTURE",
  generated: "CP17_IMAGE",
  brand: "CP02_BRAND",
  product: "CP03_PRODUCT",
  asset: "CP02_BRAND_CP03_PRODUCT",
  adaptation: "CP19_MULTIFORMAT",
  writing: "CP18_WRITING",
};

export const NODE_TYPE_TO_ASSET_KIND: Record<string, EditorMediaKind> = {
  IMAGE: "IMAGE",
  VIDEO: "VIDEO",
  AUDIO: "AUDIO",
};

export type ParsedAssetRef = {
  prefix: AssetRefPrefix;
  id: string;
  ref: string;
};

export function parseAssetRef(value: unknown): ParsedAssetRef {
  if (typeof value !== "string" || value.length === 0) {
    throw new EditorError(
      "EDITOR_INVALID_ASSET_REFERENCE",
      "An asset reference must be a non-empty string",
    );
  }

  const separator = value.indexOf(":");

  if (separator <= 0 || separator === value.length - 1) {
    throw new EditorError(
      "EDITOR_INVALID_ASSET_REFERENCE",
      "An asset reference must look like <prefix>:<id>",
    );
  }

  const prefix = value.slice(0, separator);
  const id = value.slice(separator + 1);

  if (!(ASSET_REF_PREFIXES as readonly string[]).includes(prefix)) {
    throw new EditorError(
      "EDITOR_INVALID_ASSET_REFERENCE",
      `Unknown asset reference prefix: ${prefix}`,
    );
  }

  // A second colon would mean the id itself carries structure the editor does
  // not understand. Refusing here keeps the id a single opaque token.
  if (id.includes(":")) {
    throw new EditorError(
      "EDITOR_INVALID_ASSET_REFERENCE",
      "An asset reference may contain exactly one colon",
    );
  }

  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) {
    throw new EditorError(
      "EDITOR_INVALID_ASSET_REFERENCE",
      "An asset reference id must be an opaque identifier",
    );
  }

  return { prefix: prefix as AssetRefPrefix, id, ref: `${prefix}:${id}` };
}

/** Builds a ref from a prefix and id, normalising it in the same place. */
export function assetRef(prefix: AssetRefPrefix, id: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) {
    throw new EditorError(
      "EDITOR_INVALID_ASSET_REFERENCE",
      "An asset reference id must be an opaque identifier",
    );
  }
  return `${prefix}:${id}`;
}

/**
 * Refuses a ref whose prefix cannot hold media of the node's kind.
 *
 * `writing:` is a text checkpoint, so a `VIDEO` node may not point at one; the
 * asymmetry matters because a wrong-but-resolvable ref would render as a broken
 * frame much later, where the cause is no longer visible.
 */
export function assertAssetSupportsNodeType(
  ref: string,
  nodeType: string,
): ParsedAssetRef {
  const parsed = parseAssetRef(ref);

  if (!isMediaNodeType(nodeType as never)) {
    throw new EditorError(
      "EDITOR_NODE_TYPE_MISMATCH",
      `A ${nodeType} node cannot reference an asset`,
    );
  }

  if (parsed.prefix === "writing") {
    throw new EditorError(
      "EDITOR_NODE_TYPE_MISMATCH",
      "Writing copy is text and cannot back a media node",
    );
  }

  return parsed;
}

export function assertAssetKindMatchesNode(
  asset: EditorNodeAsset,
  nodeType: EditorNode["type"],
): void {
  const expected = NODE_TYPE_TO_ASSET_KIND[nodeType];

  if (!expected) {
    throw new EditorError(
      "EDITOR_NODE_TYPE_MISMATCH",
      `A ${nodeType} node cannot reference an asset`,
    );
  }

  if (asset.kind !== expected) {
    throw new EditorError(
      "EDITOR_NODE_TYPE_MISMATCH",
      `A ${nodeType} node cannot use a ${asset.kind} asset`,
    );
  }

  if (!(EDITOR_MEDIA_KINDS as readonly string[]).includes(asset.kind)) {
    throw new EditorError(
      "EDITOR_NODE_TYPE_MISMATCH",
      "An asset must be an image, a video or audio",
    );
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Rejects an asset whose recorded shape or metadata could not be real.
 *
 * The ref is the security boundary, but the metadata is what the editor renders
 * from: a byte size that is a string, an unknown origin or a negative duration
 * would pass the ref check and only surface as a broken frame much later.
 */
export function assertAssetMetadataPlausible(
  asset: EditorNodeAsset,
): void {
  if (typeof asset !== "object" || asset === null || Array.isArray(asset)) {
    throw new EditorError(
      "EDITOR_INVALID_ASSET_REFERENCE",
      "An asset must be an object",
    );
  }

  if (typeof asset.ref !== "string" || typeof asset.assetId !== "string") {
    throw new EditorError(
      "EDITOR_INVALID_ASSET_REFERENCE",
      "An asset needs a reference and an id",
    );
  }

  if (!(EDITOR_MEDIA_KINDS as readonly string[]).includes(asset.kind)) {
    throw new EditorError(
      "EDITOR_INVALID_ASSET_REFERENCE",
      "An asset must be an image, a video or audio",
    );
  }

  if (!(EDITOR_PROVENANCE_ORIGINS as readonly string[]).includes(asset.origin)) {
    throw new EditorError(
      "EDITOR_INVALID_ASSET_REFERENCE",
      "An asset must record a known origin",
    );
  }

  if (typeof asset.sourceType !== "string" || asset.sourceType.length === 0) {
    throw new EditorError(
      "EDITOR_INVALID_ASSET_REFERENCE",
      "An asset must name its source type",
    );
  }

  if (asset.sourceId !== null && typeof asset.sourceId !== "string") {
    throw new EditorError(
      "EDITOR_INVALID_ASSET_REFERENCE",
      "An asset source id must be text or empty",
    );
  }

  if (asset.mimeType !== null && typeof asset.mimeType !== "string") {
    throw new EditorError(
      "EDITOR_INVALID_ASSET_REFERENCE",
      "An asset mime type must be text or empty",
    );
  }

  for (const [label, value] of [
    ["byte size", asset.byteSize],
    ["width", asset.width],
    ["height", asset.height],
    ["duration", asset.durationMs],
  ] as const) {
    if (value !== null && !isFiniteNumber(value)) {
      throw new EditorError(
        "EDITOR_INVALID_ASSET_REFERENCE",
        `An asset ${label} must be a finite number`,
      );
    }
  }

  if (asset.byteSize !== null && asset.byteSize <= 0) {
    throw new EditorError(
      "EDITOR_INVALID_ASSET_REFERENCE",
      "An asset byte size must be positive",
    );
  }

  for (const [label, value] of [
    ["width", asset.width],
    ["height", asset.height],
  ] as const) {
    if (value !== null && (value <= 0 || value > 8192)) {
      throw new EditorError(
        "EDITOR_INVALID_ASSET_REFERENCE",
        `An asset ${label} must sit between 1 and 8192`,
      );
    }
  }

  if (asset.durationMs !== null && asset.durationMs < 0) {
    throw new EditorError(
      "EDITOR_INVALID_ASSET_REFERENCE",
      "An asset duration cannot be negative",
    );
  }
}
