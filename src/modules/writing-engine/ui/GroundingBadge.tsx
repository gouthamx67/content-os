import type { WritingClaimView } from "./types";

const LABELS: Record<WritingClaimView["status"], string> = {
  GROUNDED: "Grounded",
  REVIEW: "Needs review",
  UNSUPPORTED: "Unsupported",
};

const STYLES: Record<WritingClaimView["status"], string> = {
  GROUNDED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REVIEW: "bg-amber-50 text-amber-700 border-amber-200",
  UNSUPPORTED: "bg-rose-50 text-rose-700 border-rose-200",
};

/**
 * Shows whether a statement is supported by the project's sources.
 *
 * The status is not cosmetic: a GROUNDED badge means at least one real source
 * id backs the sentence, and REVIEW means the fact matched but its provenance
 * did not resolve, which a writer should look at before publishing.
 */
export function GroundingBadge({ status }: { status: WritingClaimView["status"] }) {
  return (
    <span
      data-testid="grounding-status"
      data-status={status}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
