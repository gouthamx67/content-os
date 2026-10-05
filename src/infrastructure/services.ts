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
