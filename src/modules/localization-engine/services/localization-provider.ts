import type {
  LocalizationProvider,
  LocalizationProviderRequest,
  LocalizationProviderResult,
} from "../integrations/ports";

export const LOCAL_RULES_PROVIDER = "local-rules";
export const LOCAL_RULES_VERSION = "local-rules-1";

/**
 * Deterministic substitution for pinned terms only. A `doNotTranslate` term is
 * left exactly as written; every other pinned term is replaced with its target
 * form. The matched span is replaced in place, so surrounding punctuation and
 * casing are preserved.
 */
function applyTerm(text: string, term: string, replacement: string): string {
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index === -1) return text;
  return text.slice(0, index) + replacement + text.slice(index + term.length);
}

/**
 * The offline baseline provider.
 *
 * It is explicitly not machine translation: it applies the project glossary and
 * otherwise returns the source text, which readiness surfaces as an
 * `UNCHANGED_TRANSLATION` warning rather than hiding it. That keeps the engine
 * usable without an external service and keeps the limitation visible, instead
 * of inventing fluent-looking text and calling it a translation.
 */
export class LocalizationRulesProvider implements LocalizationProvider {
  readonly name = LOCAL_RULES_PROVIDER;

  async localize(
    request: LocalizationProviderRequest,
  ): Promise<LocalizationProviderResult> {
    const segments = request.segments.map((segment) => {
      let target = segment.sourceText;
      for (const entry of request.glossary) {
        const term = entry.term.trim();
        if (term.length === 0) continue;
        if (entry.doNotTranslate) continue;
        if (entry.translation.trim().length === 0) continue;
        target = applyTerm(target, term, entry.translation);
      }
      return { segmentId: segment.id, targetText: target };
    });

    return {
      provider: this.name,
      providerModel: LOCAL_RULES_VERSION,
      segments,
    };
  }
}

export type LocalizationProviderRegistry = {
  get(name?: string): LocalizationProvider;
  names(): string[];
};

/**
 * Resolves a provider by name. The default (`local-rules`) is always present;
 * anything else must have been registered, so a job that names an unreachable
 * provider fails loudly instead of silently falling back to the rules provider.
 */
export function createLocalizationProviderRegistry(
  extra: readonly LocalizationProvider[] = [],
): LocalizationProviderRegistry {
  const providers = new Map<string, LocalizationProvider>();
  const rules = new LocalizationRulesProvider();
  providers.set(rules.name, rules);
  for (const provider of extra) providers.set(provider.name, provider);

  return {
    get(name?: string): LocalizationProvider {
      const key = name ?? rules.name;
      const provider = providers.get(key);
      if (!provider) {
        throw new Error(`Unknown localization provider: ${key}`);
      }
      return provider;
    },
    names(): string[] {
      return [...providers.keys()].sort();
    },
  };
}
