import { ImageGenerationError } from "../errors";

export const ASSET_REF_PREFIXES = [
  "capture",
  "brand",
  "product",
  "generated",
] as const;
export type AssetRefKind = (typeof ASSET_REF_PREFIXES)[number];

export type ParsedAssetReference = { kind: AssetRefKind; id: string };

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * An asset reference is `<kind>:<id>`. It is deliberately not a URL or a path:
 * a reference that looked like either is rejected here so it can never reach a
 * filesystem or a fetch, which is what makes the resolver safe to hand raw user
 * input.
 */
export function parseAssetReference(reference: string): ParsedAssetReference {
  if (typeof reference !== "string" || reference.length === 0) {
    throw invalid(`Empty asset reference`);
  }
  if (
    reference.includes("://") ||
    reference.includes("/") ||
    reference.includes("\\") ||
    reference.includes("..") ||
    reference.includes("\0")
  ) {
    throw invalid(`Asset reference must be a logical id, got: ${reference}`);
  }

  const separator = reference.indexOf(":");
  if (separator <= 0) {
    throw invalid(`Asset reference must be <kind>:<id>, got: ${reference}`);
  }

  const kind = reference.slice(0, separator);
  const id = reference.slice(separator + 1);

  if (!ASSET_REF_PREFIXES.includes(kind as AssetRefKind)) {
    throw invalid(`Unsupported asset reference kind: ${kind}`);
  }
  if (!ID_PATTERN.test(id)) {
    throw invalid(`Asset reference id is not a plain id: ${id}`);
  }

  return { kind: kind as AssetRefKind, id };
}

export function generatedAssetRef(assetId: string): string {
  if (!ID_PATTERN.test(assetId)) {
    throw invalid("Generated asset id is not a plain id");
  }
  return `generated:${assetId}`;
}

function invalid(message: string): ImageGenerationError {
  return new ImageGenerationError("IMAGE_SOURCE_NOT_FOUND", message, 422);
}
