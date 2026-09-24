import type { Source } from "../domain/source";
import type {
  CreateSourceInput,
  SourceRepository,
} from "../ports";
import { createId } from "../../lib/id";
import { HttpError } from "../../lib/http";
import type { ProjectService } from "./project-service";

export class SourceService {
  constructor(
    private readonly sources: SourceRepository,
    private readonly projects: ProjectService,
  ) {}

  async list(
    projectId: string,
    userId: string,
  ): Promise<Source[]> {
    await this.projects.getAuthorized(projectId, userId);

    return this.sources.listByProject(projectId);
  }

  async create(
    projectId: string,
    input: Omit<CreateSourceInput, "id" | "projectId">,
    userId: string,
  ): Promise<Source> {
    await this.projects.getAuthorized(projectId, userId);

    return this.sources.create({
      ...input,
      id: createId("source"),
      projectId,
    });
  }

  async remove(
    projectId: string,
    sourceId: string,
    userId: string,
  ): Promise<void> {
    await this.projects.getAuthorized(projectId, userId);

    const source = await this.sources.getById(sourceId);

    if (!source || source.projectId !== projectId) {
      throw new HttpError(404, "Source not found");
    }

    await this.sources.deleteById(sourceId);
  }
}