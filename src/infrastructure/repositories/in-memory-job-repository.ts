import type { GenerationJob } from "../../core/domain";
import type { JobRepository } from "../../core/ports";

export class InMemoryJobRepository implements JobRepository {
  private jobs = new Map<string, GenerationJob>();

  async create(job: GenerationJob): Promise<GenerationJob> {
    this.jobs.set(job.id, job);

    return job;
  }

  async getById(id: string): Promise<GenerationJob | null> {
    return this.jobs.get(id) ?? null;
  }

  async update(job: GenerationJob): Promise<GenerationJob> {
    this.jobs.set(job.id, job);

    return job;
  }
}