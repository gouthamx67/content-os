import type { ImageGenerationProvider } from "../domain/types";
import { ImageGenerationError } from "../errors";
import {
  aiHordeConfigFromEnv,
  createAiHordeImageProvider,
} from "./ai-horde-image-provider";
import { createImageProviderChain } from "./image-provider-chain";
import { localGraphicProvider } from "./local-graphic-provider";
import {
  createPollinationsImageProvider,
  pollinationsConfigFromEnv,
} from "./pollinations-image-provider";
import type { ImageProviderAdapter } from "./provider";
import {
  createRemoteImageProvider,
  remoteImageConfigFromEnv,
  remoteImageProvider,
} from "./remote-image-provider";

/**
 * The default adapters. REMOTE_IMAGE appears here as the unconfigured hole;
 * `getImageProvider` swaps in the real remote adapter when an image endpoint
 * is configured. The map stays total over the enum either way.
 */
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
  if (provider === "REMOTE_IMAGE") {
    // One persisted enum, several transports. Order is the operator's stated
    // preference: the paid OpenAI-compatible endpoint first (its quota or
    // outage falls through), then community AI Horde, then keyless
    // Pollinations. Only configured transports join the chain; with none the
    // explicit unconfigured hole keeps the 503 behavior.
    const adapters: ImageProviderAdapter[] = [];
    const remote = remoteImageConfigFromEnv();
    if (remote) adapters.push(createRemoteImageProvider(remote));
    const horde = aiHordeConfigFromEnv();
    if (horde) adapters.push(createAiHordeImageProvider(horde));
    const pollinations = pollinationsConfigFromEnv();
    if (pollinations) {
      adapters.push(createPollinationsImageProvider(pollinations));
    }
    if (adapters.length === 0) return remoteImageProvider;
    return adapters.length === 1
      ? adapters[0]
      : createImageProviderChain(adapters);
  }

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
