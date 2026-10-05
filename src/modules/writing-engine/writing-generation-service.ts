import { createId } from "../../lib/id";
import type { WritingRepository } from "../../core/ports/writing-repository";
import type { WritingContextDependencies } from "./context/build-writing-context";
import { buildWritingContext } from "./context/build-writing-context";
import { validateVariant } from "./claims/validate-variant";
import { validateGenerateRequest } from "./domain/validation";
import {
  REWRITE_INSTRUCTIONS,
  type RewriteInstruction,
  type WritingBlockType,
  type WritingClaimRecord,
  type WritingDocumentRecord,
  type WritingGenerateRequest,
  type WritingGenerationJobRecord,
  type WritingJobStatus,
  type WritingLength,
  type WritingObjective,
  type WritingProvider,
  type WritingTone,
  type WritingVariantRecord,
} from "./domain/types";
import { WritingError } from "./errors";
import { buildWritingRecipe } from "./recipe/build-recipe";
import {
  parseWritingContext,
  serializeWritingContext,
} from "./recipe/snapshot";
import { rewriteCopy } from "./rewrite/rewrite-copy";
import { hashWriting, sha256Hex } from "./serialization/hash-writing";
import type { WritingProviderRegistry } from "./providers/registry";

export type WritingGenerationServiceDeps = {
  repository: WritingRepository;
  authorizeProject: (projectId: string, userId: string) => Promise<void>;
  context: WritingContextDependencies;
  registry: WritingProviderRegistry;
};

export type EnqueueWritingArgs = {
  projectId: string;
  requestedById: string;
  blockType: WritingBlockType;
  tone: WritingTone;
  length: WritingLength;
  objective?: WritingObjective;
  audience?: string | null;
  language?: string | null;
  prompt: string;
  variantCount?: number;
  provider?: WritingProvider;
  intentId?: string | null;
  directionId?: string | null;
  storyboardId?: string | null;
  sceneId?: string | null;
};

export type WritingDocumentView = {
  document: WritingDocumentRecord;
  variants: WritingVariantRecord[];
  claims: WritingClaimRecord[];
};

const DEFAULT_VARIANTS = 3;

/**
 * Turns a request into an immutable job, and answers questions about documents.
 *
 * Enqueueing is the boundary where live project state is frozen: the context is
 * read once, serialised, hashed, and stored on the job. Nothing downstream reads
 * the project again, so a later brand or product edit cannot change what an
 * already-queued job writes.
 */
export class WritingGenerationService {
  constructor(private readonly deps: WritingGenerationServiceDeps) {}

  async enqueue(args: EnqueueWritingArgs): Promise<WritingGenerationJobRecord> {
    const variantCount = args.variantCount ?? DEFAULT_VARIANTS;
    const provider = args.provider ?? "LOCAL_RULES";
    const request: WritingGenerateRequest = {
      projectId: args.projectId,
      requestedById: args.requestedById,
      blockType: args.blockType,
      tone: args.tone,
      length: args.length,
      objective: args.objective ?? "AWARENESS",
      audience: args.audience ?? null,
      language: args.language ?? null,
      prompt: args.prompt,
      variantCount,
      provider,
      intentId: args.intentId ?? null,
      directionId: args.directionId ?? null,
      storyboardId: args.storyboardId ?? null,
      sceneId: args.sceneId ?? null,
    };

    validateGenerateRequest(request);
    await this.deps.authorizeProject(args.projectId, args.requestedById);

    if (!this.deps.registry.providers.includes(provider)) {
      throw new WritingError(
        "WRITING_PROVIDER_UNAVAILABLE",
        `Provider ${provider} is not configured`,
        409,
      );
    }

    const context = await buildWritingContext(
      {
        projectId: args.projectId,
        blockType: request.blockType,
        tone: request.tone,
        length: request.length,
        objective: request.objective,
        audience: request.audience,
        language: request.language,
        userRequest: request.prompt,
        intentId: request.intentId,
        directionId: request.directionId,
        storyboardId: request.storyboardId,
        sceneId: request.sceneId,
      },
      this.deps.context,
    );

    const contextSnapshot = serializeWritingContext(context);
    const contextSha256 = hashWriting(context);
    const recipe = buildWritingRecipe(request, context);
    const now = new Date().toISOString();

    return this.deps.repository.createJob({
      id: createId("wjob"),
      projectId: args.projectId,
      requestedById: args.requestedById,
      documentId: null,
      provider,
      blockType: request.blockType,
      tone: request.tone,
      length: request.length,
      objective: request.objective,
      audience: request.audience,
      language: request.language,
      prompt: request.prompt,
      generationRecipe: recipe.serialized,
      recipeSha256: recipe.recipeSha256,
      contextSnapshot,
      contextSha256,
      variantCount,
      createdAt: now,
      updatedAt: now,
    });
  }

  async listJobs(args: {
    projectId: string;
    userId: string;
    documentId?: string;
    status?: WritingJobStatus;
    limit?: number;
  }): Promise<WritingGenerationJobRecord[]> {
    await this.deps.authorizeProject(args.projectId, args.userId);
    return this.deps.repository.listJobs(args.projectId, {
      documentId: args.documentId,
      status: args.status,
      limit: args.limit,
    });
  }

  async getJob(args: {
    projectId: string;
    jobId: string;
    userId: string;
  }): Promise<WritingGenerationJobRecord> {
    await this.deps.authorizeProject(args.projectId, args.userId);
    const job = await this.deps.repository.getJob(args.projectId, args.jobId);
    if (!job) {
      throw new WritingError("WRITING_JOB_NOT_FOUND", "Writing job not found", 404);
    }
    return job;
  }

  async cancel(args: {
    projectId: string;
    jobId: string;
    userId: string;
  }): Promise<WritingGenerationJobRecord> {
    const existing = await this.getJob(args);
    const accepted = await this.deps.repository.requestCancel(
      args.projectId,
      args.jobId,
    );
    if (!accepted) return existing;
    return (await this.deps.repository.getJob(args.projectId, args.jobId)) ?? existing;
  }

  async listDocuments(args: {
    projectId: string;
    userId: string;
    blockType?: WritingBlockType;
    limit?: number;
  }): Promise<WritingDocumentRecord[]> {
    await this.deps.authorizeProject(args.projectId, args.userId);
    return this.deps.repository.listDocuments(args.projectId, {
      blockType: args.blockType,
      limit: args.limit,
    });
  }

  async getDocument(args: {
    projectId: string;
    documentId: string;
    userId: string;
  }): Promise<WritingDocumentView> {
    const document = await this.requireDocument(args.projectId, args.documentId, args.userId);
    const [variants, claims] = await Promise.all([
      this.deps.repository.listVariants(document.id),
      this.deps.repository.listClaims(args.projectId, document.id),
    ]);
    return { document, variants, claims };
  }

  async getClaim(args: {
    projectId: string;
    documentId: string;
    claimId: string;
    userId: string;
  }): Promise<WritingClaimRecord> {
    await this.requireDocument(args.projectId, args.documentId, args.userId);
    const claim = await this.deps.repository.getClaim(
      args.projectId,
      args.documentId,
      args.claimId,
    );
    if (!claim) {
      throw new WritingError("WRITING_DOCUMENT_NOT_FOUND", "Claim not found", 404);
    }
    return claim;
  }

  async selectVariant(args: {
    projectId: string;
    documentId: string;
    variantId: string;
    userId: string;
  }): Promise<WritingVariantRecord> {
    const document = await this.requireDocument(
      args.projectId,
      args.documentId,
      args.userId,
    );
    const now = new Date().toISOString();

    const variant = await this.deps.repository.selectVariant(
      args.projectId,
      document.id,
      args.variantId,
      now,
    );
    if (!variant) {
      throw new WritingError("WRITING_DOCUMENT_NOT_FOUND", "Variant not found", 404);
    }

    await this.deps.repository.updateDocument(args.projectId, document.id, {
      content: variant.text,
      contentSha256: variant.textSha256,
      updatedAt: now,
    });

    return variant;
  }

  async rewrite(args: {
    projectId: string;
    documentId: string;
    instruction: RewriteInstruction;
    userId: string;
  }): Promise<WritingVariantRecord> {
    if (!(REWRITE_INSTRUCTIONS as readonly string[]).includes(args.instruction)) {
      throw new WritingError(
        "WRITING_UNSUPPORTED_INSTRUCTION",
        `Unsupported instruction: ${String(args.instruction)}`,
      );
    }

    const document = await this.requireDocument(
      args.projectId,
      args.documentId,
      args.userId,
    );

    const variants = await this.deps.repository.listVariants(document.id);
    const source =
      variants.find((variant) => variant.id === document.selectedVariantId) ??
      variants[0] ??
      null;
    if (!source) {
      throw new WritingError(
        "WRITING_NO_GROUNDED_VARIANTS",
        "Document has no variant to rewrite",
        422,
      );
    }

    const context = parseWritingContext(document.contextSnapshot);
    const text = rewriteCopy(source.text, args.instruction, context);
    const validation = validateVariant(text, context);
    if (!validation.accepted) {
      throw new WritingError(
        "WRITING_CLAIM_UNSUPPORTED",
        `Rewrite rejected: ${validation.reason ?? "unsupported claim"}`,
        422,
      );
    }

    const now = new Date().toISOString();
    const variantId = createId("wvar");
    const ordinal = await this.deps.repository.countVariants(document.id);

    const saved = await this.deps.repository.appendVariant({
      projectId: args.projectId,
      documentId: document.id,
      variant: {
        id: variantId,
        documentId: document.id,
        ordinal,
        label: variantLabel(`${source.label}+${args.instruction}`),
        text,
        textSha256: sha256Hex(text),
        instruction: args.instruction,
        selected: true,
        createdAt: now,
        updatedAt: now,
      },
      claims: validation.claims.map((claim) => ({
        id: createId("wclm"),
        projectId: args.projectId,
        documentId: document.id,
        variantId,
        text: claim.text,
        status: claim.status,
        sourceIds: claim.sourceIds,
        reasoning: claim.reasoning,
        createdAt: now,
      })),
      documentUpdate: {
        content: text,
        contentSha256: sha256Hex(text),
        version: document.version + 1,
        selectedVariantId: variantId,
        updatedAt: now,
      },
    });

    if (!saved) {
      throw new WritingError("WRITING_DOCUMENT_NOT_FOUND", "Document not found", 404);
    }
    return saved;
  }

  async generateVariants(args: {
    projectId: string;
    documentId: string;
    userId: string;
    provider?: WritingProvider;
    variantCount?: number;
  }): Promise<WritingVariantRecord[]> {
    const document = await this.requireDocument(
      args.projectId,
      args.documentId,
      args.userId,
    );
    const providerName = args.provider ?? "LOCAL_RULES";
    const variantCount = args.variantCount ?? DEFAULT_VARIANTS;
    const provider = this.deps.registry.resolve(providerName);

    const context = parseWritingContext(document.contextSnapshot);
    const result = await provider.generate({ context, variantCount });

    const accepted = result.candidates
      .map((candidate) => ({ candidate, validation: validateVariant(candidate.text, context) }))
      .filter((entry) => entry.validation.accepted);

    if (accepted.length === 0) {
      throw new WritingError(
        "WRITING_NO_GROUNDED_VARIANTS",
        "No generated variant could be grounded in the project",
        422,
      );
    }

    const now = new Date().toISOString();
    const firstText = accepted[0] as { candidate: { text: string } };
    const firstVariantId = createId("wvar");
    let ordinal = await this.deps.repository.countVariants(document.id);
    const created: WritingVariantRecord[] = [];

    for (let index = 0; index < accepted.length; index += 1) {
      const entry = accepted[index];
      if (!entry) continue;
      const variantId = index === 0 ? firstVariantId : createId("wvar");
      const saved = await this.deps.repository.appendVariant({
        projectId: args.projectId,
        documentId: document.id,
        variant: {
          id: variantId,
          documentId: document.id,
          ordinal,
          label: `V${ordinal + 1}`,
          text: entry.candidate.text,
          textSha256: sha256Hex(entry.candidate.text),
          instruction: entry.candidate.instruction ?? null,
          selected: index === 0,
          createdAt: now,
          updatedAt: now,
        },
        claims: entry.validation.claims.map((claim) => ({
          id: createId("wclm"),
          projectId: args.projectId,
          documentId: document.id,
          variantId,
          text: claim.text,
          status: claim.status,
          sourceIds: claim.sourceIds,
          reasoning: claim.reasoning,
          createdAt: now,
        })),
        documentUpdate: {
          content: firstText.candidate.text,
          contentSha256: sha256Hex(firstText.candidate.text),
          version: document.version + 1,
          selectedVariantId: firstVariantId,
          updatedAt: now,
        },
      });
      if (saved) created.push(saved);
      ordinal += 1;
    }

    return created;
  }

  private async requireDocument(
    projectId: string,
    documentId: string,
    userId: string,
  ): Promise<WritingDocumentRecord> {
    await this.deps.authorizeProject(projectId, userId);
    const document = await this.deps.repository.getDocument(projectId, documentId);
    if (!document) {
      throw new WritingError(
        "WRITING_DOCUMENT_NOT_FOUND",
        "Writing document not found",
        404,
      );
    }
    return document;
  }
}

function variantLabel(label: string): string {
  return label.length <= 64 ? label : `${label.slice(0, 61)}...`;
}
