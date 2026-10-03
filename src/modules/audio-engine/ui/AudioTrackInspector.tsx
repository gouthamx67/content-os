"use client";

import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import type { AudioTrackView } from "./types";

export type AudioTrackChanges = Partial<
  Pick<
    AudioTrackView,
    | "name"
    | "startMs"
    | "sourceOffsetMs"
    | "durationMs"
    | "gainDb"
    | "pan"
    | "fadeInMs"
    | "fadeOutMs"
    | "mute"
    | "solo"
    | "duckVoiceoverDb"
  >
>;

export type AutomationInput = {
  timeMs: number;
  value: number;
  easing: "LINEAR" | "EASE_IN" | "EASE_OUT" | "EASE_IN_OUT";
};

interface Props {
  track: AudioTrackView;
  busy: boolean;
  onSave: (changes: AudioTrackChanges) => void;
  onDelete: () => void;
  onAddAutomation: (input: AutomationInput) => void;
}

/**
 * Edits one track's mix parameters and its volume automation.
 *
 * Values are parsed at the boundary and only the fields the API allows to
 * change are sent, so the inspector can never accidentally rewrite ownership.
 */
export function AudioTrackInspector({
  track,
  busy,
  onSave,
  onDelete,
  onAddAutomation,
}: Props) {
  const [gainDb, setGainDb] = useState(String(track.gainDb));
  const [pan, setPan] = useState(String(track.pan));
  const [fadeInMs, setFadeInMs] = useState(String(track.fadeInMs));
  const [fadeOutMs, setFadeOutMs] = useState(String(track.fadeOutMs));
  const [duckDb, setDuckDb] = useState(
    track.duckVoiceoverDb === null ? "" : String(track.duckVoiceoverDb),
  );

  const [autoTimeMs, setAutoTimeMs] = useState("0");
  const [autoValue, setAutoValue] = useState(String(track.gainDb));
  const [autoEasing, setAutoEasing] =
    useState<AutomationInput["easing"]>("LINEAR");

  const fields: Array<{
    label: string;
    value: string;
    set: (next: string) => void;
    testId: string;
  }> = [
    { label: "Gain dB", value: gainDb, set: setGainDb, testId: "audio-inspect-gain" },
    { label: "Pan", value: pan, set: setPan, testId: "audio-inspect-pan" },
    { label: "Fade in ms", value: fadeInMs, set: setFadeInMs, testId: "audio-inspect-fade-in" },
    { label: "Fade out ms", value: fadeOutMs, set: setFadeOutMs, testId: "audio-inspect-fade-out" },
    { label: "Duck dB", value: duckDb, set: setDuckDb, testId: "audio-inspect-duck" },
  ];

  function save() {
    const changes: AudioTrackChanges = {
      gainDb: Number(gainDb),
      pan: Number(pan),
      fadeInMs: Number(fadeInMs),
      fadeOutMs: Number(fadeOutMs),
      mute: track.mute,
      solo: track.solo,
      duckVoiceoverDb: duckDb.trim() === "" ? null : Number(duckDb),
    };

    onSave(changes);
  }

  return (
    <div
      data-testid="audio-inspector"
      className="space-y-4 rounded-xl border border-[#202329] bg-[#101216] p-4"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-[#62666f]">
          {track.name} · {track.kind}
        </p>
        <Button
          variant="secondary"
          data-testid="audio-delete-track"
          disabled={busy}
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>

      <p className="truncate text-[10px] text-[#62666f]">
        source: {track.sourceRef}
      </p>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {fields.map((field) => (
          <label key={field.testId} className="space-y-1">
            <span className="text-[10px] text-[#62666f]">{field.label}</span>
            <input
              data-testid={field.testId}
              value={field.value}
              onChange={(event) => field.set(event.target.value)}
              inputMode="decimal"
              className="w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-white"
            />
          </label>
        ))}
      </div>

      <Button
        variant="secondary"
        className="w-full"
        data-testid="audio-save-track"
        disabled={busy}
        onClick={save}
      >
        Save track
      </Button>

      <div className="space-y-2 border-t border-[#202329] pt-3">
        <p className="text-[10px] uppercase tracking-wide text-[#62666f]">
          Volume automation
        </p>

        {track.automation.length > 0 && (
          <ul
            data-testid="audio-automation-list"
            className="space-y-0.5 text-[10px] text-[#b4b7bf]"
          >
            {track.automation.map((point) => (
              <li key={point.id}>
                {point.timeMs}ms → {point.value}dB ({point.easing})
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-3 gap-2">
          <input
            data-testid="audio-auto-time"
            value={autoTimeMs}
            onChange={(event) => setAutoTimeMs(event.target.value)}
            inputMode="numeric"
            placeholder="time"
            className="rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          />
          <input
            data-testid="audio-auto-value"
            value={autoValue}
            onChange={(event) => setAutoValue(event.target.value)}
            inputMode="decimal"
            placeholder="dB"
            className="rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          />
          <select
            data-testid="audio-auto-easing"
            value={autoEasing}
            onChange={(event) =>
              setAutoEasing(event.target.value as AutomationInput["easing"])
            }
            className="rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          >
            <option value="LINEAR">LINEAR</option>
            <option value="EASE_IN">EASE_IN</option>
            <option value="EASE_OUT">EASE_OUT</option>
            <option value="EASE_IN_OUT">EASE_IN_OUT</option>
          </select>
        </div>

        <Button
          variant="secondary"
          className="w-full"
          data-testid="audio-add-automation"
          disabled={busy}
          onClick={() =>
            onAddAutomation({
              timeMs: Number(autoTimeMs),
              value: Number(autoValue),
              easing: autoEasing,
            })
          }
        >
          Add automation point
        </Button>
      </div>
    </div>
  );
}
