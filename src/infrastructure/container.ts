import { join } from "node:path";
import { db } from "../prisma/db";
import { InMemoryJobRepository } from "./repositories/in-memory-job-repository";
import { MockAIProvider } from "./ai/mock-ai-provider";
import { MockRendererProvider } from "./rendering/mock-renderer-provider";
import { PostgresUserRepository } from "./repositories/postgres-user-repository";
import { PostgresSessionRepository } from "./repositories/postgres-session-repository";
import { PostgresWorkspaceRepository } from "./repositories/postgres-workspace-repository";
import { PostgresProjectRepository } from "./repositories/postgres-project-repository";
import { PostgresSourceRepository } from "./repositories/postgres-source-repository";
import { PostgresSourceStorageCoordinator } from "./repositories/postgres-source-storage-coordinator";
import { PostgresAssetRepository } from "./repositories/postgres-asset-repository";
import { postgresDatabase } from "./repositories/postgres-database";
import { AuthService } from "../core/services/auth-service";
import { WorkspaceService } from "../core/services/workspace-service";
import { ProjectService } from "../core/services/project-service";
import { SourceService } from "../core/services/source-service";
import { AssetService } from "../core/services/asset-service";
import { GenerationService } from "../core/services/generation-service";
import { InputService } from "../core/services/input-service";
import { IngestionInputProvider } from "./ingestion/ingestion-provider";
import { SafeHttpFetcher } from "./ingestion/safe-http";
import { LocalStorageProvider } from "./storage/local-storage-provider";

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

const sourceStorage = new PostgresSourceStorageCoordinator();

const http = new SafeHttpFetcher();
const storage = new LocalStorageProvider(
  process.env["CONTENT_OS_STORAGE_PATH"] ?? join(process.cwd(), ".content-os", "storage"),
);

const providers = {
  ai: new MockAIProvider(),
  renderer: new MockRendererProvider(),
  http,
  storage,
  inputs: new IngestionInputProvider(http),
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

const inputService = new InputService({
  projectService,
  sourceRepository: repositories.sources,
  storageCoordinator: sourceStorage,
  storageProvider: providers.storage,
  inputProvider: providers.inputs,
});

const sourceService = new SourceService(
  repositories.sources,
  projectService,
  inputService,
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
    inputs: inputService,
  },
};