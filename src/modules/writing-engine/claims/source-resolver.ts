import type { WritingContext, WritingFact } from "../domain/types";

/**
 * Resolves a fact's provenance to real CP06 Source ids.
 *
 * The whole point of this function is the invariant it enforces: an intelligence
 * entity id (a feature, benefit, workflow, claim or shot) is not a source id, and
 * must never be recorded as one. Only ids that appear in the context's
 * `sourceIds` set survive; anything else is dropped rather than trusted.
 */
export function realSourceIdSet(context: WritingContext): Set<string> {
  return new Set(context.sourceIds);
}

export function isKnownSourceId(context: WritingContext, id: string): boolean {
  return context.sourceIds.includes(id);
}

/** Entity ids present in the context, used to reject them if they leak. */
export function entityIdSet(context: WritingContext): Set<string> {
  return new Set(context.facts.map((fact) => fact.entityId));
}

export function resolveFactSourceIds(
  fact: WritingFact,
  context: WritingContext,
): string[] {
  const allowed = realSourceIdSet(context);
  const entities = entityIdSet(context);
  const seen = new Set<string>();

  for (const id of fact.sourceIds) {
    if (!allowed.has(id)) continue;
    if (entities.has(id)) continue;
    seen.add(id);
  }

  return [...seen];
}

/**
 * Filters a raw list of ids down to real Source ids. Used on any provenance a
 * provider produced before it is persisted, so a model cannot inject an entity id
 * and have it stored as if it were a source.
 */
export function sanitizeSourceIds(
  ids: readonly string[],
  context: WritingContext,
): string[] {
  const allowed = realSourceIdSet(context);
  const entities = entityIdSet(context);
  return [...new Set(ids)].filter(
    (id) => allowed.has(id) && !entities.has(id),
  );
}
