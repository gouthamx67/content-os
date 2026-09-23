import { container } from "./container";
import { ProjectService } from "../core/services/project-service";
import { GenerationService } from "../core/services/generation-service";

export const projectService = new ProjectService(
  container.repositories.projects,
);

export const generationService = new GenerationService(
  container.repositories.projects,
  container.repositories.jobs,
  container.providers.ai,
  container.providers.renderer,
);