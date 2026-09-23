import type { GenerationJob } from "../domain";

export interface JobRepository {
  create(job: GenerationJob): Promise<GenerationJob>;

  getById(id: string): Promise<GenerationJob | null>;

  update(job: GenerationJob): Promise<GenerationJob>;
}