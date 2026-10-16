"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Button } from "../../../../components/ui/Button";
import type { LocalizationJobRecord, ProjectLocaleRecord } from "../../../../modules/localization-engine/domain/types";

type LocalizationJobListProps = {
  projectId: string;
  initialJobs: LocalizationJobRecord[];
  writingOptions: { id: string; title: string }[];
  locales: ProjectLocaleRecord[];
};

export function LocalizationJobList({
  projectId,
  initialJobs,
  writingOptions,
  locales,
}: LocalizationJobListProps) {
  const router = useRouter();
  const jobs = initialJobs;
  const targets = locales.filter((locale) => locale.isTarget);

  const [sourceType, setSourceType] = useState("WRITING_DOCUMENT");
  const [sourceId, setSourceId] = useState(writingOptions[0]?.id ?? "");
  const [targetLocale, setTargetLocale] = useState(targets[0]?.locale ?? "");
  const [strategy, setStrategy] = useState("TRANSLATE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const effectiveTarget = targetLocale || targets[0]?.locale || "";
  const canCreate = sourceId.trim().length > 0 && effectiveTarget.length > 0;

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!canCreate) return;
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}/localization`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType,
          sourceId: sourceId.trim(),
          targetLocale: effectiveTarget,
          strategy,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { job?: { id: string }; error?: string }
        | null;

      if (!response.ok || !payload?.job) {
        setError(payload?.error ?? "Could not create localization");
        return;
      }

      router.push(`/projects/${projectId}/localization/${payload.job.id}`);
    } catch {
      setError("Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section>
        <p className="mb-3 text-xs uppercase tracking-wide text-[#62666f]">
          Jobs
        </p>
        {jobs.length === 0 ? (
          <p
            className="rounded-xl border border-dashed border-[#30343c] p-6 text-xs text-[#777b84]"
            data-testid="localization-empty"
          >
            No localization jobs yet.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="localization-list">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/projects/${projectId}/localization/${job.id}`}
                  data-testid="localization-row"
                  data-job-id={job.id}
                  data-status={job.status}
                  className="flex items-center justify-between rounded-xl border border-[#202329] bg-[#101216] px-4 py-3 hover:border-[#30343c]"
                >
                  <span>
                    <span className="block text-sm text-white">
                      {job.sourceType} → {job.targetLocale}
                    </span>
                    <span className="text-xs text-[#62666f]">
                      {job.status} · revision {job.headRevisionNumber}
                    </span>
                  </span>
                  <span className="text-xs text-[#62666f]">{job.strategy}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form
        onSubmit={create}
        className="h-fit rounded-xl border border-[#202329] bg-[#101216] p-4"
      >
        <p className="text-xs uppercase tracking-wide text-[#62666f]">
          New localization
        </p>

        <label className="mt-3 block text-[10px] text-[#777b84]">
          Source type
          <select
            data-testid="localization-source-type"
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value)}
            className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          >
            <option value="WRITING_DOCUMENT">Writing document</option>
            <option value="EDITOR_DOCUMENT">Editor document</option>
            <option value="ADAPTATION">Adaptation</option>
            <option value="CAMPAIGN">Campaign</option>
          </select>
        </label>

        {sourceType === "WRITING_DOCUMENT" && writingOptions.length > 0 ? (
          <label className="mt-3 block text-[10px] text-[#777b84]">
            Source document
            <select
              data-testid="localization-source-id"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
            >
              {writingOptions.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="mt-3 block text-[10px] text-[#777b84]">
            Source id
            <input
              data-testid="localization-source-id"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              placeholder="source-id"
              className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
            />
          </label>
        )}

        <label className="mt-3 block text-[10px] text-[#777b84]">
          Target locale
          <select
            data-testid="localization-target"
            value={effectiveTarget}
            onChange={(event) => setTargetLocale(event.target.value)}
            className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          >
            {targets.map((locale) => (
              <option key={locale.id} value={locale.locale}>
                {locale.label} ({locale.locale})
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-[10px] text-[#777b84]">
          Strategy
          <select
            data-testid="localization-strategy"
            value={strategy}
            onChange={(event) => setStrategy(event.target.value)}
            className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          >
            <option value="TRANSLATE">Translate</option>
            <option value="TRANSCREATE">Transcreate</option>
          </select>
        </label>

        {error && (
          <p className="mt-3 text-xs text-red-300" data-testid="create-error">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="mt-4 w-full"
          disabled={busy || !canCreate}
          data-testid="create-localization"
        >
          Create localization
        </Button>
      </form>
    </div>
  );
}
