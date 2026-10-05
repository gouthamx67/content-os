import { ADAPTATION_ERRORS, AdaptationError } from "../errors";
import {
  hasTransparentPixels,
  inspectImage,
} from "../../image-generation/artifact/image-metadata";

export type ValidateImageOutputArgs = {
  bytes: Buffer;
  mimeType: string;
  expectedWidth: number;
  expectedHeight: number;
  /** The format promises a see-through background. */
  requireAlpha: boolean;
  /** Whether the source actually has one. */
  sourceTransparent: boolean;
};

export type ImageOutputFacts = {
  width: number;
  height: number;
  hasAlpha: boolean;
  transparent: boolean;
};

/**
 * Inspects the bytes that are about to be persisted and refuses anything that is
 * not what the format promised.
 *
 * The dimensions are read back with libvips rather than trusted from the request,
 * so a silently wrong resize cannot become a variant. The alpha rule is the one
 * that matters most: a transparent format is a promise about pixels, and it can
 * only be kept by a source that already had transparency — so CP19 fails rather
 * than handing back an opaque image labelled transparent.
 */
export async function validateImageOutput(
  args: ValidateImageOutputArgs,
): Promise<ImageOutputFacts> {
  let facts: Awaited<ReturnType<typeof inspectImage>>;

  try {
    facts = await inspectImage(args.bytes);
  } catch (error) {
    throw new AdaptationError(
      "ADAPTATION_IMAGE_INVALID",
      ADAPTATION_ERRORS.ADAPTATION_IMAGE_INVALID,
      500,
    );
  }

  if (facts.width !== args.expectedWidth || facts.height !== args.expectedHeight) {
    throw new AdaptationError(
      "ADAPTATION_IMAGE_INVALID",
      `Adapted image is ${facts.width}x${facts.height}, expected ${args.expectedWidth}x${args.expectedHeight}`,
      500,
    );
  }

  const expectedFormat = args.mimeType === "image/png" ? "png" : "jpeg";
  if (facts.format !== expectedFormat) {
    throw new AdaptationError(
      "ADAPTATION_IMAGE_INVALID",
      `Adapted image is ${facts.format}, expected ${expectedFormat}`,
      500,
    );
  }

  if (!args.requireAlpha) {
    return {
      width: facts.width,
      height: facts.height,
      hasAlpha: facts.hasAlpha,
      transparent: false,
    };
  }

  if (!args.sourceTransparent) {
    throw new AdaptationError(
      "ADAPTATION_IMAGE_SOURCE_OPAQUE",
      "A transparent variant cannot be produced from a source with no transparency",
      422,
    );
  }

  if (!facts.hasAlpha) {
    throw new AdaptationError(
      "ADAPTATION_IMAGE_ALPHA_LOST",
      ADAPTATION_ERRORS.ADAPTATION_IMAGE_ALPHA_LOST,
      500,
    );
  }

  const transparent = await hasTransparentPixels(args.bytes);
  if (!transparent) {
    throw new AdaptationError(
      "ADAPTATION_IMAGE_ALPHA_LOST",
      "The adapted image has an alpha channel but no see-through pixel",
      500,
    );
  }

  return {
    width: facts.width,
    height: facts.height,
    hasAlpha: true,
    transparent: true,
  };
}