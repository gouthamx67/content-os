import type {
  ContentOpportunity,
  OpportunityChannel,
  OpportunityStatus,
} from "../domain/content-opportunity";

/**
 * Every read and write is project-scoped. Recommendation ids are only ever
 * meaningful inside a project, so a method that takes a bare id would make a
 * cross-project mutation a matter of the caller remembering to check. The
 * service authorizes first; this port makes the scoping itself unforgeable.
 */

export type CreateRecommendationInput = {
  projectId: string;
  templateId: string;
  key: string;
  contentTypeId: string;
  channel: OpportunityChannel;
  platform: string;
  subjectType: string;
  subjectId: string | null;
  subjectLabel: string;
  title: string;
  rationale: string;
  reasons: string[];
  missingInputs: string[];
  priorityScore: number;
  /** Real Source document ids. Never an intelligence entity id. */
  sourceIds: string[];
  evidenceIds: string[];
  /** Related intelligence entity ids, e.g. the features a workflow steps through. */
  entityIds: string[];
  generatedAt: string;
};

export interface ContentRecommendationRepository {
  create(input: CreateRecommendationInput): Promise<ContentOpportunity>;

  getById(projectId: string, id: string): Promise<ContentOpportunity | null>;

  listByProject(
    projectId: string,
    filter?: { status?: OpportunityStatus },
  ): Promise<ContentOpportunity[]>;

  updateStatus(
    projectId: string,
    id: string,
    changes: {
      status?: OpportunityStatus;
      dismissedAt?: string | null;
      selectedIntentId?: string | null;
      updatedAt: string;
    },
  ): Promise<ContentOpportunity | null>;

  /**
   * Rewrites the generated fields of an existing row while leaving its identity
   * and the user's decisions intact. Used by a refresh: wording, score and
   * evidence move, but id, status, dismissedAt and selectedIntentId do not.
   */
  replaceGenerated(
    projectId: string,
    opportunity: ContentOpportunity,
  ): Promise<ContentOpportunity>;

  /**
   * Removes ACTIVE recommendations that a refresh no longer produces, leaving
   * DISMISSED and SELECTED rows alone. Rows a user acted on are never deleted
   * out from under them.
   *
   * There is no timestamp to pass: a removed row leaves nothing behind that would
   * need recording, and a `now` here would only ever be ignored.
   */
  deleteStaleActive(
    projectId: string,
    keepIds: readonly string[],
  ): Promise<number>;
}
