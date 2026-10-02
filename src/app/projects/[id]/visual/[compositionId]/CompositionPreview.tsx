"use client";

import { evaluateScene } from "../../../../../modules/visual-motion-engine/motion/evaluate-scene";
import type { ResolvedEffect } from "../../../../../modules/visual-motion-engine/motion/resolve-frame";
import type { SceneGraph } from "../../../../../modules/visual-motion-engine/serialization/scene-graph";

interface Props {
  composition: SceneGraph;
  timeMs: number;
  selectedLayerId: string | null;
  onSelectLayer: (layerId: string) => void;
}

export function CompositionPreview({
  composition,
  timeMs,
  selectedLayerId,
  onSelectLayer,
}: Props) {
  // The preview evaluates the *same* function the renderer contract is built
  // from, so what is scrubbed here is what CP15 would export — not a lookalike.
  const frame = evaluateScene(composition, timeMs);

  return (
    <div className="rounded-xl border border-[#202329] bg-[#0b0c0f] p-4">
      <div
        data-testid="visual-stage"
        data-time-ms={frame.timeMs}
        data-layer-count={frame.layers.length}
        className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-lg border border-[#202329] bg-black"
        style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
      >
        {frame.layers.map((layer) => {
          if (!layer.visible) return null;

          const selected = layer.id === selectedLayerId;

          return (
            <button
              key={layer.id}
              type="button"
              data-testid="visual-layer"
              data-layer-id={layer.id}
              data-layer-type={layer.type}
              onClick={() => onSelectLayer(layer.id)}
              className={[
                "absolute origin-center overflow-hidden text-center",
                selected
                  ? "ring-2 ring-sky-400"
                  : "ring-1 ring-transparent hover:ring-1 hover:ring-[#3a3f49]",
              ].join(" ")}
              style={{
                left: `${(layer.x / frame.width) * 100}%`,
                top: `${(layer.y / frame.height) * 100}%`,
                width: `${(layer.width / frame.width) * 100}%`,
                height: `${(layer.height / frame.height) * 100}%`,
                transform: `rotate(${layer.rotation}deg)`,
                opacity: layer.opacity,
                zIndex: layer.zIndex,
                filter: filterFor(layer.effects),
              }}
            >
              {renderLayerBody(layer.type, layer.textContent, layer.assetRef)}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-center text-xs text-[#62666f]">
        {frame.width}×{frame.height} · frame at {frame.timeMs} ms ·{" "}
        {frame.frameRate} fps
      </p>
    </div>
  );
}

function renderLayerBody(
  type: string,
  textContent: string | null,
  assetRef: string | null,
) {
  if (type === "TEXT") {
    return (
      <span className="flex h-full w-full items-center justify-center overflow-hidden px-1 text-[10px] leading-tight text-white">
        {textContent ?? ""}
      </span>
    );
  }

  if (type === "MEDIA") {
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 border border-dashed border-[#3a3f49] text-[9px] text-[#777b84]">
        <span className="uppercase tracking-wide">Media</span>
        <span className="truncate px-1">{assetRef ?? "no source"}</span>
      </span>
    );
  }

  if (type === "GROUP") {
    return <span className="block h-full w-full border border-[#2a2e35]" />;
  }

  return (
    <span className="block h-full w-full rounded-sm bg-[#22262e]" />
  );
}

function filterFor(effects: ResolvedEffect[]): string {
  if (effects.length === 0) return "none";

  return effects
    .map((effect) => {
      switch (effect.type) {
        case "BLUR":
          return `blur(${effect.amount}px)`;
        case "BRIGHTNESS":
          return `brightness(${effect.amount})`;
        case "CONTRAST":
          return `contrast(${effect.amount})`;
        case "SATURATION":
          return `saturate(${effect.amount})`;
        case "GRAYSCALE":
          return `grayscale(${effect.amount})`;
      }
    })
    .join(" ");
}
