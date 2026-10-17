import type { PublishingProvider } from "./ports";

/**
 * The configured providers, keyed by id.
 *
 * The registry is built once from environment configuration. A provider that
 * is not configured simply is not here, and callers report a structured
 * provider-unavailable state instead of pretending an integration exists.
 */
export class PublishingProviderRegistry {
  private readonly providers: Map<string, PublishingProvider>;

  constructor(providers: readonly PublishingProvider[] = []) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  get(id: string): PublishingProvider | null {
    return this.providers.get(id) ?? null;
  }

  list(): PublishingProvider[] {
    return [...this.providers.values()];
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }
}
