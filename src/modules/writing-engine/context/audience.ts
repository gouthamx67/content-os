import type { WritingFact, WritingProductContext } from "../domain/types";
import { buildFacts } from "./context-facts";

/** The audience a piece of copy is written for, falling back to the request. */
export function resolveAudience(
  requested: string | null,
  product: WritingProductContext,
): string | null {
  const trimmed = requested?.trim();
  if (trimmed) return trimmed;
  const target = product.targetUser?.trim();
  return target && target.length > 0 ? target : null;
}

/** Builds the fact list for a product context, given the project's real sources. */
export function productFacts(
  product: WritingProductContext,
  knownSourceIds: ReadonlySet<string>,
): WritingFact[] {
  return buildFacts(product, knownSourceIds);
}
