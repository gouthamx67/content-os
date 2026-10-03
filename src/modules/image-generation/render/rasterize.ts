import sharp from "sharp";
import { ImageGenerationError, ImageExecutionError } from "../errors";
import type { ImageOutputFormat } from "../domain/types";

export type RasterizeInput = {
  svg: string;
  width: number;
  height: number;
  format: ImageOutputFormat;
  transparent: boolean;
};

export type RasterizedImage = {
  bytes: Buffer;
  width: number;
  height: number;
  mimeType: string;
  format: ImageOutputFormat;
};

/**
 * Real rasterization through Sharp (libvips). PNG preserves the alpha channel so
 * a transparent design stays transparent; JPEG has no alpha channel, so a
 * requested transparent JPEG is refused rather than silently flattened into a
 * black background the caller did not ask for.
 */
export async function rasterizeSvg(
  input: RasterizeInput,
): Promise<RasterizedImage> {
  if (input.format === "JPEG" && input.transparent) {
    throw new ImageGenerationError(
      "IMAGE_INVALID_REQUEST",
      "JPEG does not support transparency; use PNG",
      422,
    );
  }

  try {
    let pipeline = sharp(Buffer.from(input.svg, "utf8"), { density: 72 });

    pipeline =
      input.format === "JPEG"
        ? pipeline.flatten({ background: "#000000" }).jpeg({ quality: 90 })
        : pipeline.png();

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    return {
      bytes: data,
      width: info.width,
      height: info.height,
      mimeType: input.format === "JPEG" ? "image/jpeg" : "image/png",
      format: input.format,
    };
  } catch (error) {
    if (error instanceof ImageGenerationError) throw error;
    const message =
      error instanceof Error ? error.message : "Rasterization failed";
    throw new ImageExecutionError(`Failed to rasterize image: ${message}`);
  }
}
