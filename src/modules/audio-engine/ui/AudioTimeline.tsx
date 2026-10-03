"use client";

import type { AudioTrackView } from "./types";

interface Props {
  tracks: AudioTrackView[];
  durationMs: number;
  selectedTrackId: string | null;
  onSelect: (trackId: string) => void;
}

const KIND_COLORS: Record<AudioTrackView["kind"], string> = {
  VOICEOVER: "bg-sky-500/60",
  MUSIC: "bg-emerald-500/60",
  SFX: "bg-amber-500/60",
  AMBIENCE: "bg-purple-500/60",
};

/**
 * A read-only overview of where every track sits on the timeline.
 *
 * The bar is the composition; each track's block is positioned and sized as a
 * percentage of it, so trimming or moving a track is visible here even without
 * playing it back.
 */
export function AudioTimeline({
  tracks,
  durationMs,
  selectedTrackId,
  onSelect,
}: Props) {
  const total = durationMs > 0 ? durationMs : 1;

  return (
    <div
      data-testid="audio-timeline"
      className="space-y-2 rounded-xl border border-[#202329] bg-[#101216] p-4"
    >
      <p className="text-xs uppercase tracking-wide text-[#62666f]">Timeline</p>

      {tracks.length === 0 ? (
        <p className="text-xs text-[#62666f]">No tracks yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {tracks.map((track) => {
            const left = (track.startMs / total) * 100;
            const width = Math.max(1, (track.durationMs / total) * 100);

            return (
              <li key={track.id}>
                <button
                  type="button"
                  data-testid="audio-track-item"
                  data-track-id={track.id}
                  onClick={() => onSelect(track.id)}
                  className={[
                    "relative block h-8 w-full overflow-hidden rounded-md border text-left text-[10px]",
                    track.id === selectedTrackId
                      ? "border-sky-400"
                      : "border-[#202329]",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "absolute inset-y-0 rounded-sm opacity-70",
                      KIND_COLORS[track.kind],
                      track.mute ? "opacity-25" : "",
                    ].join(" ")}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-white">
                    {track.name} · {track.kind}
                    {track.mute ? " · muted" : ""}
                    {track.solo ? " · solo" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
