import type { WritingContext } from "../domain/types";

/**
 * Every real Source id a context carries. The grounding layer reads this as the
 * allow-list, so an entity id can never be recorded as provenance.
 */
export function contextSourceIds(context: WritingContext): string[] {
  return [...context.sourceIds];
}

export function contextEntityIds(context: WritingContext): string[] {
  return [...new Set(context.facts.map((fact) => fact.entityId))];
}

export function hasSourceId(context: WritingContext, id: string): boolean {
  return context.sourceIds.includes(id);
}
