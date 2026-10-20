import { ImageExecutionError } from "../errors";
import type { ImageProviderAdapter } from "./provider";

/**
 * Tries image providers in operator-defined order.
 *
 * Failover is deliberately narrower than "any error": only an
 * `ImageExecutionError` means the provider itself failed (unreachable,
 * timeout, quota, server error). A feature or request error belongs to the
 * request and must not be retried elsewhere, and a cancellation must stop the
 * job instead of starting another provider.
 */
export const IMAGE_PROVIDER_CHAIN_VERSION = "remote-image/chain/1";

export function createImageProviderChain(
  adapters: readonly ImageProviderAdapter[],
): ImageProviderAdapter {
  if (adapters.length === 0) {
    throw new Error("An image provider chain needs at least one adapter");
  }
  if (adapters.length === 1) return adapters[0];

  return {
    provider: "REMOTE_IMAGE",
    version: IMAGE_PROVIDER_CHAIN_VERSION,

    async generate(input) {
      const failures: string[] = [];
      for (const adapter of adapters) {
        try {
          return await adapter.generate(input);
        } catch (error) {
          if (error instanceof ImageExecutionError) {
            failures.push(error.message);
            continue;
          }
          throw error;
        }
      }
      throw new ImageExecutionError(
        `All image providers failed: ${failures.join("; ")}`,
      );
    },
  };
}
