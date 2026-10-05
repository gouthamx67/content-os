import type {
  WritingCandidate,
  WritingContext,
  WritingFact,
} from "../domain/types";
import { clampToBudget } from "../style/block-length";
import { countWords, wordBudget } from "../style/length";
import { applyPreferredVocabulary } from "../style/preferred-vocabulary";
import { stripHype } from "../style/tone";
import type {
  WritingProviderRequest,
  WritingProviderResult,
  WritingTextProvider,
} from "./provider";

export const LOCAL_RULES_VERSION = "local-rules-1";

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function factsOf(context: WritingContext, kind: WritingFact["entityKind"]): WritingFact[] {
  return context.facts.filter((fact) => fact.entityKind === kind);
}

function pick(options: Array<string | null>, index: number): string {
  const usable = options.filter((option): option is string => Boolean(option && option.trim()));
  if (usable.length === 0) return "";
  return usable[index % usable.length] as string;
}

function sentence(text: string | null): string | null {
  const value = clean(text);
  if (!value) return null;
  const capitalised = value.charAt(0).toUpperCase() + value.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => clean(part ?? null))
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .trim();
}

function productName(context: WritingContext): string | null {
  return clean(context.product.name) ?? clean(context.brand.name);
}

function valueProp(context: WritingContext): string | null {
  return (
    clean(context.product.valueProposition) ??
    clean(context.brand.valueProposition) ??
    clean(context.brand.tagline)
  );
}

function ctaText(context: WritingContext): string {
  return (
    clean(context.intent?.cta) ??
    clean(context.direction?.cta) ??
    (productName(context) ? `Get started with ${productName(context)}` : "Learn more")
  );
}

function compose(context: WritingContext, index: number): string {
  const features = factsOf(context, "FEATURE").map((fact) => fact.text);
  const benefits = factsOf(context, "BENEFIT").map((fact) => fact.text);
  const problems = factsOf(context, "PROBLEM").map((fact) => fact.text);
  const workflows = factsOf(context, "WORKFLOW").map((fact) => fact.text);
  const name = productName(context);
  const target = clean(context.audience) ?? clean(context.product.targetUser);
  const proposition = valueProp(context);
  const cta = ctaText(context);

  switch (context.blockType) {
    case "HEADLINE":
      return sentence(
        pick(
          [
            name && proposition ? `${name}: ${proposition}` : null,
            benefits[0] ?? null,
            features[0] ?? null,
            name && target ? `${name} for ${target}` : null,
            clean(context.product.purpose),
          ],
          index,
        ),
      ) ?? "";

    case "HOOK":
      return sentence(
        pick(
          [
            problems[0] ?? null,
            benefits[0] ?? null,
            proposition,
            workflows[0] ?? null,
            features[0] ?? null,
          ],
          index,
        ),
      ) ?? "";

    case "SUBHEAD":
      return sentence(
        pick(
          [
            proposition,
            clean(context.product.shortDescription),
            benefits[0] ?? null,
            features[0] ?? null,
            clean(context.brand.tagline),
          ],
          index,
        ),
      ) ?? "";

    case "BODY":
      return joinParts([
        pick([proposition, clean(context.product.shortDescription)], 0),
        clean(context.product.longDescription) ?? benefits[0] ?? features[0],
        pick([benefits[1] ?? benefits[0], features[1] ?? features[0], workflows[0] ?? null], index),
        target ? `Built for ${target}.` : null,
      ]);

    case "CAPTION":
      return sentence(
        pick(
          [
            benefits[0] ?? null,
            features[0] ?? null,
            clean(context.brand.tagline),
            proposition,
            workflows[0] ?? null,
          ],
          index,
        ),
      ) ?? "";

    case "CTA":
      return sentence(
        pick(
          [
            cta,
            name ? `Start with ${name}` : null,
            target ? `Talk to us about ${target}` : null,
          ],
          index,
        ),
      ) ?? "";

    case "AD_COPY":
      return joinParts([
        sentence(pick([name && proposition ? `${name}: ${proposition}` : null, benefits[0] ?? null, features[0] ?? null], index)),
        sentence(benefits[0] ?? features[0] ?? null),
        sentence(cta),
      ]);

    case "PRODUCT_DESCRIPTION":
      return joinParts([
        sentence(
          name && clean(context.product.shortDescription)
            ? `${name} is ${clean(context.product.shortDescription)}`
            : clean(context.product.shortDescription) ?? name,
        ),
        clean(context.product.longDescription),
        features.length > 0 ? `Key features include ${features.slice(0, 3).join(", ")}.` : null,
        sentence(proposition),
      ]);

    case "SCRIPT":
      return joinParts([
        sentence(clean(context.scene?.voiceover) ?? clean(context.direction?.hook) ?? problems[0] ?? null),
        sentence(clean(context.direction?.thesis) ?? proposition),
        sentence(benefits[0] ?? features[0] ?? workflows[0] ?? null),
        sentence(clean(context.direction?.audienceAngle) ?? (target ? `Made for ${target}` : null)),
        sentence(cta),
      ]);

    case "VOICEOVER":
      return joinParts([
        sentence(clean(context.scene?.voiceover) ?? clean(context.direction?.voiceDirection) ?? null),
        sentence(clean(context.direction?.hook) ?? proposition),
        sentence(benefits[0] ?? features[0] ?? null),
        sentence(cta),
      ]);
  }
}

/**
 * The deterministic provider.
 *
 * It never writes a sentence from nothing: every option it can pick is either a
 * recorded project fact, the product or brand record, or the user's own request.
 * That is what makes the output groundable, and it is deliberately unglamorous —
 * the value is that a fake success is impossible.
 */
export function createLocalRulesProvider(): WritingTextProvider {
  return {
    id: "LOCAL_RULES",

    async generate(request: WritingProviderRequest): Promise<WritingProviderResult> {
      const { context, variantCount } = request;
      const budget = wordBudget(context.blockType, context.length);
      const candidates: WritingCandidate[] = [];
      const seen = new Set<string>();

      for (let index = 0; index < variantCount + 4 && candidates.length < variantCount; index += 1) {
        const composed = compose(context, index);
        if (!composed) continue;

        const withoutHype = stripHype(composed);
        const { text: normalised } = applyPreferredVocabulary(withoutHype, context.brand);
        const text = clampToBudget(normalised, budget.maxWords, budget.maxChars).trim();
        if (!text) continue;
        if (countWords(text) === 0) continue;

        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        candidates.push({
          label: `V${candidates.length + 1}`,
          text,
          instruction: null,
        });
      }

      return {
        candidates,
        providerModel: "local-rules",
        providerVersion: LOCAL_RULES_VERSION,
      };
    },
  };
}
