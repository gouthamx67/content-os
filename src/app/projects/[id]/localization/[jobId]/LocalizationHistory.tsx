"use client";

import type { LocalizationRevisionRecord } from "../../../../../modules/localization-engine/domain/types";

type LocalizationHistoryProps = {
  history: {
    revisions: LocalizationRevisionRecord[];
    total: number;
  };
};

export function LocalizationHistory({ history }: LocalizationHistoryProps) {
  return (
    <section className="rounded-xl border border-[#202329] bg-[#101216] p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-[#62666f]">
          History
        </p>
        <span className="text-[10px] text-[#62666f]">
          {history.total} revision{history.total === 1 ? "" : "s"}
        </span>
      </div>

      <ul className="mt-3 space-y-1.5" data-testid="history-list">
        {history.revisions.map((revision) => (
          <li
            key={revision.id}
            data-testid="history-row"
            data-revision-number={revision.revisionNumber}
            data-revision-kind={revision.kind}
            className="rounded-lg border border-[#202329] px-3 py-1.5 text-xs"
          >
            <span className="text-[#b4b7bf]">
              #{revision.revisionNumber} {revision.kind}
            </span>
            <span className="ml-2 text-[10px] text-[#62666f]">
              {revision.snapshotHash.slice(0, 8)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
