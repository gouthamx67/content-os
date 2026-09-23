import type { Project, Source } from "../domain";
import type { ProjectRepository } from "../ports";
import { createId } from "../../lib/id";

export type CreateProjectInput = {
  name?: string;

  sources?: Array<{
    type: Source["type"];
    name: string;
    uri?: string;
    mimeType?: string;
  }>;
};

export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
  ) {}

  async create(
    input: CreateProjectInput,
  ): Promise<Project> {
    const now = new Date().toISOString();

    const project: Project = {
      id: createId("project"),
      name: input.name?.trim() || "Untitled project",
      status: "created",

      createdAt: now,
      updatedAt: now,

      sources: (input.sources ?? []).map((source) => ({
        id: createId("source"),
        type: source.type,
        name: source.name,
        uri: source.uri,
        mimeType: source.mimeType,
        createdAt: now,
      })),

      assets: [],
    };

    return this.repository.create(project);
  }

  async get(id: string): Promise<Project | null> {
    return this.repository.getById(id);
  }

  async list(): Promise<Project[]> {
    return this.repository.list();
  }
}