import type {
  GraphicTemplateType,
  ImageGenerationJobRecord,
} from "./domain/types";
import { ImageGenerationError } from "./errors";
import type { ImageGenerationService } from "./generation-service";
import { IMAGE_GENERATION_LIMITS } from "./generation-limits";
import { DEFAULT_IMAGE_VARIANTS, type ImageVariantSpec } from "./variants";

export type ImageVariantServiceDeps = {
  generation: ImageGenerationService;
};

/**
 * Turns one brief into a set of platform shapes. Each variant is a separate job
 * with its own recipe, so a failure on the transparent cutout cannot take the
 * square crop down with it.
 */
export class ImageVariantService {
  constructor(private readonly deps: ImageVariantServiceDeps) {}

  async enqueueVariants(args: {
    projectId: string;
    userId: string;
    templateType: GraphicTemplateType;
    prompt: string;
    variants?: readonly ImageVariantSpec[];
  }): Promise<ImageGenerationJobRecord[]> {
    const specs = args.variants ?? DEFAULT_IMAGE_VARIANTS;

    // A caller-supplied list is capped before any job is created; the limit is
    // shared with the single-job validator so both paths agree on the ceiling.
    if (specs.length > IMAGE_GENERATION_LIMITS.maxVariants) {
      throw new ImageGenerationError(
        "IMAGE_VARIANT_LIMIT_EXCEEDED",
        `At most ${IMAGE_GENERATION_LIMITS.maxVariants} variants can be generated at once`,
        400,
      );
    }

    const jobs: ImageGenerationJobRecord[] = [];

    for (const spec of specs) {
      jobs.push(
        await this.deps.generation.enqueue({
          projectId: args.projectId,
          requestedById: args.userId,
          templateType: args.templateType,
          prompt: `${args.prompt} (${spec.promptSuffix})`,
          width: spec.width,
          height: spec.height,
          outputFormat: spec.outputFormat,
          transparent: spec.transparent,
        }),
      );
    }

    return jobs;
  }
}
