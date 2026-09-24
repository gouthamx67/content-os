"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";

export type SourceItem = {
  id: string;
  type: string;
  name: string;
  uri: string | null;
  createdAt: string;
};

export type AssetItem = {
  id: string;
  type: string;
  name: string;
  uri: string;
  createdAt: string;
};

export function SourceAssetForms({
  projectId,
  sources,
  assets,
}: {
  projectId: string;
  sources: SourceItem[];
  assets: AssetItem[];
}) {
  const router = useRouter();

  const [sourceName, setSourceName] = useState("");

  const [sourceUri, setSourceUri] = useState("");

  const [assetName, setAssetName] = useState("");

  const [assetUri, setAssetUri] = useState("");

  const [error, setError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  async function addSource(event: React.FormEvent) {
    event.preventDefault();

    setError(null);

    setLoading(true);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/sources`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "WEBSITE",
            name: sourceName.trim() || "Website",
            uri: sourceUri.trim() || undefined,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Unable to add source");

        return;
      }

      setSourceName("");

      setSourceUri("");

      router.refresh();
    } catch {
      setError("Unable to add source");
    } finally {
      setLoading(false);
    }
  }

  async function addAsset(event: React.FormEvent) {
    event.preventDefault();

    setError(null);

    setLoading(true);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/assets`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "IMAGE",
            name: assetName.trim() || "Asset",
            uri: assetUri.trim() || "",
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Unable to add asset");

        return;
      }

      setAssetName("");

      setAssetUri("");

      router.refresh();
    } catch {
      setError("Unable to add asset");
    } finally {
      setLoading(false);
    }
  }

  async function removeSource(sourceId: string) {
    setError(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/sources/${sourceId}`,
        { method: "DELETE" },
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Unable to remove source");

        return;
      }

      router.refresh();
    } catch {
      setError("Unable to remove source");
    }
  }

  async function removeAsset(assetId: string) {
    setError(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/assets/${assetId}`,
        { method: "DELETE" },
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Unable to remove asset");

        return;
      }

      router.refresh();
    } catch {
      setError("Unable to remove asset");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-[#24272e] bg-[#101216] p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium text-white">
          <Link2 size={16} />
          Sources
        </h2>

        <ul className="mt-4 space-y-2">
          {sources.length === 0 ? (
            <li className="text-sm text-[#777b84]">
              No sources yet.
            </li>
          ) : (
            sources.map((source) => (
              <li
                key={source.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[#24272e] bg-[#15171c] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">
                    {source.name}
                  </p>

                  <p className="truncate text-xs text-[#777b84]">
                    {source.type}
                    {source.uri ? ` · ${source.uri}` : ""}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => removeSource(source.id)}
                  className="shrink-0 text-[#62666f] transition-colors hover:text-red-400"
                  aria-label={`Remove ${source.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))
          )}
        </ul>

        <form onSubmit={addSource} className="mt-4 space-y-2">
          <input
            type="text"
            value={sourceName}
            onChange={(event) => setSourceName(event.target.value)}
            className="w-full rounded-lg border border-[#30343c] bg-[#15171c] px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#62666f] focus:border-white/40"
            placeholder="Source name"
          />

          <div className="flex gap-2">
            <input
              type="url"
              value={sourceUri}
              onChange={(event) => setSourceUri(event.target.value)}
              className="w-full rounded-lg border border-[#30343c] bg-[#15171c] px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#62666f] focus:border-white/40"
              placeholder="https://example.com"
            />

            <Button type="submit" disabled={loading}>
              <Plus size={14} />
              Add
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-[#24272e] bg-[#101216] p-5">
        <h2 className="text-sm font-medium text-white">Assets</h2>

        <ul className="mt-4 space-y-2">
          {assets.length === 0 ? (
            <li className="text-sm text-[#777b84]">
              No assets yet.
            </li>
          ) : (
            assets.map((asset) => (
              <li
                key={asset.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[#24272e] bg-[#15171c] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">
                    {asset.name}
                  </p>

                  <p className="truncate text-xs text-[#777b84]">
                    {asset.type}
                    {asset.uri ? ` · ${asset.uri}` : ""}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => removeAsset(asset.id)}
                  className="shrink-0 text-[#62666f] transition-colors hover:text-red-400"
                  aria-label={`Remove ${asset.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))
          )}
        </ul>

        <form onSubmit={addAsset} className="mt-4 space-y-2">
          <input
            type="text"
            value={assetName}
            onChange={(event) => setAssetName(event.target.value)}
            className="w-full rounded-lg border border-[#30343c] bg-[#15171c] px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#62666f] focus:border-white/40"
            placeholder="Asset name"
          />

          <div className="flex gap-2">
            <input
              type="url"
              value={assetUri}
              onChange={(event) => setAssetUri(event.target.value)}
              className="w-full rounded-lg border border-[#30343c] bg-[#15171c] px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#62666f] focus:border-white/40"
              placeholder="https://…/image.png"
            />

            <Button type="submit" disabled={loading}>
              <Plus size={14} />
              Add
            </Button>
          </div>
        </form>
      </section>

      {error ? (
        <p className="text-sm text-red-400 lg:col-span-2">{error}</p>
      ) : null}
    </div>
  );
}