"use client";

import type { LocalizationSnapshot } from "../../../../../modules/localization-engine/domain/types";

type LocalizationFindingsProps = {
  snapshot: LocalizationSnapshot;
};

const SEVERITY_CLASS: Record<string, string> = {
  ERROR: "text-red-300",
  WARNING: "text-amber-300",
  INFO: "text-[#777b84]",
};

export function LocalizationFindings({ snapshot }: LocalizationFindingsProps) {
  const { findings, readiness } = snapshot;

  return (
    <section className="rounded-xl border border-[#202329] bg-[#101216] p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-[#62666f]">
          Findings
        </p>
        <span
          className="text-[10px] uppercase tracking-wide text-[#777b84]"
          data-testid="localization-ready"
        >
          {readiness.ready ? "Ready" : "Not ready"}
        </span>
      </div>

      {findings.length === 0 ? (
        <p className="mt-2 text-xs text-[#777b84]" data-testid="finding-empty">
          No findings.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {findings.map((finding, index) => (
            <li
              key={`${finding.code}-${index}`}
              data-testid="finding-row"
              data-finding-code={finding.code}
              data-severity={finding.severity}
              className="rounded-lg border border-[#202329] px-3 py-2"
            >
              <p
                className={`text-xs ${
                  SEVERITY_CLASS[finding.severity] ?? "text-white"
                }`}
              >
                {finding.message}
              </p>
              <p className="text-[10px] text-[#62666f]">
                {finding.code} · {finding.severity}
                {finding.segmentId ? ` · ${finding.segmentId}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
