"use client";

import { useState } from "react";
import { Button } from "../../../../../components/ui/Button";
import { effectPalette, fitPalette } from "../../../../../modules/visual-motion-engine/ui-options";
import type { SceneGraphLayer } from "../../../../../modules/visual-motion-engine/serialization/scene-graph";
import type {
  VisualEffectType,
  VisualFitMode,
} from "../../../../../modules/visual-motion-engine/domain/types";

export type LayerTransform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  visible: boolean;
  fit: VisualFitMode;
};

interface Props {
  layer: SceneGraphLayer;
  busy: boolean;
  onSave: (transform: LayerTransform) => Promise<void>;
  onAddEffect: (type: VisualEffectType, amount: number) => Promise<void>;
  onDeleteEffect: (effectId: string) => Promise<void>;
}

/**
 * The transform and effects editor for one layer.
 *
 * It is keyed by layer id by its parent, so switching layers remounts it with
 * the new layer's values instead of copying props into state from an effect.
 */
export function LayerInspector({
  layer,
  busy,
  onSave,
  onAddEffect,
  onDeleteEffect,
}: Props) {
  const [x, setX] = useState(String(layer.x));
  const [y, setY] = useState(String(layer.y));
  const [width, setWidth] = useState(String(layer.width));
  const [height, setHeight] = useState(String(layer.height));
  const [rotation, setRotation] = useState(String(layer.rotation));
  const [opacity, setOpacity] = useState(String(layer.opacity));
  const [zIndex, setZIndex] = useState(String(layer.zIndex));
  const [visible, setVisible] = useState(layer.visible);
  const [fit, setFit] = useState<VisualFitMode>(layer.fit);
  const [effectType, setEffectType] = useState<VisualEffectType>("BLUR");
  const [effectAmount, setEffectAmount] = useState("4");

  const fields = [
    ["x", "X", x, setX],
    ["y", "Y", y, setY],
    ["width", "Width", width, setWidth],
    ["height", "Height", height, setHeight],
    ["rotation", "Rotation", rotation, setRotation],
    ["opacity", "Opacity", opacity, setOpacity],
    ["zIndex", "Z", zIndex, setZIndex],
  ] as const;

  return (
    <div className="rounded-xl border border-[#202329] bg-[#101216] p-4">
      <p className="text-xs uppercase tracking-wide text-[#62666f]">
        {layer.name} transform
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {fields.map(([key, label, value, setter]) => (
          <label key={key} className="text-[10px] text-[#777b84]">
            {label}
            <input
              data-testid={`layer-${key}`}
              value={value}
              onChange={(event) => setter(event.target.value)}
              className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1 text-xs text-white"
            />
          </label>
        ))}
        <label className="text-[10px] text-[#777b84]">
          Fit
          <select
            data-testid="layer-fit"
            value={fit}
            onChange={(event) => setFit(event.target.value as VisualFitMode)}
            className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1 text-xs text-white"
          >
            {fitPalette.modes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end text-[10px] text-[#777b84]">
          <input
            type="checkbox"
            data-testid="layer-visible"
            checked={visible}
            onChange={(event) => setVisible(event.target.checked)}
          />
          Visible
        </label>
      </div>

      <Button
        className="mt-3"
        disabled={busy}
        data-testid="save-layer"
        onClick={() =>
          void onSave({
            x: Number(x),
            y: Number(y),
            width: Number(width),
            height: Number(height),
            rotation: Number(rotation),
            opacity: Number(opacity),
            zIndex: Number(zIndex),
            visible,
            fit,
          })
        }
      >
        Save transform
      </Button>

      <div className="mt-5 border-t border-[#202329] pt-4">
        <p className="text-xs uppercase tracking-wide text-[#62666f]">Effects</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <select
            data-testid="effect-type"
            value={effectType}
            onChange={(event) =>
              setEffectType(event.target.value as VisualEffectType)
            }
            className="rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1 text-xs text-white"
          >
            {effectPalette.types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <input
            data-testid="effect-amount"
            value={effectAmount}
            onChange={(event) => setEffectAmount(event.target.value)}
            className="w-16 rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1 text-xs text-white"
          />
          <Button
            variant="secondary"
            disabled={busy}
            data-testid="add-effect"
            onClick={() => void onAddEffect(effectType, Number(effectAmount))}
          >
            Apply
          </Button>
        </div>
        <ul className="mt-2 space-y-1 text-xs">
          {layer.effects.length === 0 ? (
            <li className="text-[#62666f]">No effects.</li>
          ) : (
            layer.effects.map((effect) => (
              <li
                key={effect.id}
                data-testid="effect-row"
                className="flex items-center justify-between rounded border border-[#202329] bg-[#15171c] px-2 py-1 text-[#b4b7bf]"
              >
                <span>
                  {effect.type} · {effect.amount}
                  {effect.enabled ? "" : " (off)"}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onDeleteEffect(effect.id)}
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
  );
}
