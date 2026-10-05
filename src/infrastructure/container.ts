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
import { PostgresCreativeDirectionRepository } from "./repositories/postgres-creative-direction-repository";
import { PostgresStoryboardRepository } from "./repositories/postgres-storyboard-repository";
import { PostgresContentRecommendationRepository } from "./repositories/postgres-content-recommendation-repository";
import { PostgresCaptureRepository } from "./repositories/postgres-capture-repository";
import { PostgresVisualRepository } from "./repositories/postgres-visual-repository";
import { PostgresRenderJobRepository } from "./repositories/postgres-render-job-repository";
import { PostgresAudioRepository } from "./repositories/postgres-audio-repository";
import { CaptureService } from "../modules/capture-engine/capture-service";
import { captureStorage } from "../modules/capture-engine/storage/capture-storage";
import { VisualCompositionService } from "../modules/visual-motion-engine/composition-service";
import { VisualLayerService } from "../modules/visual-motion-engine/layer-service";
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
import { AiCreativeDirector } from "./ai/creative-director";
import { CreativeDirectorService } from "../core/services/creative-director-service";
import { DeterministicCreativeDirector } from "../core/services/deterministic-creative-director";
import { StoryboardService } from "../core/services/storyboard-service";
import { AiStoryboardPlanner } from "./ai/storyboard-planner";
import { ContentRecommendationService } from "../core/services/content-recommendation-service";
import { RecommendationContextBuilder } from "../core/services/recommendation-context-builder";
import { ContentRecommendationValidator } from "../core/services/content-recommendation-validator";
import { DeterministicContentRecommenderProvider } from "./recommendations/deterministic-content-recommender-provider";
import { AiContentRecommendationRefiner } from "./ai/content-recommendation-interpreter";
import { RenderJobService } from "../modules/video-rendering/render-job-service";
import { RenderAssetResolver } from "../modules/video-rendering/assets/render-asset-resolver";
import { RenderWorker } from "../modules/video-rendering/render-worker";
import { RenderWorkerHealth } from "../modules/video-rendering/worker-health";
import { renderStorage } from "../modules/video-rendering/storage/render-storage";
import { probeMedia } from "../modules/video-rendering/ffmpeg/ffprobe";
import type { RenderJobStatus } from "../modules/video-rendering/domain/types";
import { AudioCompositionService } from "../modules/audio-engine/audio-composition-service";
import { AudioRenderJobService } from "../modules/audio-engine/render/audio-render-job-service";
import { AudioRenderWorker } from "../modules/audio-engine/render/audio-render-worker";
import { AudioSourceResolver } from "../modules/audio-engine/assets/audio-source-resolver";
import { audioStorage } from "../modules/audio-engine/storage/audio-storage";
import { ensureAudioComposition } from "../modules/audio-engine/integrations/from-visual-composition";
import { PostgresImageRepository } from "./repositories/postgres-image-repository";
import { ImageGenerationService } from "../modules/image-generation/generation-service";
import { ImageVariantService } from "../modules/image-generation/generate-variants";
import { GraphicDocumentService } from "../modules/image-generation/graphic-document-service";
import { ImageGenerationWorker } from "../modules/image-generation/generation-worker";
import { imageStorage } from "../modules/image-generation/storage/image-storage";
import type { ImageSourceDependencies } from "../modules/image-generation/assets/resolve-product-asset";
import { createImageGenerationContextDependencies } from "./image-generation-context";
import { PostgresWritingRepository } from "./repositories/postgres-writing-repository";
import { WritingGenerationService } from "../modules/writing-engine/writing-generation-service";
import { WritingGenerationWorker } from "../modules/writing-engine/writing-generation-worker";
import { createWritingGenerationContextDependencies } from "./writing-generation-context";
import { createWritingProviderRegistry } from "../modules/writing-engine/providers/registry";
import { createLocalRulesProvider } from "../modules/writing-engine/providers/local-rules-provider";
import {
  createRemoteLlmProvider,
  remoteLlmConfigFromEnv,
} from "../modules/writing-engine/providers/remote-llm-provider";

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
  creativeDirections: new PostgresCreativeDirectionRepository(orm),
  storyboards: new PostgresStoryboardRepository(orm),
  recommendations: new PostgresContentRecommendationRepository(orm),
  captures: new PostgresCaptureRepository(orm),
  visual: new PostgresVisualRepository(orm),
  renderJobs: new PostgresRenderJobRepository(orm),
  audio: new PostgresAudioRepository(orm),
  images: new PostgresImageRepository(orm),
  writing: new PostgresWritingRepository(orm),
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

/**
 * A model may propose directions, and the deterministic director stands behind it
 * whether or not one is configured. The order matters: a model failure falls
 * through to the styles rather than leaving the project with nothing.
 */
const creativeDirectors = [
  ...(process.env["CONTENT_OS_AI_INTERPRETATION"] === "1"
    ? [new AiCreativeDirector(providers.ai)]
    : []),
  new DeterministicCreativeDirector(),
];

const creativeDirectorService = new CreativeDirectorService({
  projectService,
  intentRepository: repositories.contentIntents,
  repository: repositories.creativeDirections,
  intelligenceRepository: repositories.intelligence,
  brandRepository: repositories.brand,
  assetRepository: repositories.assets,
  directors: creativeDirectors,
});

/**
 * The same arrangement as the directors: a model may fill in the beats, and the
 * deterministic planner stands behind it whether or not one is configured. The
 * fallback is not a nicety here — the beats themselves come from the deterministic
 * planner, so without it there is no plan to fall back *to*.
 */
const storyboardService = new StoryboardService({
  projectService,
  intentRepository: repositories.contentIntents,
  directionRepository: repositories.creativeDirections,
  repository: repositories.storyboards,
  intelligenceRepository: repositories.intelligence,
  brandRepository: repositories.brand,
  assetRepository: repositories.assets,
  browserSessionRepository: repositories.browserSessions,
  planners: process.env["CONTENT_OS_AI_INTERPRETATION"] === "1"
    ? [new AiStoryboardPlanner(providers.ai)]
    : [],
});

/**
 * Recommendations are deterministic first, refined second — the same shape as the
 * directors and the planners above. The deterministic recommender is always
 * wired, so a project gets suggestions with no model configured; the refiner is
 * gated and, when it is on, may only reword or reorder the same items. It cannot
 * introduce a new opportunity, because an introduced one would have to invent its
 * own grounding.
 */
const contentRecommendationService = new ContentRecommendationService({
  projectService,
  repository: repositories.recommendations,
  contextBuilder: new RecommendationContextBuilder({
    intelligenceRepository: repositories.intelligence,
    brandRepository: repositories.brand,
    assetRepository: repositories.assets,
    intentRepository: repositories.contentIntents,
    storyboardRepository: repositories.storyboards,
  }),
  validator: new ContentRecommendationValidator(),
  providers: [
    new DeterministicContentRecommenderProvider(),
    ...(process.env["CONTENT_OS_AI_INTERPRETATION"] === "1"
      ? [new AiContentRecommendationRefiner(providers.ai)]
      : []),
  ],
  contentIntentService,
});

/**
 * CP13 capture engine.
 *
 * Membership is delegated to the CP04 project guard rather than reimplemented:
 * the capture engine has no opinion about who may open a project, and a second
 * authorization path would be a second thing to get wrong.
 */
const captureService = new CaptureService({
  repository: repositories.captures,
  authorizeProject: async (projectId, userId) => {
    await projectService.getAuthorized(projectId, userId);
  },
});

/**
 * CP14 visual / motion engine.
 *
 * Same membership delegation as capture: the engine composes what a project
 * already contains and has no opinion about who may open the project.
 */
const authorizeVisualProject = async (projectId: string, userId: string) => {
  await projectService.getAuthorized(projectId, userId);
};

const visualCompositionService = new VisualCompositionService({
  repository: repositories.visual,
  authorizeProject: authorizeVisualProject,
});

const visualLayerService = new VisualLayerService({
  repository: repositories.visual,
  authorizeProject: authorizeVisualProject,
});

/**
 * CP15 video rendering.
 *
 * Enqueueing reuses the CP14 composition service for the contract, so the
 * snapshot is built by the same code the preview uses. The worker is a separate
 * process; it is constructed here so both the script and tests share one wiring.
 */
const renderJobService = new RenderJobService({
  repository: repositories.renderJobs,
  authorizeProject: authorizeVisualProject,
  contractFor: (args) => visualCompositionService.rendererContract(args),
});

const renderAssetResolver = new RenderAssetResolver({
  captures: repositories.captures,
  assets: repositories.assets,
  images: repositories.images,
  captureStorage,
  imageStorage,
  storage: providers.storage,
  probe: probeMedia,
});

export const renderWorkerHealth = new RenderWorkerHealth();

export function createRenderWorker(): RenderWorker {
  return new RenderWorker({
    repository: repositories.renderJobs,
    storage: renderStorage,
    assets: renderAssetResolver,
    health: renderWorkerHealth,
  });
}

/**
 * CP16 audio engine.
 *
 * The audio source resolver reuses the CP13 capture repository and the shared
 * asset storage, so an audio track can only reference media the same project
 * already owns. Enqueueing validates the frozen graph and the video render it
 * will be muxed against before anything is queued.
 */
const audioSourceResolver = new AudioSourceResolver({
  captures: repositories.captures,
  assets: repositories.assets,
  captureStorage,
  storage: providers.storage,
});

const audioCompositionService = new AudioCompositionService({
  repository: repositories.audio,
  authorizeProject: authorizeVisualProject,
});

const audioRenderJobService = new AudioRenderJobService({
  repository: repositories.audio,
  authorizeProject: authorizeVisualProject,
  videoRenderFor: async (videoRenderJobId) => {
    const row = (await orm.RenderJob.where({
      id: videoRenderJobId,
    }).first()) as
      | { id: string; projectId: string; status: RenderJobStatus }
      | null;

    return row
      ? { id: row.id, projectId: row.projectId, status: row.status }
      : null;
  },
});

const audioCompositions = {
  service: audioCompositionService,
  render: audioRenderJobService,
  sources: audioSourceResolver,
  ensure: (args: {
    projectId: string;
    compositionId: string;
    userId: string;
  }) =>
    ensureAudioComposition(
      {
        repository: repositories.audio,
        visualCompositionFor: async (forArgs) => {
          const composition = await visualCompositionService.getComposition({
            projectId: forArgs.projectId,
            compositionId: forArgs.compositionId,
            userId: forArgs.userId,
          });

          return {
            id: composition.id,
            projectId: composition.projectId,
            name: composition.name,
            durationMs: composition.durationMs,
          };
        },
      },
      args,
    ),
};

export const audioWorkerHealth = new RenderWorkerHealth();

export function createAudioWorker(): AudioRenderWorker {
  return new AudioRenderWorker({
    repository: repositories.audio,
    storage: audioStorage,
    sources: audioSourceResolver,
    videoArtifactFor: async (videoRenderJobId) => {
      const artifact = (await orm.RenderArtifact.where({
        renderJobId: videoRenderJobId,
      }).first()) as { storageKey: string } | null;
      const job = (await orm.RenderJob.where({ id: videoRenderJobId }).first()) as
        | { width: number; height: number }
        | null;

      if (!artifact || !job) return null;

      return {
        storageKey: artifact.storageKey,
        width: job.width,
        height: job.height,
      };
    },
    videoStoragePath: (storageKey) => renderStorage.absolutePath(storageKey),
    health: audioWorkerHealth,
  });
}

/**
 * CP17 image / graphic engine.
 *
 * The context adapter reads CP06/CP08/CP09/CP10/CP11 through their ports and
 * freezes the result into a recipe, so a job is reproducible after the project
 * moves on. The source resolver only reads bytes the same project already owns,
 * which is what makes a generated graphic unable to pull in another project's
 * media.
 */
const imageContext = createImageGenerationContextDependencies({
  brand: repositories.brand,
  intelligence: repositories.intelligence,
  contentIntents: repositories.contentIntents,
  creativeDirections: repositories.creativeDirections,
  storyboards: repositories.storyboards,
  assets: repositories.assets,
});

const imageSourceResolver: ImageSourceDependencies = {
  getProjectAsset: async (projectId, assetId) => {
    const asset = await repositories.assets.getById(assetId);
    if (!asset || asset.projectId !== projectId) return null;
    return { uri: asset.uri, name: asset.name };
  },
  getGeneratedAsset: async (projectId, assetId) => {
    const asset = await repositories.images.getAsset(projectId, assetId);
    if (!asset) return null;
    return { storageKey: asset.storageKey, mimeType: asset.mimeType };
  },
  storage: providers.storage,
  imageStorage,
};

const imageGenerationService = new ImageGenerationService({
  repository: repositories.images,
  authorizeProject: authorizeVisualProject,
  context: imageContext,
});

const graphicDocumentService = new GraphicDocumentService({
  repository: repositories.images,
  authorizeProject: authorizeVisualProject,
  context: imageContext,
});

const imageVariantService = new ImageVariantService({
  generation: imageGenerationService,
});

const imageServices = {
  generation: imageGenerationService,
  documents: graphicDocumentService,
  variants: imageVariantService,
  repository: repositories.images,
  sources: imageSourceResolver,
};

export const imageWorkerHealth = new RenderWorkerHealth();

export function createImageWorker(): ImageGenerationWorker {
  return new ImageGenerationWorker({
    repository: repositories.images,
    storage: imageStorage,
    sources: imageSourceResolver,
    health: imageWorkerHealth,
  });
}

/**
 * CP18 writing / copy engine.
 *
 * The context adapter freezes CP06/CP08/CP09/CP10/CP11 into the job snapshot,
 * so generation is grounded against exactly the facts captured at enqueue time.
 * The registry only exposes REMOTE_LLM once credentials exist, so a client can
 * never be told an external model wrote copy when none is wired.
 */
const writingContext = createWritingGenerationContextDependencies({
  brand: repositories.brand,
  intelligence: repositories.intelligence,
  contentIntents: repositories.contentIntents,
  creativeDirections: repositories.creativeDirections,
  storyboards: repositories.storyboards,
  sources: repositories.sources,
});

const remoteWritingConfig = remoteLlmConfigFromEnv();

const writingProviderRegistry = createWritingProviderRegistry({
  local: createLocalRulesProvider(),
  ...(remoteWritingConfig
    ? { remote: createRemoteLlmProvider(remoteWritingConfig) }
    : {}),
});

const writingGenerationService = new WritingGenerationService({
  repository: repositories.writing,
  authorizeProject: authorizeVisualProject,
  context: writingContext,
  registry: writingProviderRegistry,
});

const writingServices = {
  generation: writingGenerationService,
  repository: repositories.writing,
  registry: writingProviderRegistry,
};

export const writingWorkerHealth = new RenderWorkerHealth();

export function createWritingWorker(): WritingGenerationWorker {
  return new WritingGenerationWorker({
    repository: repositories.writing,
    registry: writingProviderRegistry,
    health: writingWorkerHealth,
  });
}

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
    creativeDirections: creativeDirectorService,
    storyboards: storyboardService,
    recommendations: contentRecommendationService,
    capture: captureService,
    visualCompositions: visualCompositionService,
    visualLayers: visualLayerService,
    renders: renderJobService,
    audio: audioCompositions,
    images: imageServices,
    writing: writingServices,
  },
};