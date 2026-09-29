import type { ContentIntent } from "../domain/content-intent";

export interface ContentIntentRepository {
  create(intent: ContentIntent): Promise<ContentIntent>;

  /**
   * Looked up by id alone: the service, not the repository, decides whether the
   * intent belongs to the project the caller is allowed to see, so a
   * cross-project read fails the same way a missing one does.
   */
  getById(id: string): Promise<ContentIntent | null>;

  listForProject(projectId: string): Promise<ContentIntent[]>;

  update(intent: ContentIntent): Promise<ContentIntent>;
}
