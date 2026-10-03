import type { ImageOutputFormat } from "../domain/types";
import { ImageGenerationError } from "../errors";
import type { ImageMetadata } from "./image-metadata";
import { hasTransparentPixels } from "./image-metadata";

export type VerifyGeneratedImageInput = {
  bytes: Uint8Array;
  metadata: ImageMetadata;
  expected: {
    width: number;
    height: number;
    format: ImageOutputFormat;
    transparent: boolean;
  };
};

/**
 * The gate a job must pass before it may be marked SUCCEEDED. A stored artifact
 * that does not match what the recipe asked for is not a partial success; it is
 * a failure the API should surface rather than a URL that lies.
 */
export async function verifyGeneratedImage(
  input: VerifyGeneratedImageInput,
): Promise<void> {
  const { metadata, expected } = input;

  const expectedFormat = expected.format === "JPEG" ? "jpeg" : "png";
  if (metadata.format !== expectedFormat) {
    throw invalid(
      `Expected a ${expectedFormat} image but produced ${metadata.format}`,
    );
  }

  if (metadata.width !== expected.width || metadata.height !== expected.height) {
    throw invalid(
      `Expected ${expected.width}x${expected.height} but produced ${metadata.width}x${metadata.height}`,
    );
  }

  if (expected.transparent) {
    if (expected.format !== "PNG") {
      throw invalid("Only PNG can be transparent");
    }
    if (!metadata.hasAlpha) {
      throw invalid("A transparent image was requested but the output has no alpha channel");
    }
    if (!(await hasTransparentPixels(input.bytes))) {
      throw invalid(
        "A transparent image was requested but every pixel is fully opaque",
      );
    }
  }
}

function invalid(message: string): ImageGenerationError {
  return new ImageGenerationError("IMAGE_OUTPUT_INVALID", message, 422);
}
