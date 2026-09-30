import type {
  CreateStoryboardInput,
  Storyboard,
  StoryboardStatus,
  UpdateStoryboardInput,
} from "../domain/storyboard";

export type ListStoryboardsOptions = {
  intentId?: string;
  directionId?: string;
  status?: StoryboardStatus;
  /** Cap the result, newest first, for the panel and the list endpoint. */
  limit?: number;
};

export interface StoryboardRepository {
  create(input: CreateStoryboardInput): Promise<Storyboard>;

  getById(id: string): Promise<Storyboard | null>;

  listByProject(
    projectId: string,
    options?: ListStoryboardsOptions,
  ): Promise<Storyboard[]>;

  listByIntent(intentId: string): Promise<Storyboard[]>;

  /**
   * Replaces the whole plan: the scenes are rewritten inside one transaction so
   * a reader can never catch a storyboard whose scenes do not match its
   * `actualDurationMs`. Edits, reorders and regenerated plans all go through
   * here rather than mutating scenes one at a time.
   *
   * Reordering is deliberately *not* a method of its own. Moving a scene changes
   * every span after it, so the caller has to re-derive the timeline anyway; the
   * domain owns those rules, and having the repository re-time scenes as well
   * would put the same invariant in two places.
   */
  update(
    id: string,
    patch: UpdateStoryboardInput,
  ): Promise<Storyboard | null>;

  /**
   * Locks a storyboard and archives whatever else was selected for the intent, so
   * the locked plan is unambiguously the one the next checkpoint reads. Returns
   * the locked storyboard plus the rows it displaced, or null when it does not
   * exist. The archive happens in the same transaction as the lock.
   */
  lock(
    id: string,
    updatedAt: string,
  ): Promise<{ storyboard: Storyboard; archived: Storyboard[] } | null>;

  /**
   * Drops the selection for an intent to a single storyboard, demoting anything
   * else that was selected. Returns the storyboard that ended up selected plus
   * the ones it displaced, or null when the target does not exist.
   *
   * As with direction selection, the demotion is part of the same transaction as
   * the promotion, so two concurrent selects cannot both believe they won, and
   * the displaced rows come from that write rather than from a prior read.
   */
  selectForIntent(
    id: string,
    updatedAt: string,
  ): Promise<{ storyboard: Storyboard; demoted: Storyboard[] } | null>;

  /** The locked storyboard for an intent, if the piece has been decided. */
  getLockedForIntent(intentId: string): Promise<Storyboard | null>;
}
