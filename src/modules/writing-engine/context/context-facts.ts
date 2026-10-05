import type {
  WritingFact,
  WritingProductContext,
} from "../domain/types";

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/**
 * Flattens the product graph into the grounded statements generation may use.
 *
 * Every fact carries two distinct identifiers: `entityId` names the intelligence
 * entity it came from, and `sourceIds` holds only the real CP06 Source ids that
 * entity's provenance points at. Filtering against `knownSourceIds` here means a
 * fact can never be built with an id that is not a genuine project source.
 */
export function buildFacts(
  product: WritingProductContext,
  knownSourceIds: ReadonlySet<string>,
): WritingFact[] {
  const facts: WritingFact[] = [];
  const realSources = (ids: readonly string[]): string[] =>
    [...new Set(ids)].filter((id) => knownSourceIds.has(id));

  const push = (
    entityId: string,
    entityKind: WritingFact["entityKind"],
    text: string | null,
    sourceIds: readonly string[],
  ): void => {
    const value = clean(text);
    if (!value) return;
    facts.push({ entityId, entityKind, text: value, sourceIds: realSources(sourceIds) });
  };

  const productId = "product";
  push(productId, "PRODUCT", product.name, product.sourceIds);
  push(productId, "PRODUCT", product.shortDescription, product.sourceIds);
  push(productId, "PRODUCT", product.longDescription, product.sourceIds);
  push(productId, "PRODUCT", product.valueProposition, product.sourceIds);
  push(productId, "PRODUCT", product.purpose, product.sourceIds);
  push(productId, "PRODUCT", product.targetUser, product.sourceIds);

  for (const feature of product.features) {
    push(feature.id, "FEATURE", feature.name, feature.sourceIds);
    push(feature.id, "FEATURE", feature.description, feature.sourceIds);
  }
  for (const benefit of product.benefits) {
    push(benefit.id, "BENEFIT", benefit.name, benefit.sourceIds);
    push(benefit.id, "BENEFIT", benefit.description, benefit.sourceIds);
  }
  for (const problem of product.problems) {
    push(problem.id, "PROBLEM", problem.name, problem.sourceIds);
    push(problem.id, "PROBLEM", problem.description, problem.sourceIds);
  }
  for (const workflow of product.workflows) {
    push(workflow.id, "WORKFLOW", workflow.name, workflow.sourceIds);
    if (workflow.steps.length > 0) {
      push(workflow.id, "WORKFLOW", workflow.steps.join(" "), workflow.sourceIds);
    }
  }
  for (const claim of product.claims) {
    push(claim.id, "CLAIM", claim.text, claim.sourceIds);
  }
  for (const audience of product.audienceSignals) {
    push(audience.id, "AUDIENCE", audience.segment, audience.sourceIds);
    push(audience.id, "AUDIENCE", audience.description, audience.sourceIds);
  }

  return facts;
}

/** Every real Source id the facts draw on, de-duplicated. */
export function collectSourceIds(facts: readonly WritingFact[]): string[] {
  const ids = new Set<string>();
  for (const fact of facts) {
    for (const id of fact.sourceIds) ids.add(id);
  }
  return [...ids];
}
