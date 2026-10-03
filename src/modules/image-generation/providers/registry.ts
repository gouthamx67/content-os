import type { ImageGenerationProvider } from "../domain/types";
import { ImageGenerationError } from "../errors";
import { localGraphicProvider } from "./local-graphic-provider";
import type { ImageProviderAdapter } from "./provider";
import { remoteImageProvider } from "./remote-image-provider";

export const IMAGE_PROVIDERS: Record<
  ImageGenerationProvider,
  ImageProviderAdapter
> = {
  LOCAL_GRAPHIC: localGraphicProvider,
  REMOTE_IMAGE: remoteImageProvider,
};

/**
 * Resolves a provider adapter by its persisted enum. The map is total over the
 * enum, so a value read back from the database can only ever reach a real
 * adapter; anything else is a programming error, not a request error.
 */
export function getImageProvider(
  provider: ImageGenerationProvider,
): ImageProviderAdapter {
  const adapter = IMAGE_PROVIDERS[provider];
  if (!adapter) {
    throw new ImageGenerationError(
      "IMAGE_PROVIDER_UNAVAILABLE",
      `Unknown image provider: ${String(provider)}`,
      503,
    );
  }
  return adapter;
}
