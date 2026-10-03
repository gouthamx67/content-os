import { createId } from "../../lib/id";
import { HttpError } from "../../lib/http";
import type { ImageGenerationRepository } from "../../core/ports/image-generation-repository";
import type { GenerationContextDependencies } from "./context/build-generation-context";
import { validateGenerationRequest } from "./domain/validation";
import type {
  GraphicDesignGraph,
  GraphicTemplateType,
  ImageGenerationJobRecord,
  ImageGenerationProvider,
  ImageOutputFormat,
  ImageGenerationRequest,
} from "./domain/types";
import { ImageGenerationError } from "./errors";
import { buildGenerationRecipe } from "./recipe/build-recipe";
import { parseDesignGraph } from "./serialization/graphic-document";
import { getGraphicTemplate } from "./templates/registry";

export type ImageGenerationServiceDeps = {
  repository: ImageGenerationRepository;
  authorizeProject: (projectId: string, userId: string) => Promise<void>;
  context: GenerationContextDependencies;
};

export type EnqueueGenerationArgs = {
  projectId: string;
  requestedById: string;
  templateType: GraphicTemplateType;
  prompt: string;
  width?: number;
  height?: number;
  outputFormat?: ImageOutputFormat;
  transparent?: boolean;
  provider?: ImageGenerationProvider;
  intentId?: string | null;
  directionId?: string | null;
  storyboardId?: string | null;
  sceneId?: string | null;
  graphicDocumentId?: string | null;
};

/**
 * Enqueues image generation and answers questions about existing jobs.
 *
 * Enqueueing is where live project state becomes immutable: the context is read
 * once, the template draws it, and the whole thing is serialised into the job's
 * recipe. A later edit to the brand, product or storyboard cannot change what a
 * queued job produces.
 */
export class ImageGenerationService {
  constructor(private readonly deps: ImageGenerationServiceDeps) {}

  async enqueue(args: EnqueueGenerationArgs): Promise<ImageGenerationJobRecord> {
    await this.deps.authorizeProject(args.projectId, args.requestedById);

    const template = getGraphicTemplate(args.templateType);
    const width = args.width ?? template.defaultWidth;
    const height = args.height ?? template.defaultHeight;
    const outputFormat = args.outputFormat ?? template.defaultFormat;
    const transparent = args.transparent ?? false;
    const provider = args.provider ?? "LOCAL_GRAPHIC";

    const request: ImageGenerationRequest = {
      projectId: args.projectId,
      requestedById: args.requestedById,
      templateType: args.templateType,
      prompt: args.prompt,
      width,
      height,
      outputFormat,
      transparent,
      provider,
    };
    validateGenerationRequest(request);

    let graphicDocumentId: string | null = null;
    let designGraph: GraphicDesignGraph | undefined;

    if (args.graphicDocumentId) {
      const document = await this.deps.repository.getDocument(
        args.projectId,
        args.graphicDocumentId,
      );
      if (!document) {
        throw new ImageGenerationError(
          "IMAGE_DOCUMENT_NOT_FOUND",
          "Graphic document not found",
          404,
        );
      }
      designGraph = parseDesignGraph(document.designGraph);
      graphicDocumentId = document.id;
    }

    const built = await buildGenerationRecipe(
      {
        templateType: args.templateType,
        provider,
        prompt: args.prompt,
        width,
        height,
        outputFormat,
        transparent,
        designGraph,
        context: {
          projectId: args.projectId,
          userRequest: args.prompt,
          intentId: args.intentId ?? null,
          directionId: args.directionId ?? null,
          storyboardId: args.storyboardId ?? null,
          sceneId: args.sceneId ?? null,
        },
      },
      this.deps.context,
    );

    const now = new Date().toISOString();

    return this.deps.repository.createJob({
      id: createId("igen"),
      projectId: args.projectId,
      requestedById: args.requestedById,
      graphicDocumentId,
      provider,
      outputFormat,
      width,
      height,
      transparent,
      prompt: args.prompt,
      generationRecipe: built.recipeJson,
      recipeSha256: built.recipeSha256,
      createdAt: now,
      updatedAt: now,
    });
  }

  async get(args: {
    projectId: string;
    jobId: string;
    userId: string;
  }): Promise<ImageGenerationJobRecord> {
    await this.deps.authorizeProject(args.projectId, args.userId);

    const job = await this.deps.repository.getJob(args.projectId, args.jobId);
    if (!job) {
      throw new HttpError(404, "Image generation job not found");
    }

    return job;
  }

  async list(args: {
    projectId: string;
    userId: string;
    graphicDocumentId?: string;
    status?: ImageGenerationJobRecord["status"];
    limit?: number;
  }): Promise<ImageGenerationJobRecord[]> {
    await this.deps.authorizeProject(args.projectId, args.userId);

    return this.deps.repository.listJobs(args.projectId, {
      graphicDocumentId: args.graphicDocumentId,
      status: args.status,
      limit: args.limit,
    });
  }

  async cancel(args: {
    projectId: string;
    jobId: string;
    userId: string;
  }): Promise<ImageGenerationJobRecord> {
    const existing = await this.get(args);

    const accepted = await this.deps.repository.requestCancel(
      args.projectId,
      args.jobId,
    );
    if (!accepted) return existing;

    const updated = await this.deps.repository.getJob(
      args.projectId,
      args.jobId,
    );
    return updated ?? existing;
  }

  async asset(args: {
    projectId: string;
    jobId: string;
    userId: string;
  }) {
    await this.deps.authorizeProject(args.projectId, args.userId);
    return this.deps.repository.getAssetByJob(args.jobId);
  }
}
