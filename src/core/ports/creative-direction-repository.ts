import type {
  CreateCreativeDirectionInput,
  CreativeDirection,
  CreativeDirectionStatus,
} from "../domain/creative-direction";

export type ListCreativeDirectionsOptions = {
  intentId?: string;
  status?: CreativeDirectionStatus;
  /** Cap the result, newest first, for the panel and the list endpoint. */
  limit?: number;
};

export interface CreativeDirectionRepository {
  create(input: CreateCreativeDirectionInput): Promise<CreativeDirection>;

  getById(id: string): Promise<CreativeDirection | null>;

  listByProject(
    projectId: string,
    options?: ListCreativeDirectionsOptions,
  ): Promise<CreativeDirection[]>;

  listByIntent(intentId: string): Promise<CreativeDirection[]>;

  listByRun(creativeRunId: string): Promise<CreativeDirection[]>;

  update(
    id: string,
    patch: Partial<CreativeDirection>,
  ): Promise<CreativeDirection | null>;

  setStatus(
    id: string,
    status: CreativeDirectionStatus,
    updatedAt: string,
  ): Promise<CreativeDirection | null>;

  /**
   * Drops the selection for an intent to a single direction, demoting anything
   * else that was selected. Returns the direction that ended up selected plus
   * the directions it displaced, or null when the target does not exist.
   *
   * The write is one statement so two concurrent selects cannot both believe
   * they won: the demotion is part of the same transaction as the promotion.
   * The displaced rows come back from that transaction rather than from a read
   * the caller took beforehand, because a caller who read first cannot know
   * what the committed write actually displaced.
   */
  selectForIntent(
    id: string,
    updatedAt: string,
  ): Promise<{ selected: CreativeDirection; demoted: CreativeDirection[] } | null>;

  /** Directions a user has edited, which regeneration must leave alone. */
  listUserEditedForIntent(intentId: string): Promise<CreativeDirection[]>;
}
