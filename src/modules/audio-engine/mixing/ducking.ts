import type { AudioTrackRecord } from "../domain/types";

export type DuckInterval = {
  startMs: number;
  endMs: number;
};

/**
 * The spans during which a voiceover is audible.
 *
 * Only unmuted voiceovers duck, and overlapping voiceovers collapse into a
 * single span so a music bed is not attenuated twice for two speakers talking
 * over each other. A muted voiceover contributes nothing: it is not heard, so
 * it must not push the music down.
 */
export function buildVoiceoverDuckIntervals(
  tracks: readonly Pick<
    AudioTrackRecord,
    "kind" | "startMs" | "durationMs" | "mute"
  >[],
): DuckInterval[] {
  const raw = tracks
    .filter((track) => track.kind === "VOICEOVER" && !track.mute)
    .map((track) => ({
      startMs: track.startMs,
      endMs: track.startMs + track.durationMs,
    }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const merged: DuckInterval[] = [];
  for (const interval of raw) {
    const previous = merged[merged.length - 1];
    if (previous && interval.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, interval.endMs);
    } else {
      merged.push({ ...interval });
    }
  }

  return merged;
}

export function isDuckedAt(
  intervals: readonly DuckInterval[],
  timeMs: number,
): boolean {
  return intervals.some(
    (interval) => timeMs >= interval.startMs && timeMs < interval.endMs,
  );
}

/**
 * Which tracks actually reach the mix.
 *
 * A muted track never plays. If any audible track is soloed, everything not
 * soloed drops out — the same convention every DAW uses, and the only one a
 * user can predict.
 */
export function resolveAudibleTracks<
  T extends Pick<AudioTrackRecord, "mute" | "solo">,
>(tracks: readonly T[]): T[] {
  const anySolo = tracks.some((track) => track.solo && !track.mute);

  return tracks.filter((track) => {
    if (track.mute) return false;
    if (anySolo) return track.solo;
    return true;
  });
}
