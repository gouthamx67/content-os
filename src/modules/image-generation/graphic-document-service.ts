import { createId } from "../../lib/id";
import type { ImageGenerationRepository } from "../../core/ports/image-generation-repository";
import type { GenerationContextDependencies } from "./context/build-generation-context";
import { buildGenerationContext } from "./context/build-generation-context";
import { validateGenerationRequest } from "./domain/validation";
import type {
  GraphicDocumentRecord,
  GraphicTemplateType,
  ImageGenerationRequest,
  ImageOutputFormat,
} from "./domain/types";
import { ImageGenerationError } from "./errors";
import { hashRecipe } from "./serialization/hash-recipe";
import {
  parseDesignGraph,
  serializeDesignGraph,
} from "./serialization/graphic-document";
import { getGraphicTemplate } from "./templates/registry";

export type GraphicDocumentServiceDeps = {
  repository: ImageGenerationRepository;
  authorizeProject: (projectId: string, userId: string) => Promise<void>;
  context: GenerationContextDependencies;
};

export type CreateGraphicDocumentArgs = {
  projectId: string;
  userId: string;
  name: string;
  templateType: GraphicTemplateType;
  prompt: string;
  width?: number;
  height?: number;
  outputFormat?: ImageOutputFormat;
  transparent?: boolean;
  intentId?: string | null;
  directionId?: string | null;
  storyboardId?: string | null;
  sceneId?: string | null;
};

/**
 * Owns the saved, editable design graph. A document is a template's drawing
 * frozen into JSON with its digest, so it can be re-rendered later without the
 * template being consulted again.
 */
export class GraphicDocumentService {
  constructor(private readonly deps: GraphicDocumentServiceDeps) {}

  async create(
    args: CreateGraphicDocumentArgs,
  ): Promise<GraphicDocumentRecord> {
    await this.deps.authorizeProject(args.projectId, args.userId);

    const template = getGraphicTemplate(args.templateType);
    const width = args.width ?? template.defaultWidth;
    const height = args.height ?? template.defaultHeight;
    const outputFormat = args.outputFormat ?? template.defaultFormat;
    const transparent = args.transparent ?? false;

    const request: ImageGenerationRequest = {
      projectId: args.projectId,
      requestedById: args.userId,
      templateType: args.templateType,
      prompt: args.prompt,
      width,
      height,
      outputFormat,
      transparent,
    };
    validateGenerationRequest(request);

    const context = await buildGenerationContext(
      {
        projectId: args.projectId,
        userRequest: args.prompt,
        intentId: args.intentId ?? null,
        directionId: args.directionId ?? null,
        storyboardId: args.storyboardId ?? null,
        sceneId: args.sceneId ?? null,
      },
      this.deps.context,
    );

    const designGraph = template.build({
      context,
      width,
      height,
      transparent,
    });
    const now = new Date().toISOString();

    return this.deps.repository.createDocument({
      id: createId("gdoc"),
      projectId: args.projectId,
      createdById: args.userId,
      name: args.name,
      templateType: args.templateType,
      width,
      height,
      outputFormat,
      transparent,
      designGraph: serializeDesignGraph(designGraph),
      designGraphHash: hashRecipe(designGraph),
      contractVersion: designGraph.contractVersion,
      createdAt: now,
      updatedAt: now,
    });
  }

  async get(args: {
    projectId: string;
    documentId: string;
    userId: string;
  }): Promise<GraphicDocumentRecord> {
    await this.deps.authorizeProject(args.projectId, args.userId);
    const document = await this.deps.repository.getDocument(
      args.projectId,
      args.documentId,
    );
    if (!document) {
      throw new ImageGenerationError(
        "IMAGE_DOCUMENT_NOT_FOUND",
        "Graphic document not found",
        404,
      );
    }
    return document;
  }

  async list(args: {
    projectId: string;
    userId: string;
    limit?: number;
  }): Promise<GraphicDocumentRecord[]> {
    await this.deps.authorizeProject(args.projectId, args.userId);
    return this.deps.repository.listDocuments(args.projectId, args.limit);
  }

  async update(args: {
    projectId: string;
    documentId: string;
    userId: string;
    name?: string;
    width?: number;
    height?: number;
    outputFormat?: ImageOutputFormat;
    transparent?: boolean;
  }): Promise<GraphicDocumentRecord> {
    const existing = await this.get(args);

    const name = args.name ?? existing.name;
    const width = args.width ?? existing.width;
    const height = args.height ?? existing.height;
    const outputFormat = args.outputFormat ?? existing.outputFormat;
    const transparent = args.transparent ?? existing.transparent;

    const geometryChanged =
      width !== existing.width ||
      height !== existing.height ||
      outputFormat !== existing.outputFormat ||
      transparent !== existing.transparent;

    const changes: {
      name: string;
      updatedAt: string;
      designGraph?: string;
      designGraphHash?: string;
    } = { name, updatedAt: new Date().toISOString() };

    if (geometryChanged) {
      const existingGraph = parseDesignGraph(existing.designGraph);
      const resized = {
        ...existingGraph,
        width,
        height,
        background:
          transparent ? ({ kind: "TRANSPARENT" } as const) : existingGraph.background,
      };
      changes.designGraph = serializeDesignGraph(resized);
      changes.designGraphHash = hashRecipe(resized);
    }

    return this.deps.repository.updateDocument(
      args.projectId,
      args.documentId,
      changes,
    );
  }

  async remove(args: {
    projectId: string;
    documentId: string;
    userId: string;
  }): Promise<void> {
    const existing = await this.get(args);
    await this.deps.repository.softDeleteDocument(
      args.projectId,
      existing.id,
      new Date().toISOString(),
    );
  }
}
