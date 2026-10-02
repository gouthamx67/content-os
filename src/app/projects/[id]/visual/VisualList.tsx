"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../../components/ui/Button";
import type { SceneGraph } from "../../../../modules/visual-motion-engine/serialization/scene-graph";

interface Props {
  projectId: string;
  initialCompositions: SceneGraph[];
}

export function VisualList({ projectId, initialCompositions }: Props) {
  const router = useRouter();
  const [compositions, setCompositions] = useState(initialCompositions);
  const [name, setName] = useState("");
  const [width, setWidth] = useState("1080");
  const [height, setHeight] = useState("1920");
  const [frameRate, setFrameRate] = useState("30");
  const [durationMs, setDurationMs] = useState("5000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/visual/compositions`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim().length > 0 ? name : undefined,
            width: Number(width),
            height: Number(height),
            frameRate: Number(frameRate),
            durationMs: Number(durationMs),
          }),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? "Could not create composition");
        return;
      }

      const payload = (await response.json()) as { composition: SceneGraph };
      setCompositions((current) => [...current, payload.composition]);
      setName("");
      router.push(
        `/projects/${projectId}/visual/${payload.composition.id}`,
      );
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        {compositions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#30343c] p-6 text-sm text-[#777b84]">
            No compositions yet. Create one to start building a canvas.
          </p>
        ) : (
          <ul className="space-y-2">
            {compositions.map((composition) => (
              <li key={composition.id}>
                <Link
                  href={`/projects/${projectId}/visual/${composition.id}`}
                  data-testid="composition-item"
                  data-composition-id={composition.id}
                  className="flex items-center justify-between rounded-xl border border-[#202329] bg-[#101216] px-4 py-3 hover:border-[#30343c]"
                >
                  <span>
                    <span className="block text-sm text-white">
                      {composition.name}
                    </span>
                    <span className="text-xs text-[#62666f]">
                      {composition.width}×{composition.height} ·{" "}
                      {composition.frameRate} fps · {composition.durationMs} ms
                    </span>
                  </span>
                  <span className="text-xs text-[#62666f]">
                    {composition.layers.length} layer
                    {composition.layers.length === 1 ? "" : "s"} ·{" "}
                    {composition.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        onSubmit={create}
        className="h-fit rounded-xl border border-[#202329] bg-[#101216] p-4"
      >
        <p className="text-xs uppercase tracking-wide text-[#62666f]">
          New composition
        </p>

        <label className="mt-3 block text-[10px] text-[#777b84]">
          Name
          <input
            data-testid="composition-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Untitled composition"
            className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {(
            [
              ["width", "Width", width, setWidth],
              ["height", "Height", height, setHeight],
              ["frameRate", "FPS", frameRate, setFrameRate],
              ["durationMs", "Duration (ms)", durationMs, setDurationMs],
            ] as const
          ).map(([key, label, value, setter]) => (
            <label key={key} className="text-[10px] text-[#777b84]">
              {label}
              <input
                data-testid={`composition-${key}`}
                value={value}
                onChange={(event) => setter(event.target.value)}
                inputMode="numeric"
                className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1 text-xs text-white"
              />
            </label>
          ))}
        </div>

        {error && (
          <p className="mt-3 text-xs text-red-300" data-testid="create-error">
            {error}
          </p>
        )}

        <Button
          className="mt-4 w-full"
          disabled={busy}
          data-testid="create-composition"
        >
          Create composition
        </Button>
      </form>
    </div>
  );
}
