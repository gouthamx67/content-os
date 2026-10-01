/**
 * The stable key is what makes a recommendation a durable object rather than a
 * row that gets regenerated. Dismissal and selection both hang off it, so it
 * has to come out identical across refreshes even as ids, scores and wording
 * move.
 *
 * Identity is the thing recommended, not the phrasing: a content type, the
 * subject it is about, and the platform it would go to. The same subject on a
 * different platform is a genuinely different opportunity, because publishing
 * the same demo twice on LinkedIn is not new coverage.
 *
 * Canonical identifiers (`video.product_demo`, `FEATURE`, `linkedin`) are stored
 * verbatim. Only the free-text subject fallback is normalized, because slugging
 * a content type would rewrite its CP09 id and make the key impossible to parse
 * back. Segments are `|`-joined, with the subject marked `id:` or `label:` so
 * "no subject id" is unambiguous and a `:` inside a segment cannot be confused
 * with the marker.
 */

import { canonicalSlug } from "../core/domain/intelligence-canonical";

const SEPARATOR = "|";
const ID_MARKER = "id:";
const LABEL_MARKER = "label:";

export type OpportunityKeyInput = {
  contentTypeId: string;
  subjectType: string;
  subjectId: string | null;
  platform: string;
  /** Only used when there is no subject id, e.g. "the product". */
  subjectLabel?: string | null;
};

export function buildOpportunityKey(input: OpportunityKeyInput): string {
  const subject =
    input.subjectId !== null && input.subjectId !== ""
      ? `${ID_MARKER}${input.subjectId}`
      : `${LABEL_MARKER}${
          canonicalSlug(input.subjectLabel ?? "") ||
          canonicalSlug(input.subjectType) ||
          input.subjectType
        }`;

  return [
    input.contentTypeId,
    input.subjectType,
    subject,
    input.platform,
  ].join(SEPARATOR);
}

/**
 * The identity behind a key, read back without re-deriving it. This is what
 * lets a stored dismissal be matched after the label it was generated from has
 * changed, and what lets the CP09 bridge recover the content type id exactly.
 */
export function parseOpportunityKey(
  key: string,
): (OpportunityKeyInput & { subjectIsLabel: boolean }) | null {
  const segments = key.split(SEPARATOR);
  if (segments.length !== 4) return null;

  const [contentTypeId, subjectType, subjectSegment, platform] = segments;
  if (!contentTypeId || !subjectType || !platform) return null;

  const subjectIsLabel = subjectSegment.startsWith(LABEL_MARKER);
  if (!subjectIsLabel && !subjectSegment.startsWith(ID_MARKER)) return null;

  const subjectValue = subjectSegment.slice(
    subjectIsLabel ? LABEL_MARKER.length : ID_MARKER.length,
  );
  if (!subjectValue) return null;

  return {
    contentTypeId,
    subjectType,
    subjectId: subjectIsLabel ? null : subjectValue,
    subjectLabel: subjectIsLabel ? subjectValue : null,
    platform,
    subjectIsLabel,
  };
}

export type OpportunityKeyIndex = {
  keyToOpportunity: Map<string, string>;
};

export function emptyOpportunityKeyIndex(): OpportunityKeyIndex {
  return { keyToOpportunity: new Map() };
}

export type IndexableOpportunity = {
  id: string;
  key: string;
};

/**
 * Builds the key index and *reports* the two ways a set of keys can be wrong
 * instead of resolving either one.
 *
 * A collision means two recommendations claim the same identity. Picking a
 * winner here would let one row's status quietly overwrite the other's, so the
 * caller has to see it. The database backs stored rows with
 * `@@unique([projectId, key])`, but a freshly generated batch is not persisted
 * yet and has no such constraint behind it, so this check is the only thing
 * standing between a duplicate candidate and a raw constraint violation.
 *
 * A key that does not parse is the subtler failure: it can never equal a key
 * `buildOpportunityKey` produces, so the row it belongs to is invisible to every
 * reconciliation and would be re-inserted under a second identity. Surfacing it
 * here means the bad row is reported rather than quietly duplicated.
 */
export function indexOpportunityKeys(
  rows: readonly IndexableOpportunity[],
): { index: OpportunityKeyIndex; collisions: string[]; malformed: string[] } {
  const index = emptyOpportunityKeyIndex();
  const collisions: string[] = [];
  const malformed: string[] = [];

  for (const row of rows) {
    if (parseOpportunityKey(row.key) === null) {
      malformed.push(row.key);
      continue;
    }
    if (index.keyToOpportunity.has(row.key)) {
      collisions.push(row.key);
      continue;
    }
    index.keyToOpportunity.set(row.key, row.id);
  }

  return { index, collisions, malformed };
}
