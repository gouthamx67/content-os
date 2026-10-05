import { WritingError } from "../errors";
import type { WritingProvider } from "../domain/types";
import type { WritingTextProvider } from "./provider";

export type WritingProviderRegistry = {
  resolve(provider: WritingProvider): WritingTextProvider;
  providers: WritingProvider[];
};

export type WritingProviderRegistryInput = {
  local: WritingTextProvider;
  /** Absent until remote credentials are configured. */
  remote?: WritingTextProvider;
};

/**
 * Resolves a provider name to an implementation.
 *
 * A client may name `REMOTE_LLM`, but naming it is not the same as being allowed
 * to use it: when no remote provider is wired the registry raises a 409 instead
 * of silently falling back to the deterministic one, so a caller is never told a
 * remote model wrote copy that it did not.
 */
export function createWritingProviderRegistry(
  input: WritingProviderRegistryInput,
): WritingProviderRegistry {
  const providers: WritingProvider[] = ["LOCAL_RULES"];
  if (input.remote) providers.push("REMOTE_LLM");

  return {
    providers,
    resolve(provider: WritingProvider): WritingTextProvider {
      if (provider === "LOCAL_RULES") return input.local;
      if (provider === "REMOTE_LLM" && input.remote) return input.remote;
      throw new WritingError(
        "WRITING_PROVIDER_UNAVAILABLE",
        `Provider ${provider} is not configured`,
        409,
      );
    },
  };
}
