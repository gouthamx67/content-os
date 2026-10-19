import { describe, expect, it } from "vitest";
import type { ImageGenerationService } from "../generation-service";
import { ImageVariantService } from "../generate-variants";
import { DEFAULT_IMAGE_VARIANTS, type ImageVariantSpec } from "../variants";
import { IMAGE_GENERATION_LIMITS } from "../generation-limits";
import type { EnqueueGenerationArgs } from "../generation-service";
import type { ImageGenerationJobRecord } from "../domain/types";

function fakeGeneration(recorded: EnqueueGenerationArgs[]) {
  return {
    enqueue: async (args: EnqueueGenerationArgs) => {
      recorded.push(args);
      return { id: `job_${recorded.length}` } as ImageGenerationJobRecord;
    },
  } as unknown as ImageGenerationService;
}

describe("DEFAULT_IMAGE_VARIANTS", () => {
  it("covers four distinct platform shapes", () => {
    const keys = DEFAULT_IMAGE_VARIANTS.map((variant) => variant.key);
    expect(new Set(keys).size).toBe(4);
    expect(keys).toContain("TRANSPARENT");
  });

  it("only marks the transparent variant as transparent", () => {
    const transparent = DEFAULT_IMAGE_VARIANTS.filter(
      (variant) => variant.transparent,
    );
    expect(transparent).toHaveLength(1);
    expect(transparent[0]!.key).toBe("TRANSPARENT");
  });
});

describe("ImageVariantService", () => {
  it("enqueues one job per variant with a distinct prompt", async () => {
    const recorded: EnqueueGenerationArgs[] = [];
    const service = new ImageVariantService({
      generation: fakeGeneration(recorded),
    });

    const jobs = await service.enqueueVariants({
      projectId: "project_1",
      userId: "user_1",
      templateType: "SOCIAL_POST",
      prompt: "Launch",
    });

    expect(jobs).toHaveLength(DEFAULT_IMAGE_VARIANTS.length);
    expect(recorded.map((job) => job.prompt)).toEqual(
      DEFAULT_IMAGE_VARIANTS.map((variant) => `Launch (${variant.promptSuffix})`),
    );
    expect(recorded.map((job) => [job.width, job.height])).toEqual(
      DEFAULT_IMAGE_VARIANTS.map((variant) => [variant.width, variant.height]),
    );
    expect(recorded[0]!.templateType).toBe("SOCIAL_POST");
  });

  it("refuses a caller-supplied list above the shared variant cap", async () => {
    const recorded: EnqueueGenerationArgs[] = [];
    const service = new ImageVariantService({
      generation: fakeGeneration(recorded),
    });

    const tooMany = Array.from(
      { length: IMAGE_GENERATION_LIMITS.maxVariants + 1 },
      (_value, index) =>
        ({
          key: `V${index}`,
          label: `Variant ${index}`,
          promptSuffix: `variant ${index}`,
          width: 512,
          height: 512,
          outputFormat: "PNG",
          transparent: false,
        }) satisfies ImageVariantSpec,
    );

    await expect(
      service.enqueueVariants({
        projectId: "project_1",
        userId: "user_1",
        templateType: "SOCIAL_POST",
        prompt: "Launch",
        variants: tooMany,
      }),
    ).rejects.toMatchObject({ code: "IMAGE_VARIANT_LIMIT_EXCEEDED" });

    expect(recorded).toHaveLength(0);
  });

  it("accepts a caller-supplied list at exactly the cap", async () => {
    const recorded: EnqueueGenerationArgs[] = [];
    const service = new ImageVariantService({
      generation: fakeGeneration(recorded),
    });

    const atCap = Array.from(
      { length: IMAGE_GENERATION_LIMITS.maxVariants },
      (_value, index) =>
        ({
          key: `V${index}`,
          label: `Variant ${index}`,
          promptSuffix: `variant ${index}`,
          width: 512,
          height: 512,
          outputFormat: "PNG",
          transparent: false,
        }) satisfies ImageVariantSpec,
    );

    const jobs = await service.enqueueVariants({
      projectId: "project_1",
      userId: "user_1",
      templateType: "SOCIAL_POST",
      prompt: "Launch",
      variants: atCap,
    });

    expect(jobs).toHaveLength(IMAGE_GENERATION_LIMITS.maxVariants);
  });
});
