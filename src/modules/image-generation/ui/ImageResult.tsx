"use client";

import type { GeneratedAssetView } from "./types";

/**
 * Renders the raster a job produced.
 *
 * The bytes come from the project-scoped stream route, never from a storage key,
 * and the intrinsic size is shown so a wrong canvas is visible without opening
 * an inspector.
 */
export function ImageResult({ asset }: { asset: GeneratedAssetView | null }) {
  if (!asset) return null;

  return (
    <figure
      data-testid="generated-image-result"
      data-asset-id={asset.id}
      className="overflow-hidden rounded-xl border border-[#202329] bg-[#0b0c0f] p-3"
    >
      <img
        src={asset.streamUrl}
        alt="Generated graphic"
        width={asset.width}
        height={asset.height}
        className="mx-auto max-w-full rounded-md"
      />
      <figcaption
        data-testid="generated-image-meta"
        className="mt-2 text-center text-[11px] text-[#777b84]"
      >
        {asset.width}×{asset.height} · {asset.outputFormat}
        {asset.transparent ? " · transparent" : ""} · {asset.byteSize} bytes
      </figcaption>
    </figure>
  );
}
