/**
 * Timeline arithmetic for a storyboard.
 *
 * The whole module exists to make one property true by construction rather than
 * by review: the scenes cover `[0, targetDurationMs]` with no gap and no
 * overlap. Everything downstream - an editor, a renderer, a caption file - reads
 * these numbers directly, so a single millisecond of drift is a real defect.
 *
 * Three rules make that hold:
 *
 *  - Durations are distributed by largest remainder, so the parts always sum to
 *    the whole exactly. Rounding to even shares loses or gains a millisecond per
 *    scene, and twelve scenes of that is a frame nobody can explain.
 *  - Every scene gets at least one millisecond. A zero-length scene cannot be
 *    edited, cut between, or rendered, and it usually means the caller asked for
 *    more scenes than the duration can carry.
 *  - Start and end are derived from the accumulated durations, never written
 *    independently. Two fields that have to agree is two fields that will not.
 */

/** The shortest beat worth putting on a timeline. */
export const MIN_SCENE_DURATION_MS = 1;

export class TimelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimelineError";
  }
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Splits `totalMs` across `count` scenes in proportion to `weights`, returning
 * whole milliseconds that sum to `totalMs` exactly.
 *
 * When fewer weights are supplied than there are scenes, the missing ones are
 * treated as zero and share whatever is left over; when more are supplied, the
 * extras are ignored. That keeps a caller from having to line two arrays up by
 * hand to get a usable plan.
 */
export function distributeSceneDurations(
  totalMs: number,
  weights: readonly number[],
  count = weights.length,
): number[] {
  if (!Number.isInteger(totalMs) || totalMs < 0) {
    throw new TimelineError(
      `Target duration must be a whole number of milliseconds, received ${totalMs}`,
    );
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new TimelineError(
      `Scene count must be a whole number, received ${count}`,
    );
  }
  if (count === 0) return [];
  if (totalMs < count) {
    // Refusing beats dividing: a zero-length scene is not a scene, and quietly
    // producing one hides the real problem, which is that the plan asks for more
    // beats than the requested duration can hold.
    throw new TimelineError(
      `A ${totalMs}ms piece cannot hold ${count} scenes; reduce the scene count or lengthen the piece`,
    );
  }

  const sanitized = Array.from({ length: count }, (_, index) => {
    const weight = weights[index];
    return isFiniteNonNegative(weight) ? weight : 0;
  });
  const totalWeight = sanitized.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight <= 0) {
    // No weights at all: an even split is the honest reading of "no preference".
    return evenSplit(totalMs, count);
  }

  const pool = totalMs;
  const exact = sanitized.map((weight) => (pool * weight) / totalWeight);

  const durations = exact.map((value) => Math.floor(value));
  let remainder = totalMs - durations.reduce((sum, value) => sum + value, 0);

  // Largest remainder first. Ties are broken towards the heavier scene and then
  // by position: with equal fractions, a millisecond should go to the scene the
  // weights most wanted time for, not merely to whichever one came first. The
  // last tiebreak by index keeps the whole result stable for the same input.
  const order = exact
    .map((value, index) => ({
      index,
      fraction: value - Math.floor(value),
      weight: sanitized[index],
    }))
    .sort(
      (left, right) =>
        right.fraction - left.fraction ||
        right.weight - left.weight ||
        left.index - right.index,
    );

  let cursor = 0;
  while (remainder > 0 && order.length > 0) {
    durations[order[cursor % order.length].index] += 1;
    remainder -= 1;
    cursor += 1;
  }

  // Enforce the minimum last, by taking from the scenes that have the most. Doing
  // it before the split would distort shares that were already exact, so this
  // only moves time when a scene would otherwise round away to nothing.
  return liftToMinimum(durations);
}

/** Nudges any zero-length scene up to the minimum, paid for by the largest ones. */
function liftToMinimum(durations: number[]): number[] {
  const result = [...durations];
  let deficit = result.filter((value) => value < MIN_SCENE_DURATION_MS).length;
  while (deficit > 0) {
    let donor = -1;
    let donorValue = MIN_SCENE_DURATION_MS;
    for (let index = 0; index < result.length; index += 1) {
      if (result[index] > donorValue) {
        donorValue = result[index];
        donor = index;
      }
    }
    if (donor < 0) return result;
    result[donor] -= 1;
    for (let index = 0; index < result.length; index += 1) {
      if (result[index] < MIN_SCENE_DURATION_MS) {
        result[index] += 1;
        deficit -= 1;
      }
    }
  }
  return result;
}

/** An even split that also sums to the whole, used when no weights are given. */
function evenSplit(totalMs: number, count: number): number[] {
  const base = Math.floor(totalMs / count);
  let remainder = totalMs - base * count;
  return Array.from({ length: count }, (_, index) => {
    const extra = remainder > 0 && index < remainder ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

/** A scene's position on the timeline, as stored. */
export interface StoryboardSegment {
  id: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export type TimelineInput = {
  /** Which scene this slot is, so the caller can match the result back up. */
  id: string;
  /** Relative emphasis. Zero or missing means "no more than the others". */
  weight?: number;
  /** A fixed length in ms, for a scene a person has already decided. */
  durationMs?: number;
};

/**
 * Lays segments end to end across `totalMs`.
 *
 * Pinned durations are honoured first and the rest is shared out among the
 * others in proportion to their weights, clamped so nothing falls below one
 * millisecond. A plan that pins more than the total can hold is refused rather
 * than quietly shortened, because that is a decision the caller has to make.
 */
export function buildStoryboardTimeline(
  totalMs: number,
  segments: readonly TimelineInput[],
): StoryboardSegment[] {
  if (segments.length === 0) return [];

  const pinnedTotal = segments.reduce((sum, segment) => {
    const value = segment.durationMs;
    if (value === undefined) return sum;
    if (!Number.isInteger(value) || value < MIN_SCENE_DURATION_MS) {
      throw new TimelineError(
        `A pinned scene duration must be at least ${MIN_SCENE_DURATION_MS}ms, received ${value}`,
      );
    }
    return sum + value;
  }, 0);

  if (pinnedTotal > totalMs) {
    throw new TimelineError(
      `Pinned scene durations total ${pinnedTotal}ms, which is longer than the ${totalMs}ms piece`,
    );
  }

  const freeIndexes: number[] = [];
  const durations: number[] = segments.map((segment, index) => {
    if (segment.durationMs !== undefined) return segment.durationMs;
    freeIndexes.push(index);
    return 0;
  });

  if (freeIndexes.length > 0) {
    const remaining = totalMs - pinnedTotal;
    const weights = freeIndexes.map((index) => segments[index].weight ?? 1);
    const shared = distributeSceneDurations(remaining, weights, freeIndexes.length);
    freeIndexes.forEach((sceneIndex, position) => {
      durations[sceneIndex] = shared[position];
    });
  }

  let cursor = 0;
  return segments.map((segment, index) => {
    const start = cursor;
    const end = start + durations[index];
    cursor = end;
    return { id: segment.id, startMs: start, endMs: end, durationMs: durations[index] };
  });
}

/** The total the segments actually cover. Always equal to the target on a valid plan. */
export function timelineTotal(segments: readonly StoryboardSegment[]): number {
  const last = segments[segments.length - 1];
  return last ? last.endMs : 0;
}

/** Formats milliseconds for a reader: `12.4s` or `1:02.5`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "-";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = (ms % 60_000) / 1000;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}
