import { container } from "./container";

export const projectService = container.services.projects;

export const generationService = container.services.generation;

export const authService = container.services.auth;

export const workspaceService = container.services.workspaces;

export const sourceService = container.services.sources;

export const assetService = container.services.assets;

export const inputService = container.services.inputs;

export const intelligenceService = container.services.intelligence;

export const brandService = container.services.brand;

export const browserService = container.services.browser;

export const contentIntentService = container.services.contentIntent;

export const creativeDirectorService = container.services.creativeDirections;

export const storyboardService = container.services.storyboards;

export const contentRecommendationService = container.services.recommendations;

export const captureService = container.services.capture;

export const visualCompositionService = container.services.visualCompositions;

export const visualLayerService = container.services.visualLayers;

export const renderJobService = container.services.renders;

export const audioCompositionService = container.services.audio.service;

export const audioRenderJobService = container.services.audio.render;

export const audioService = container.services.audio;

export const audioSourceResolver = container.services.audio.sources;

export const imageGenerationService = container.services.images.generation;

export const graphicDocumentService = container.services.images.documents;

export const imageVariantService = container.services.images.variants;

export const imageRepository = container.services.images.repository;

export const imageSourceResolver = container.services.images.sources;

export const writingGenerationService = container.services.writing.generation;

export const writingRepository = container.services.writing.repository;

export const writingProviderRegistry = container.services.writing.registry;

export const adaptationService = container.services.multiformat.service;

export const adaptationRepository = container.services.multiformat.repository;

export const adaptationSourceResolver = container.services.multiformat.sources;

export const adaptationPlatformAuthority = container.services.multiformat.platforms;

export const editorService = container.services.editor.service;

export const editorRepository = container.services.editor.repository;

export const editorAIService = container.services.editor.ai;

export const editorImportService = container.services.editor.imports;

export const editorAssetResolver = container.services.editor.assets;

export const campaignService = container.services.campaign.service;

export const campaignRepository = container.services.campaign.repository;

export const localizationService = container.services.localization.service;

export const localizationRepository = container.services.localization.repository;

export const localizationProviders = container.services.localization.providers;

export const publishingService = container.services.publishing.publishing;

export const analyticsService = container.services.publishing.analytics;

export const optimizationService = container.services.publishing.optimization;

export const publishingRepository = container.services.publishing.repository;

export const publishingProviders = container.services.publishing.providers;
