import type {
  ContentRequest,
  GenerationJob,
} from "../domain";

import type {
  AIProvider,
  JobRepository,
  ProjectRepository,
  RendererProvider,
} from "../ports";

import { createId } from "../../lib/id";

export class GenerationService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly jobs: JobRepository,
    private readonly ai: AIProvider,
    private readonly renderer: RendererProvider,
  ) {}

  async createJob(
    request: ContentRequest,
  ): Promise<GenerationJob> {
    const project = await this.projects.getById(
      request.projectId,
    );

    if (!project) {
      throw new Error("Project not found");
    }

    const now = new Date().toISOString();

    const job: GenerationJob = {
      id: createId("job"),

      projectId: request.projectId,

      type: request.type,

      status: "queued",

      progress: 0,

      input: request,

      createdAt: now,
    };

    return this.jobs.create(job);
  }

  async execute(
    job: GenerationJob,
  ): Promise<GenerationJob> {
    const running: GenerationJob = {
      ...job,
      status: "running",
      progress: 10,
      startedAt: new Date().toISOString(),
    };

    await this.jobs.update(running);

    try {
      const project = await this.projects.getById(
        job.projectId,
      );

      if (!project) {
        throw new Error("Project not found");
      }

      const aiResponse = await this.ai.generate({
        messages: [
          {
            role: "system",
            content:
              "You are the creative planning engine for Content OS.",
          },
          {
            role: "user",
            content: JSON.stringify({
              project,
              request: job.input,
            }),
          },
        ],
      });

      await this.jobs.update({
        ...running,
        progress: 60,
      });

      const render = await this.renderer.render({
        projectId: job.projectId,
        artifactType: job.type,
        plan: {
          aiResponse: aiResponse.text,
        },
        width: 1920,
        height: 1080,
      });

      const completed: GenerationJob = {
        ...running,

        status: "completed",

        progress: 100,

        output: {
          render,
        },

        completedAt: new Date().toISOString(),
      };

      return this.jobs.update(completed);
    } catch (error) {
      const failed: GenerationJob = {
        ...running,

        status: "failed",

        error:
          error instanceof Error
            ? error.message
            : "Generation failed",
      };

      return this.jobs.update(failed);
    }
  }

  async getJob(id: string): Promise<GenerationJob | null> {
    return this.jobs.getById(id);
  }
}