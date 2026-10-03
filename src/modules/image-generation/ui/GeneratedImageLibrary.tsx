"use client";

import type { GeneratedAssetView } from "./types";

/**
 * The project's generated images, newest first.
 *
 * Every row is a real artifact: the thumbnail is the stored raster and the
 * caption is its measured size, so a row that renders is a row that exists.
 */
export function GeneratedImageLibrary({
  assets,
  selectedId,
  onSelect,
}: {
  assets: GeneratedAssetView[];
  selectedId: string | null;
  onSelect: (asset: GeneratedAssetView) => void;
}) {
  return (
    <div
      data-testid="generated-image-library"
      className="rounded-xl border border-[#202329] bg-[#101216] p-4"
    >
      <p className="text-xs uppercase tracking-wide text-[#62666f]">
        Generated images
      </p>

      {assets.length === 0 ? (
        <p className="mt-2 text-xs text-[#62666f]">No generated images yet.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {assets.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                data-testid="generated-image-item"
                data-asset-id={asset.id}
                onClick={() => onSelect(asset)}
                className={[
                  "w-full overflow-hidden rounded-lg border p-1 text-left",
                  asset.id === selectedId
                    ? "border-sky-400 bg-[#15171c]"
                    : "border-[#202329] bg-[#0b0c0f] hover:border-[#30343c]",
                ].join(" ")}
              >
                <img
                  src={asset.streamUrl}
                  alt="Generated graphic thumbnail"
                  className="h-20 w-full rounded object-cover"
                />
                <span className="mt-1 block truncate px-1 text-[10px] text-[#b4b7bf]">
                  {asset.width}×{asset.height} {asset.outputFormat}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
