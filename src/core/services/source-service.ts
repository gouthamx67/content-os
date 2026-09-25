import type { Source } from "../domain/source";
import type {
  CreateSourceInput,
  SourceRepository,
} from "../ports";
import { createId } from "../../lib/id";
import type { InputService } from "./input-service";
import type { ProjectService } from "./project-service";

export class SourceService {
  constructor(
    private readonly sources: SourceRepository,
    private readonly projects: ProjectService,
    private readonly inputs: Pick<InputService, "deleteInput">,
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
    input: Pick<CreateSourceInput, "type" | "name" | "uri" | "metadata">,
    userId: string,
  ): Promise<Source> {
    await this.projects.getAuthorized(projectId, userId);

    return this.sources.create({
      ...input,
      id: createId("source"),
      projectId,
      status: "READY",
      mimeType: null,
      sizeBytes: null,
      contentHash: null,
      storageKey: null,
      errorCode: null,
      errorMessage: null,
    });
  }

  async remove(
    projectId: string,
    sourceId: string,
    userId: string,
  ): Promise<void> {
    await this.inputs.deleteInput(projectId, userId, sourceId);
  }
}