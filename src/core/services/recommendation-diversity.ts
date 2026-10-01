import type { ContentOpportunity } from "../domain/content-opportunity";

/**
 * Ranking alone produces five variations on the same video, which reads as
 * broken to a user even though every item scores well. Selection therefore runs
 * in two passes: first, in rank order, taking only items whose channel is not
 * already represented; then, only if that leaves the list short, backfilling with
 * the best of what was passed over.
 *
 * The order matters. Taking distinct channels first means a project with a
 * carousel and a post never sees neither in favour of a second demo, while the
 * backfill means a project whose channels genuinely overlap still gets a full
 * list rather than a short one.
 */

export type Diversified<T> = {
  selected: T[];
  /** Channels seen in the input but left out, for the service to log. */
  droppedChannels: string[];
};

export function diversifyByChannel<
  T extends Pick<ContentOpportunity, "channel" | "priorityScore">,
>(ranked: readonly T[], maximum: number): Diversified<T> {
  if (ranked.length === 0 || maximum <= 0) {
    return { selected: [], droppedChannels: [] };
  }

  const target = Math.min(maximum, ranked.length);
  const selected: T[] = [];
  const deferred: T[] = [];
  const seenChannels = new Set<string>();
  const dropped: string[] = [];

  for (const item of ranked) {
    if (selected.length >= target) break;

    if (seenChannels.has(item.channel)) {
      if (!dropped.includes(item.channel)) dropped.push(item.channel);
      deferred.push(item);
      continue;
    }

    selected.push(item);
    seenChannels.add(item.channel);
  }

  // Backfill in rank order so the list is only ever short if the input was.
  for (const item of deferred) {
    if (selected.length >= target) break;
    selected.push(item);
  }

  selected.sort((left, right) => right.priorityScore - left.priorityScore);
  return { selected, droppedChannels: dropped };
}
