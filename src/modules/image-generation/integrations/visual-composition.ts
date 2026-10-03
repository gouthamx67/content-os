import { generatedAssetRef } from "../assets/asset-reference";

export type GeneratedAssetView = {
  id: string;
  width: number;
  height: number;
  mimeType: string;
  transparent: boolean;
};

export type VisualCompositionImageSource = {
  kind: "GENERATED_IMAGE";
  assetId: string;
  /** The reference CP14 stores as a media layer source. */
  ref: string;
  url: string;
  width: number;
  height: number;
  mimeType: string;
  transparent: boolean;
};

/**
 * The bridge CP14 consumes. It exposes only what a media layer needs — a stable
 * logical ref, a stream URL and intrinsic dimensions — and never a storage key
 * or a filesystem path.
 */
export function resolveGeneratedAsset(
  projectId: string,
  asset: GeneratedAssetView,
): VisualCompositionImageSource {
  return {
    kind: "GENERATED_IMAGE",
    assetId: asset.id,
    ref: generatedAssetRef(asset.id),
    url: `/api/projects/${projectId}/images/assets/${asset.id}/stream`,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType,
    transparent: asset.transparent,
  };
}
