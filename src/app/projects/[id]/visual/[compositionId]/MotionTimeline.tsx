"use client";

import { useState } from "react";
import { motionPalette } from "../../../../../modules/visual-motion-engine/ui-options";
import type {
  SceneGraph,
  SceneGraphLayer,
} from "../../../../../modules/visual-motion-engine/serialization/scene-graph";
import type { MotionProperty } from "../../../../../modules/visual-motion-engine/domain/types";
import { MOTION_PRESETS } from "../../../../../modules/visual-motion-engine/presets";

export type KeyframeInput = {
  property: MotionProperty;
  timeMs: number;
  fromValue: number;
  toValue: number;
  easing: string;
};

interface Props {
  composition: SceneGraph;
  timeMs: number;
  onTimeChange: (timeMs: number) => void;
  selectedLayer: SceneGraphLayer | null;
  busy: boolean;
  onAddKeyframe: (input: KeyframeInput) => Promise<void>;
  onDeleteKeyframe: (keyframeId: string) => Promise<void>;
  onApplyPreset: (presetId: string) => Promise<void>;
}

export function MotionTimeline({
  composition,
  timeMs,
  onTimeChange,
  selectedLayer,
  busy,
  onAddKeyframe,
  onDeleteKeyframe,
  onApplyPreset,
}: Props) {
  const [property, setProperty] = useState<MotionProperty>("OPACITY");
  const [fromValue, setFromValue] = useState("0");
  const [toValue, setToValue] = useState("1");
  const [easing, setEasing] = useState("LINEAR");

  async function submitKeyframe(event: React.FormEvent) {
    event.preventDefault();

    if (!selectedLayer) return;

    const from = Number(fromValue);
    const to = Number(toValue);

    if (!Number.isFinite(from) || !Number.isFinite(to)) return;

    await onAddKeyframe({
      property,
      timeMs,
      fromValue: from,
      toValue: to,
      easing,
    });
  }

  return (
    <div className="rounded-xl border border-[#202329] bg-[#101216] p-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-[#62666f]">
        <span>Timeline</span>
        <span data-testid="timeline-time">{timeMs} ms</span>
      </div>

      <input
        type="range"
        data-testid="timeline-scrubber"
        min={0}
        max={composition.durationMs}
        step={1}
        value={Math.min(timeMs, composition.durationMs)}
        onChange={(event) => onTimeChange(Number(event.target.value))}
        className="mt-3 w-full accent-sky-400"
      />

      {selectedLayer ? (
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#62666f]">
              Motion presets
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.values(MOTION_PRESETS).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={busy}
                  data-testid={`preset-${preset.id}`}
                  title={preset.description}
                  onClick={() => void onApplyPreset(preset.id)}
                  className="rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1 text-[11px] text-[#b4b7bf] hover:text-white disabled:opacity-50"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <form onSubmit={submitKeyframe} className="mt-4 space-y-2">
              <p className="text-xs uppercase tracking-wide text-[#62666f]">
                Add keyframe at {timeMs} ms
              </p>
              <div className="flex flex-wrap gap-2">
                <select
                  data-testid="keyframe-property"
                  value={property}
                  onChange={(event) =>
                    setProperty(event.target.value as MotionProperty)
                  }
                  className="rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1 text-xs text-white"
                >
                  {motionPalette.properties.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <select
                  data-testid="keyframe-easing"
                  value={easing}
                  onChange={(event) => setEasing(event.target.value)}
                  className="rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1 text-xs text-white"
                >
                  {motionPalette.easings.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <input
                  data-testid="keyframe-from"
                  value={fromValue}
                  onChange={(event) => setFromValue(event.target.value)}
                  inputMode="decimal"
                  className="w-16 rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1 text-xs text-white"
                />
                <span className="self-center text-xs text-[#62666f]">to</span>
                <input
                  data-testid="keyframe-to"
                  value={toValue}
                  onChange={(event) => setToValue(event.target.value)}
                  inputMode="decimal"
                  className="w-16 rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1 text-xs text-white"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md border border-white bg-white px-2 py-1 text-xs font-medium text-black disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </form>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-[#62666f]">
              {selectedLayer.name} · {selectedLayer.keyframes.length} keyframe
              {selectedLayer.keyframes.length === 1 ? "" : "s"}
            </p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs">
              {selectedLayer.keyframes.length === 0 ? (
                <li className="text-[#62666f]">
                  No motion yet. Apply a preset or add a keyframe.
                </li>
              ) : (
                selectedLayer.keyframes.map((keyframe) => (
                  <li
                    key={keyframe.id}
                    data-testid="keyframe-row"
                    className="flex items-center justify-between gap-2 rounded border border-[#202329] bg-[#15171c] px-2 py-1 text-[#b4b7bf]"
                  >
                    <span>
                      {keyframe.property} · {keyframe.fromValue}→
                      {keyframe.toValue} @ {keyframe.timeMs}ms ·{" "}
                      {keyframe.easing}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onDeleteKeyframe(keyframe.id)}
                      className="text-[#777b84] hover:text-white disabled:opacity-50"
                    >
                      remove
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs text-[#62666f]">
          Select a layer to edit its motion.
        </p>
      )}
    </div>
  );
}
