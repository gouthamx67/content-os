import sharp from "sharp";
import type { FormatContract } from "../../domain/types";
import { AdaptationError } from "../../errors";
import { ADAPTATION_LIMITS } from "../../limits";
import { inspectImage } from "../../../image-generation/artifact/image-metadata";
import { validateImageOutput } from "../../validation/validate-image-output";

export type FitImageArgs = {
  /** The verified CP17 bytes. Never re-read from the snapshot's metadata. */
  sourceBytes: Buffer;
  sourceTransparent: boolean;
  format: FormatContract;
};

export type FittedImage = {
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
};

/**
 * Re-crops a generated image into one of CP19's output shapes.
 *
 * `COVER` fills the target and crops the overflow from the centre; `CONTAIN`
 * fits the whole image inside the target on a transparent canvas. The pixel
 * budget is checked before any decode, so an impossible target costs nothing,
 * and the result is inspected again afterwards — an adaptation that came out the
 * wrong size is a bug worth failing on, not a variant worth shipping.
 */
export async function fitImage(args: FitImageArgs): Promise<FittedImage> {
  const target = args.format.image;

  if (!target) {
    throw new AdaptationError(
      "ADAPTATION_FORMAT_KIND_MISMATCH",
      `${args.format.id} is not an image format`,
      422,
    );
  }

  const pixels = target.width * target.height;
  if (pixels > ADAPTATION_LIMITS.maxImagePixels) {
    throw new AdaptationError(
      "ADAPTATION_IMAGE_TOO_LARGE",
      `${target.width}x${target.height} exceeds the pixel budget`,
      422,
    );
  }

  const source = await inspectImage(args.sourceBytes);
  if (source.width * source.height > ADAPTATION_LIMITS.maxSourceImagePixels) {
    throw new AdaptationError(
      "ADAPTATION_IMAGE_TOO_LARGE",
      "The source image exceeds the pixel budget",
      422,
    );
  }

  let pipeline = sharp(args.sourceBytes, { failOn: "error" });

  if (target.fit === "CONTAIN") {
    pipeline = pipeline
      .resize({
        width: target.width,
        height: target.height,
        fit: "contain",
        position: target.position,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png();
  } else {
    pipeline = pipeline
      .resize({
        width: target.width,
        height: target.height,
        fit: "cover",
        position: target.position,
      })
      .flatten({ background: "#ffffff" })
      .png();
  }

  const { data } = await pipeline.toBuffer({ resolveWithObject: true });
  const bytes = Buffer.from(data);

  const facts = await validateImageOutput({
    bytes,
    mimeType: target.mimeType,
    expectedWidth: target.width,
    expectedHeight: target.height,
    requireAlpha: target.alpha,
    sourceTransparent: args.sourceTransparent,
  });

  return {
    bytes,
    mimeType: target.mimeType,
    width: facts.width,
    height: facts.height,
  };
}