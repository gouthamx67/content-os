import { MockAIProvider } from "./ai/mock-ai-provider";
import { InMemoryJobRepository } from "./repositories/in-memory-job-repository";
import { InMemoryProjectRepository } from "./repositories/in-memory-project-repository";
import { MockRendererProvider } from "./rendering/mock-renderer-provider";

const projectRepository = new InMemoryProjectRepository();

const jobRepository = new InMemoryJobRepository();

const aiProvider = new MockAIProvider();

const rendererProvider = new MockRendererProvider();

export const container = {
  repositories: {
    projects: projectRepository,
    jobs: jobRepository,
  },

  providers: {
    ai: aiProvider,
    renderer: rendererProvider,
  },
};