"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../../../components/ui/Button";
import type { LocalizationDetail } from "../../../../../modules/localization-engine/services/localization-service";
import type {
  LocaleGlossaryRecord,
  LocalizationRevisionRecord,
} from "../../../../../modules/localization-engine/domain/types";
import { SegmentReviewTable } from "./SegmentReviewTable";
import { LocalizationFindings } from "./LocalizationFindings";
import { LocaleGlossaryPanel } from "./LocaleGlossaryPanel";
import { LocalizationHistory } from "./LocalizationHistory";
import { LocalizedArtifactPanel } from "./LocalizedArtifactPanel";

type LocalizationWorkspaceProps = {
  projectId: string;
  detail: LocalizationDetail;
  initialGlossary: LocaleGlossaryRecord[];
  initialHistory: {
    revisions: LocalizationRevisionRecord[];
    total: number;
  };
  providers: string[];
};

export function LocalizationWorkspace({
  projectId,
  detail: initialDetail,
  initialGlossary,
  initialHistory,
  providers,
}: LocalizationWorkspaceProps) {
  const router = useRouter();
  const [detail, setDetail] = useState(initialDetail);
  const [glossary, setGlossary] = useState(initialGlossary);
  const [history, setHistory] = useState(initialHistory);
  const [provider, setProvider] = useState(
    initialDetail.job.provider ?? providers[0] ?? "local-rules",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const base = `/api/projects/${projectId}/localization/${initialDetail.job.id}`;
  const { job, snapshot, revisionNumber } = detail;
  const editable = ["DRAFT", "READY_TO_LOCALIZE", "NEEDS_REVIEW", "CHANGES_REQUESTED"].includes(
    job.status,
  );

  async function call(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(path, {
        method: init.method ?? "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(init.body ?? {}),
      });
      const payload = (await response.json().catch(() => null)) as
        | Record<string, unknown>
        | null;

      if (!response.ok) {
        setError(
          (payload && typeof payload["error"] === "string" && payload["error"]) ||
            `Request failed (${response.status})`,
        );
        return null;
      }

      return payload;
    } catch {
      setError("Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function refreshHistory() {
    const response = await fetch(`${base}/history?limit=20&offset=0`, {
      credentials: "include",
    });
    if (response.ok) {
      setHistory((await response.json()) as LocalizationWorkspaceProps["initialHistory"]);
    }
  }

  async function refreshGlossary() {
    const response = await fetch(
      `/api/projects/${projectId}/localization/glossary?sourceLocale=${encodeURIComponent(
        job.sourceLocale,
      )}&targetLocale=${encodeURIComponent(job.targetLocale)}`,
      { credentials: "include" },
    );
    if (response.ok) {
      const payload = (await response.json()) as { terms: LocaleGlossaryRecord[] };
      setGlossary(payload.terms);
    }
  }

  async function apply(payload: Record<string, unknown> | null, label: string) {
    if (!payload) return;
    setDetail({
      job: payload["job"] as LocalizationDetail["job"],
      snapshot: payload["snapshot"] as LocalizationDetail["snapshot"],
      revisionNumber: payload["revisionNumber"] as number,
    });
    setNotice(label);
    await refreshHistory();
    router.refresh();
  }

  async function process() {
    await apply(
      await call(`${base}/process`, {
        body: { expectedRevisionNumber: revisionNumber, provider },
      }),
      "Processed",
    );
  }

  async function validate() {
    const payload = await call(`${base}/validate`, {
      body: { expectedRevisionNumber: revisionNumber },
    });
    if (payload) {
      setNotice(payload["stale"] ? "Source changed — marked stale" : "Validated");
      await apply(payload, "");
      await refreshGlossary();
    }
  }

  async function review(decision: "APPROVE" | "REQUEST_CHANGES") {
    await apply(
      await call(`${base}/review`, {
        body: { expectedRevisionNumber: revisionNumber, decision },
      }),
      decision === "APPROVE" ? "Approved" : "Changes requested",
    );
  }

  async function applyJob() {
    await apply(await call(`${base}/apply`, { body: { expectedRevisionNumber: revisionNumber } }), "Applied");
  }

  async function editSegment(segmentId: string, targetText: string) {
    await apply(
      await call(`${base}/segments/${segmentId}`, {
        method: "PATCH",
        body: { expectedRevisionNumber: revisionNumber, targetText },
      }),
      "Segment updated",
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <section className="rounded-xl border border-[#202329] bg-[#101216] p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-[#62666f]">
              Lifecycle
            </p>
            <span
              className="rounded-full border border-[#30343c] px-2 py-0.5 text-[10px] uppercase tracking-wide text-white"
              data-testid="localization-status"
            >
              {job.status}
            </span>
          </div>
          <p className="mt-2 text-xs text-[#777b84]">
            Revision {revisionNumber} · provider {snapshot.provider ?? "none"}
            {snapshot.providerModel ? ` (${snapshot.providerModel})` : ""}
          </p>

          <label className="mt-3 inline-flex items-center gap-2 text-[10px] text-[#777b84]">
            Provider
            <select
              data-testid="localization-provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              className="rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
            >
              {providers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={process}
              disabled={busy || !["READY_TO_LOCALIZE", "STALE", "FAILED", "APPROVED", "CHANGES_REQUESTED"].includes(job.status)}
              data-testid="process-localization"
            >
              Process
            </Button>
            <Button
              variant="secondary"
              onClick={validate}
              disabled={busy}
              data-testid="validate-localization"
            >
              Validate
            </Button>
            <Button
              variant="secondary"
              onClick={() => review("REQUEST_CHANGES")}
              disabled={busy || !["NEEDS_REVIEW", "APPROVED"].includes(job.status)}
              data-testid="request-changes"
            >
              Request changes
            </Button>
            <Button
              onClick={() => review("APPROVE")}
              disabled={busy || !["NEEDS_REVIEW"].includes(job.status)}
              data-testid="approve-localization"
            >
              Approve
            </Button>
            <Button
              onClick={applyJob}
              disabled={busy || job.status !== "APPROVED"}
              data-testid="apply-localization"
            >
              Apply
            </Button>
          </div>

          {error && (
            <p className="mt-3 text-xs text-red-300" data-testid="localization-action-error">
              {error}
            </p>
          )}
          {notice && (
            <p className="mt-3 text-xs text-emerald-300" data-testid="localization-notice">
              {notice}
            </p>
          )}
        </section>

        <SegmentReviewTable
          segments={snapshot.segments}
          editable={editable}
          busy={busy}
          onEdit={editSegment}
        />
      </div>

      <div className="space-y-6">
        <LocalizationFindings snapshot={snapshot} />
        <LocaleGlossaryPanel
          projectId={projectId}
          glossary={glossary}
          sourceLocale={job.sourceLocale}
          targetLocale={job.targetLocale}
          onChanged={async () => {
            await refreshGlossary();
            router.refresh();
          }}
        />
        <LocalizationHistory history={history} />
        <LocalizedArtifactPanel
          projectId={projectId}
          jobId={job.id}
          applied={job.status === "APPLIED"}
        />
      </div>
    </div>
  );
}
