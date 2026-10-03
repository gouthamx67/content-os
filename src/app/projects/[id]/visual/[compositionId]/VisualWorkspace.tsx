"use client";

import { useState } from "react";
import { Button } from "../../../../../components/ui/Button";
import type {
  SceneGraph,
  SceneGraphLayer,
} from "../../../../../modules/visual-motion-engine/serialization/scene-graph";
import type { VisualEffectType } from "../../../../../modules/visual-motion-engine/domain/types";
import { CompositionPreview } from "./CompositionPreview";
import { LayerInspector, type LayerTransform } from "./LayerInspector";
import { MotionTimeline, type KeyframeInput } from "./MotionTimeline";
import { RenderPanel } from "./RenderPanel";
import { AudioWorkspace } from "../../../../../modules/audio-engine/ui/AudioWorkspace";
import type { AudioCompositionView } from "../../../../../modules/audio-engine/ui/types";

interface Props {
  projectId: string;
  initialComposition: SceneGraph;
  initialAudioComposition: AudioCompositionView;
  brandDefaultColor: string | null;
}

export function VisualWorkspace({
  projectId,
  initialComposition,
  initialAudioComposition,
  brandDefaultColor,
}: Props) {
  const [composition, setComposition] = useState(initialComposition);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(
    initialComposition.layers[0]?.id ?? null,
  );
  const [timeMs, setTimeMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [mediaRef, setMediaRef] = useState("");
  const [textValue, setTextValue] = useState("");

  const selectedLayer: SceneGraphLayer | null =
    composition.layers.find((layer) => layer.id === selectedLayerId) ?? null;

  const base = `/api/projects/${projectId}/visual/compositions/${composition.id}`;

  async function send(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<SceneGraph | null> {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(path, {
        method,
        credentials: "include",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? `Request failed (${response.status})`);
        return null;
      }

      const payload = (await response.json()) as { composition?: SceneGraph };

      if (payload.composition) {
        setComposition(payload.composition);
        return payload.composition;
      }

      return null;
    } catch {
      setError("Network error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function addLayer(type: "MEDIA" | "TEXT") {
    const body: Record<string, unknown> = { type };

    if (type === "MEDIA") {
      if (mediaRef.trim().length === 0) {
        setError("Enter a capture: or asset: reference first");
        return;
      }
      body["assetRef"] = mediaRef.trim();
    } else {
      body["textContent"] = textValue.trim().length > 0 ? textValue : "Text";
    }

    const next = await send(`${base}/layers`, "POST", body);

    if (next) {
      setMediaRef("");
      setTextValue("");
      const created = next.layers[next.layers.length - 1];
      if (created) setSelectedLayerId(created.id);
      setNotice(`${type === "MEDIA" ? "Media" : "Text"} layer added`);
    }
  }

  async function deleteLayer(layerId: string) {
    const next = await send(`${base}/layers/${layerId}`, "DELETE");

    if (next) {
      setSelectedLayerId(next.layers[0]?.id ?? null);
      setNotice("Layer removed");
    }
  }

  async function saveLayer(transform: LayerTransform) {
    if (!selectedLayer) return;

    const next = await send(
      `${base}/layers/${selectedLayer.id}`,
      "PATCH",
      transform,
    );

    if (next) setNotice("Layer updated");
  }

  async function addEffect(type: VisualEffectType, amount: number) {
    if (!selectedLayer) return;

    if (!Number.isFinite(amount)) {
      setError("Effect amount must be a number");
      return;
    }

    const next = await send(
      `${base}/layers/${selectedLayer.id}/effects`,
      "POST",
      { type, amount },
    );

    if (next) setNotice("Effect applied");
  }

  async function deleteEffect(effectId: string) {
    if (!selectedLayer) return;
    const next = await send(
      `${base}/layers/${selectedLayer.id}/effects/${effectId}`,
      "DELETE",
    );
    if (next) setNotice("Effect removed");
  }

  async function addKeyframe(input: KeyframeInput) {
    if (!selectedLayer) return;
    const next = await send(
      `${base}/layers/${selectedLayer.id}/keyframes`,
      "POST",
      input,
    );
    if (next) setNotice("Keyframe saved");
  }

  async function deleteKeyframe(keyframeId: string) {
    if (!selectedLayer) return;
    const next = await send(
      `${base}/layers/${selectedLayer.id}/keyframes/${keyframeId}`,
      "DELETE",
    );
    if (next) setNotice("Keyframe removed");
  }

  async function applyPreset(presetId: string) {
    if (!selectedLayer) return;
    const next = await send(
      `${base}/layers/${selectedLayer.id}/preset`,
      "POST",
      { presetId },
    );
    if (next) setNotice(`Preset ${presetId} applied`);
  }

  return (
    <div className="space-y-6">
      {(error || notice) && (
        <p
          data-testid="visual-status"
          className={[
            "rounded-md border px-3 py-2 text-xs",
            error
              ? "border-red-500/40 bg-red-500/10 text-red-300"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
          ].join(" ")}
        >
          {error || notice}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-4">
          <div className="rounded-xl border border-[#202329] bg-[#101216] p-4">
            <p className="text-xs uppercase tracking-wide text-[#62666f]">
              Layers
            </p>
            <ul className="mt-2 space-y-1">
              {composition.layers.length === 0 ? (
                <li className="text-xs text-[#62666f]">No layers yet.</li>
              ) : (
                composition.layers.map((layer) => (
                  <li key={layer.id}>
                    <button
                      type="button"
                      data-testid="layer-list-item"
                      data-layer-id={layer.id}
                      onClick={() => setSelectedLayerId(layer.id)}
                      className={[
                        "flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-xs",
                        layer.id === selectedLayerId
                          ? "border-sky-400 bg-[#15171c] text-white"
                          : "border-[#202329] bg-[#0b0c0f] text-[#b4b7bf] hover:text-white",
                      ].join(" ")}
                    >
                      <span className="truncate">{layer.name}</span>
                      <span className="text-[10px] text-[#62666f]">
                        {layer.type}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>

            {selectedLayer && (
              <Button
                variant="secondary"
                className="mt-3 w-full"
                disabled={busy}
                data-testid="delete-layer"
                onClick={() => void deleteLayer(selectedLayer.id)}
              >
                Delete layer
              </Button>
            )}
          </div>

          <div className="rounded-xl border border-[#202329] bg-[#101216] p-4">
            <p className="text-xs uppercase tracking-wide text-[#62666f]">
              Add layer
            </p>

            <div className="mt-3 space-y-2">
              <input
                data-testid="media-ref-input"
                value={mediaRef}
                onChange={(event) => setMediaRef(event.target.value)}
                placeholder="capture:takeId"
                className="w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
              />
              <Button
                variant="secondary"
                className="w-full"
                disabled={busy}
                data-testid="add-media-layer"
                onClick={() => void addLayer("MEDIA")}
              >
                Add media
              </Button>
            </div>

            <div className="mt-3 space-y-2">
              <input
                data-testid="text-input"
                value={textValue}
                onChange={(event) => setTextValue(event.target.value)}
                placeholder="Headline"
                className="w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
              />
              <Button
                variant="secondary"
                className="w-full"
                disabled={busy}
                data-testid="add-text-layer"
                onClick={() => void addLayer("TEXT")}
              >
                Add text
              </Button>
            </div>

            {brandDefaultColor && (
              <p className="mt-3 text-[10px] text-[#62666f]">
                Brand background: {brandDefaultColor}
              </p>
            )}
          </div>
        </aside>

        <div className="space-y-6">
          <CompositionPreview
            composition={composition}
            timeMs={timeMs}
            selectedLayerId={selectedLayerId}
            onSelectLayer={setSelectedLayerId}
          />

          {selectedLayer && (
            <LayerInspector
              key={selectedLayer.id}
              layer={selectedLayer}
              busy={busy}
              onSave={saveLayer}
              onAddEffect={addEffect}
              onDeleteEffect={deleteEffect}
            />
          )}

          <MotionTimeline
            composition={composition}
            timeMs={timeMs}
            onTimeChange={setTimeMs}
            selectedLayer={selectedLayer}
            busy={busy}
            onAddKeyframe={addKeyframe}
            onDeleteKeyframe={deleteKeyframe}
            onApplyPreset={applyPreset}
          />

          <RenderPanel
            projectId={projectId}
            compositionId={composition.id}
          />

          <AudioWorkspace
            projectId={projectId}
            compositionId={composition.id}
            initialComposition={initialAudioComposition}
          />
        </div>
      </div>
    </div>
  );
}
