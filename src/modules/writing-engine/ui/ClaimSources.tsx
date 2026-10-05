import { GroundingBadge } from "./GroundingBadge";
import type { WritingClaimView } from "./types";

/**
 * Lists a claim's supporting source ids.
 *
 * Source ids are shown rather than entity ids on purpose: they are the only
 * provenance a reader can open, and mixing the two would let a feature id look
 * like evidence.
 */
export function ClaimSources({ claim }: { claim: WritingClaimView }) {
  return (
    <li
      data-testid="writing-claim"
      data-status={claim.status}
      className="rounded-lg border border-neutral-200 bg-white p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-neutral-800">{claim.text}</p>
        <GroundingBadge status={claim.status} />
      </div>
      {claim.sourceIds.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2" data-testid="claim-source-ids">
          {claim.sourceIds.map((sourceId) => (
            <li
              key={sourceId}
              className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-xs text-neutral-600"
            >
              {sourceId}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-neutral-500">No supporting source recorded.</p>
      )}
      {claim.reasoning ? (
        <p className="mt-1 text-xs text-neutral-500">{claim.reasoning}</p>
      ) : null}
    </li>
  );
}
