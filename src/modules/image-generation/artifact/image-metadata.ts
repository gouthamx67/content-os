import sharp from "sharp";
import { ImageExecutionError } from "../errors";

export type ImageMetadata = {
  format: string;
  width: number;
  height: number;
  channels: number;
  hasAlpha: boolean;
  space: string;
};

/**
 * Reads real bytes with libvips. The metadata is stored on the artifact so a
 * later reader can tell what was produced without decoding the image again.
 */
export async function inspectImage(bytes: Uint8Array): Promise<ImageMetadata> {
  try {
    const meta = await sharp(Buffer.from(bytes)).metadata();
    return {
      format: meta.format ?? "unknown",
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      channels: meta.channels ?? 0,
      hasAlpha: Boolean(meta.hasAlpha),
      space: meta.space ?? "unknown",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new ImageExecutionError(`Could not read image metadata: ${message}`);
  }
}

/**
 * Decodes the alpha channel and checks whether any pixel is not fully opaque.
 * `metadata().hasAlpha` only says a channel exists; an image that is entirely
 * opaque still has one. This answers the question the transparency promise
 * actually makes: is there a see-through pixel?
 */
export async function hasTransparentPixels(
  bytes: Uint8Array,
): Promise<boolean> {
  try {
    const { data, info } = await sharp(Buffer.from(bytes))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    for (let index = channels - 1; index < data.length; index += channels) {
      if (data[index] < 255) return true;
    }
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new ImageExecutionError(`Could not inspect image alpha: ${message}`);
  }
}
