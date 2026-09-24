import { db } from "../prisma/db";
import { InMemoryJobRepository } from "./repositories/in-memory-job-repository";
import { MockAIProvider } from "./ai/mock-ai-provider";
import { MockRendererProvider } from "./rendering/mock-renderer-provider";
import { PostgresUserRepository } from "./repositories/postgres-user-repository";
import { PostgresSessionRepository } from "./repositories/postgres-session-repository";
import { PostgresWorkspaceRepository } from "./repositories/postgres-workspace-repository";
import { PostgresProjectRepository } from "./repositories/postgres-project-repository";
import { PostgresSourceRepository } from "./repositories/postgres-source-repository";
import { PostgresAssetRepository } from "./repositories/postgres-asset-repository";
import { postgresDatabase } from "./repositories/postgres-database";
import { AuthService } from "../core/services/auth-service";
import { WorkspaceService } from "../core/services/workspace-service";
import { ProjectService } from "../core/services/project-service";
import { SourceService } from "../core/services/source-service";
import { AssetService } from "../core/services/asset-service";
import { GenerationService } from "../core/services/generation-service";

const orm = db.orm.public;

const repositories = {
  users: new PostgresUserRepository(orm),
  sessions: new PostgresSessionRepository(orm),
  workspaces: new PostgresWorkspaceRepository(orm),
  projects: new PostgresProjectRepository(orm),
  sources: new PostgresSourceRepository(orm),
  assets: new PostgresAssetRepository(orm),
  jobs: new InMemoryJobRepository(),
};

const providers = {
  ai: new MockAIProvider(),
  renderer: new MockRendererProvider(),
};

const workspaceService = new WorkspaceService(
  repositories.workspaces,
);

const projectService = new ProjectService(
  repositories.projects,
  (workspaceId, userId) =>
    workspaceService.getMembership(workspaceId, userId),
  async (userId) =>
    (await workspaceService.listForUser(userId)).map(
      (membership) => membership.workspace.id,
    ),
);

const authService = new AuthService(
  repositories.users,
  repositories.sessions,
  postgresDatabase,
);

const sourceService = new SourceService(
  repositories.sources,
  projectService,
);

const assetService = new AssetService(
  repositories.assets,
  projectService,
);

const generationService = new GenerationService(
  repositories.projects,
  repositories.jobs,
  providers.ai,
  providers.renderer,
);

export const container = {
  repositories,
  providers,
  services: {
    auth: authService,
    workspaces: workspaceService,
    projects: projectService,
    sources: sourceService,
    assets: assetService,
    generation: generationService,
  },
};