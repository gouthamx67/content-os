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
import { PostgresIntelligenceRepository } from "./repositories/postgres-intelligence-repository";
import { PostgresBrowserSessionRepository } from "./repositories/postgres-browser-session-repository";
import { PostgresBrandRepository } from "./repositories/postgres-brand-repository";
import { PostgresContentIntentRepository } from "./repositories/postgres-content-intent-repository";
import { postgresDatabase } from "./repositories/postgres-database";
import { AuthService } from "../core/services/auth-service";
import { WorkspaceService } from "../core/services/workspace-service";
import { ProjectService } from "../core/services/project-service";
import { SourceService } from "../core/services/source-service";
import { AssetService } from "../core/services/asset-service";
import { GenerationService } from "../core/services/generation-service";
import { InputService } from "../core/services/input-service";
import { IntelligenceService } from "../core/services/intelligence-service";
import { SourceAnalyzerRegistry } from "../core/ports/source-analyzer";
import { IngestionInputProvider } from "./ingestion/ingestion-provider";
import { SafeHttpFetcher } from "./ingestion/safe-http";
import { LocalStorageProvider } from "./storage/local-storage-provider";
import { WebsiteAnalyzer } from "./analysis/website-analyzer";
import { RepositoryAnalyzer } from "./analysis/repository-analyzer";
import { DocumentAnalyzer } from "./analysis/document-analyzer";
import { MediaAnalyzer } from "./analysis/media-analyzer";
import { ReferenceAnalyzer } from "./analysis/reference-analyzer";
import { AiIntelligenceInterpretationProvider } from "./ai/intelligence-interpretation-provider";
import { AiBrowserPlanner } from "./ai/ai-browser-planner";
import { PlaywrightBrowserRuntime } from "./browser/playwright-runtime";
import type { BrowserUploadSource } from "../core/ports/browser-planner";
import {
  DEFAULT_BROWSER_NAVIGATION_POLICY,
  checkBrowserUrl,
  uploadMimeTypeFor,
} from "./browser/navigation-policy";
import { BrowserService } from "../core/services/browser-service";
import { DeterministicBrowserPlanner } from "../core/services/browser-planner";
import { BrandIntelligenceService } from "../core/services/brand-intelligence-service";
import { BrandAnalyzerRegistry } from "../core/ports/brand-analyzer";
import { WebsiteBrandAnalyzer } from "./brand/website-brand-analyzer";
import { TextBrandAnalyzer } from "./brand/text-brand-analyzer";
import { RepositoryBrandAnalyzer } from "./brand/repository-brand-analyzer";
import { CreativeBrandAnalyzer } from "./brand/creative-brand-analyzer";
import { AiBrandInterpretationProvider } from "./ai/brand-interpretation-provider";
import { AiContentIntentInterpreter } from "./ai/content-intent-interpreter";
import { ContentIntentValidator } from "../core/services/content-intent-validator";
import { ContentIntentService } from "../core/services/content-intent-service";

const orm = db.orm.public;

const repositories = {
  users: new PostgresUserRepository(orm),
  sessions: new PostgresSessionRepository(orm),
  workspaces: new PostgresWorkspaceRepository(orm),
  projects: new PostgresProjectRepository(orm),
  sources: new PostgresSourceRepository(orm),
  assets: new PostgresAssetRepository(orm),
  intelligence: new PostgresIntelligenceRepository(orm),
  browserSessions: new PostgresBrowserSessionRepository(orm),
  brand: new PostgresBrandRepository(orm),
  contentIntents: new PostgresContentIntentRepository(orm),
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
  analyzers: new SourceAnalyzerRegistry([
    new WebsiteAnalyzer(),
    new RepositoryAnalyzer(),
    new DocumentAnalyzer(),
    new MediaAnalyzer(),
    new ReferenceAnalyzer(),
  ]),
};

/**
 * The only AI provider wired today is a mock whose output can never satisfy
 * intelligence validation, so interpretation stays off until a real provider is
 * configured. Analysis still runs deterministically either way.
 */
const intelligenceInterpretation =
  process.env["CONTENT_OS_AI_INTERPRETATION"] === "1"
    ? new AiIntelligenceInterpretationProvider(providers.ai)
    : null;

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

const intelligenceService = new IntelligenceService({
  projectService,
  sourceRepository: repositories.sources,
  storageProvider: providers.storage,
  analyzers: providers.analyzers,
  repository: repositories.intelligence,
  interpretationProvider: intelligenceInterpretation,
});

/**
 * Browser agent wiring.
 *
 * The navigation policy is the security boundary, so the runtime and the
 * service receive the same checker: a URL the service refuses is also a URL
 * the request interceptor aborts. Loopback is only reachable for targets a
 * caller explicitly classifies as CONTROL_LOCAL, which the API never does for
 * user-supplied URLs.
 */
const BROWSER_ARTIFACT_DIR =
  process.env["CONTENT_OS_BROWSER_ARTIFACT_DIR"] ??
  join(process.cwd(), ".content-os", "browser-artifacts");

/**
 * Resolves an upload target by Content OS asset id. The runtime never receives a
 * host path, so the only way bytes reach a file input is through an asset that
 * belongs to the same project as the session. Anything else resolves to null and
 * the action fails as UPLOAD_BLOCKED.
 */
async function resolveUploadAsset(
  assetId: string,
  projectId: string | null,
): Promise<BrowserUploadSource | null> {
  if (!projectId) return null;
  const asset = await repositories.assets.getById(assetId);
  if (!asset || asset.projectId !== projectId) return null;

  // Only locally stored objects can be read. A remote asset uri is refused
  // rather than fetched: the browser runtime must never turn into a downloader.
  const prefix = "content-os-storage://local/";
  if (!asset.uri.startsWith(prefix)) return null;
  const key = decodeURIComponent(asset.uri.slice(prefix.length));
  if (!key) return null;

  const bytes = await storage.get(key);
  const name = asset.name.replace(/[\\/]/g, "_");
  const mimeType = uploadMimeTypeFor(name);
  if (!mimeType) return null;
  return { assetId, name, mimeType, bytes };
}

const browserRuntime = new PlaywrightBrowserRuntime({
  navigationPolicy: DEFAULT_BROWSER_NAVIGATION_POLICY,
});

const browserPlanner =
  process.env["CONTENT_OS_AI_BROWSER"] === "1"
    ? new AiBrowserPlanner(providers.ai, {
        checkUrl: (url) => checkBrowserUrl(url, DEFAULT_BROWSER_NAVIGATION_POLICY),
      })
    : new DeterministicBrowserPlanner();

const browserService = new BrowserService({
  sessions: repositories.browserSessions,
  runtime: browserRuntime,
  planner: browserPlanner,
  runtimeOptions: {
    artifactDir: BROWSER_ARTIFACT_DIR,
    navigationTimeoutMs: 30_000,
    actionTimeoutMs: 15_000,
    uploadResolver: resolveUploadAsset,
  },
  checkUrl: (url, targetClass) => {
    checkBrowserUrl(url, { ...DEFAULT_BROWSER_NAVIGATION_POLICY, targetClass });
  },
  intelligence: repositories.intelligence,
  authorize: async (projectId: string, userId: string) => {
    await projectService.getAuthorized(projectId, userId);
  },
});

/**
 * Brand analysis runs fully deterministically. The AI interpreter is optional and
 * shares the same gate as intelligence interpretation: a mock provider cannot
 * produce evidence-cited output, so leaving it off keeps every stored value
 * traceable to a source instead of to a guess.
 */
const brandAnalyzers = new BrandAnalyzerRegistry([
  new WebsiteBrandAnalyzer(),
  new TextBrandAnalyzer(),
  new RepositoryBrandAnalyzer(),
  new CreativeBrandAnalyzer(),
]);

const brandInterpretation =
  process.env["CONTENT_OS_AI_INTERPRETATION"] === "1"
    ? new AiBrandInterpretationProvider(providers.ai)
    : null;

const brandService = new BrandIntelligenceService({
  projectService,
  sourceRepository: repositories.sources,
  assetRepository: repositories.assets,
  storageProvider: providers.storage,
  analyzers: brandAnalyzers,
  repository: repositories.brand,
  intelligence: repositories.intelligence,
  interpretationProvider: brandInterpretation,
});

/**
 * Content intent is deterministic first and model-assisted second. The same
 * interpretation gate as intelligence and brand applies: with it off, a request
 * is resolved entirely by the parser and the resolver, and a request the parser
 * cannot read is asked about rather than guessed at.
 */
const contentIntentInterpretation =
  process.env["CONTENT_OS_AI_INTERPRETATION"] === "1"
    ? new AiContentIntentInterpreter(providers.ai)
    : null;

const contentIntentService = new ContentIntentService({
  projectService,
  repository: repositories.contentIntents,
  validator: new ContentIntentValidator(),
  brand: repositories.brand,
  intelligence: repositories.intelligence,
  interpretationProvider: contentIntentInterpretation,
});

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
    intelligence: intelligenceService,
    brand: brandService,
    browser: browserService,
    contentIntent: contentIntentService,
  },
};