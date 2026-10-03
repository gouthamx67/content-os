import { ImageGenerationError } from "../errors";
import type { ImageProviderAdapter } from "./provider";

export const REMOTE_IMAGE_PROVIDER_VERSION = "remote-image/unconfigured";

/**
 * The remote provider is a deliberate hole. There is no external image model
 * wired in CP17, so selecting it fails explicitly rather than pretending to
 * generate. When a real provider is added it replaces this adapter behind the
 * same interface and nothing above the boundary changes.
 */
export const remoteImageProvider: ImageProviderAdapter = {
  provider: "REMOTE_IMAGE",
  version: REMOTE_IMAGE_PROVIDER_VERSION,
  async generate() {
    throw new ImageGenerationError(
      "IMAGE_PROVIDER_UNAVAILABLE",
      "The remote image provider is not configured",
      503,
    );
  },
};
