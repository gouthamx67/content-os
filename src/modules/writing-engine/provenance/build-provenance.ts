import type { WritingContext, WritingFact } from "../domain/types";
import { collectSourceIds } from "../context/context-facts";

/**
 * The de-duplicated source ids that back every fact in a context. Callers use
 * this to present provenance without re-deriving the rule in each place.
 */
export function buildWritingProvenance(context: WritingContext): string[] {
  return collectSourceIds(context.facts);
}

/** The facts an intelligence entity contributed, for provenance drill-down. */
export function factsForEntity(
  context: WritingContext,
  entityId: string,
): WritingFact[] {
  return context.facts.filter((fact) => fact.entityId === entityId);
}
