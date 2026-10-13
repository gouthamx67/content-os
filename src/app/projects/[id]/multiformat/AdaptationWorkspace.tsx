"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import type { FormatContract } from "../../../../modules/multiformat-engine/domain/types";

type SourceType = "WRITING_VARIANT" | "GENERATED_IMAGE" | "VISUAL_COMPOSITION";
type SelectableSource = { id: string; label: string; preview: string };

type WritingSource = {
  documentId: string;
  variants: Array<{ id: string; label: string; preview: string }>;
};
type RasterSource = SelectableSource;
type CompositionSource = SelectableSource;

type Sources = {
  writing: WritingSource[];
  images: RasterSource[];
  compositions: CompositionSource[];
};

type Job = {
  id: string;
  formatId: string;
  kind: "COPY" | "IMAGE" | "VIDEO";
  status: string;
  progressPct: number;
  platformId: string | null;
  outputText: string | null;
  outputMimeType: string | null;
  outputByteSize: number | null;
  outputWidth: number | null;
  outputHeight: number | null;
  provenanceSourceIds: string[];
  errorCode: string | null;
  errorMessage: string | null;
};

type Batch = {
  batch: {
    id: string;
    sourceType: SourceType;
    sourceId: string;
    status: string;
    progressPct: number;
    createdAt: string;
  };
  jobs: Job[];
};

interface Props {
  projectId: string;
  formats: FormatContract[];
  sources: Sources;
  initialBatches: Batch[];
}

const SOURCE_KIND: Record<SourceType, FormatContract["kind"]> = {
  WRITING_VARIANT: "COPY",
  GENERATED_IMAGE: "IMAGE",
  VISUAL_COMPOSITION: "VIDEO",
};

/** A job is finished when nothing further will happen to it. */
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

export function AdaptationWorkspace({
  projectId,
  formats,
  sources,
  initialBatches,
}: Props) {
  const [sourceType, setSourceType] = useState<SourceType>("WRITING_VARIANT");
  const [sourceId, setSourceId] = useState("");
  const [platformId, setPlatformId] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [batches, setBatches] = useState<Batch[]>(initialBatches);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const available = useMemo(
    () => formats.filter((format) => format.kind === SOURCE_KIND[sourceType]),
    [formats, sourceType],
  );

  const selectableSources = useMemo<SelectableSource[]>(
    () => {
      if (sourceType === "GENERATED_IMAGE") return sources.images;
      if (sourceType === "VISUAL_COMPOSITION") return sources.compositions;

      return sources.writing.flatMap((entry) =>
        entry.variants.map((variant) => ({
          id: variant.id,
          label: variant.label,
          preview: variant.preview,
        })),
      );
    },
    [sources, sourceType],
  );

  // Changing the source kind invalidates everything downstream of it — the source
  // itself and every format chosen for the previous kind — so it is done in the one
  // event that caused it rather than in an effect that would chase the change with
  // a second render.
  function changeSourceType(type: SourceType) {
    const next =
      type === "GENERATED_IMAGE"
        ? sources.images
        : type === "VISUAL_COMPOSITION"
          ? sources.compositions
          : sources.writing.flatMap((entry) =>
              entry.variants.map((variant) => ({
                id: variant.id,
                label: variant.label,
                preview: variant.preview,
              })),
            );

    setSourceType(type);
    setSourceId(next[0]?.id ?? "");
    setTargets([]);
  }

  // The stored selection is only honoured while it is still meaningful, so a stale
  // id from a previous kind can never be submitted.
  const effectiveSourceId = selectableSources.some(
    (source) => source.id === sourceId,
  )
    ? sourceId
    : (selectableSources[0]?.id ?? "");

  const effectiveTargets = targets.filter((id) =>
    available.some((format) => format.id === id),
  );

  // Follow the runs that are still moving. Polling stops as soon as every batch is
  // terminal, so an idle page does not keep hitting the database.
  useEffect(() => {
    const live = batches.filter((batch) => !TERMINAL.has(batch.batch.status));

    if (live.length === 0) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const refreshed = await Promise.all(
          live.map(async (batch) => {
            const response = await fetch(
              `/api/projects/${projectId}/multiformat/batches/${batch.batch.id}`,
              { credentials: "include" },
            );

            if (!response.ok) return batch;

            return (await response.json()) as Batch;
          }),
        );

        if (cancelled) return;

        setBatches((current) =>
          current.map((batch) => refreshed.find((next) => next.batch.id === batch.batch.id) ?? batch),
        );

        if (refreshed.some((batch) => !TERMINAL.has(batch.batch.status))) {
          timer.current = setTimeout(poll, 1200);
        }
      } catch {
        // A dropped poll is not worth surfacing: the next one will catch up.
      }
    };

    timer.current = setTimeout(poll, 600);

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [batches, projectId]);

  function toggleTarget(formatId: string) {
    setTargets((current) =>
      current.includes(formatId)
        ? current.filter((id) => id !== formatId)
        : [...current, formatId],
    );
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/multiformat/batches`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceType,
            sourceId: effectiveSourceId,
            targets: effectiveTargets.map((formatId) => ({
              formatId,
              platformId: platformId.trim() === "" ? undefined : platformId.trim(),
            })),
          }),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? "Could not create the batch");
        return;
      }

      const payload = (await response.json()) as Batch;
      setBatches((current) => [payload, ...current]);
      setTargets([]);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function cancelBatch(batchId: string) {
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/multiformat/batches/${batchId}/cancel`,
        { method: "POST", credentials: "include" },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? "Could not cancel the batch");
      }
    } catch {
      setError("Network error");
    }
  }

  const canSubmit = effectiveSourceId !== "" && effectiveTargets.length > 0 && !busy;

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <form onSubmit={create} className="space-y-5">
        <section className="rounded-xl border border-[#202329] bg-[#121417] p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-[#62666f]">
            1 · Source
          </h2>

          <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-[#0c0e10] p-1">
            {(["WRITING_VARIANT", "GENERATED_IMAGE", "VISUAL_COMPOSITION"] as const).map(
              (type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => changeSourceType(type)}
                  className={`rounded-md px-2 py-1.5 text-[11px] transition ${
                    sourceType === type
                      ? "bg-[#23272e] text-white"
                      : "text-[#777b84] hover:text-white"
                  }`}
                >
                  {type === "WRITING_VARIANT"
                    ? "Copy"
                    : type === "GENERATED_IMAGE"
                      ? "Image"
                      : "Video"}
                </button>
              ),
            )}
          </div>

          <label className="mt-3 block text-[11px] text-[#777b84]">
            Source
            <select
              value={effectiveSourceId}
              onChange={(event) => setSourceId(event.target.value)}
              disabled={selectableSources.length === 0}
              className="mt-1 w-full rounded-lg border border-[#262a31] bg-[#0c0e10] px-2 py-2 text-xs text-white disabled:opacity-50"
            >
              {selectableSources.length === 0 && (
                <option value="">Nothing of this kind in the project</option>
              )}
              {selectableSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label} — {source.preview}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="rounded-xl border border-[#202329] bg-[#121417] p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-[#62666f]">
            2 · Formats
          </h2>

          <ul className="mt-3 space-y-1">
            {available.map((format) => {
              const checked = effectiveTargets.includes(format.id);

              return (
                <li key={format.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2 py-2 text-xs transition ${
                      checked
                        ? "border-[#3d6b4f] bg-[#14201a]"
                        : "border-[#262a31] hover:border-[#333842]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTarget(format.id)}
                      className="mt-0.5 accent-[#4f8a68]"
                    />
                    <span className="flex-1">
                      <span className="block text-white">{format.label}</span>
                      <span className="block text-[10px] text-[#62666f]">
                        {format.image
                          ? `${format.image.width}x${format.image.height} · ${format.image.fit.toLowerCase()}`
                          : format.copy
                            ? `${format.copy.maxCharacters} characters`
                            : format.video
                              ? `${format.video.width}x${format.video.height} · re-rendered`
                              : ""}
                        {format.image?.alpha ? " · alpha" : ""}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <label className="mt-3 block text-[11px] text-[#777b84]">
            Platform (optional)
            <input
              value={platformId}
              onChange={(event) => setPlatformId(event.target.value)}
              placeholder="e.g. linkedin"
              className="mt-1 w-full rounded-lg border border-[#262a31] bg-[#0c0e10] px-2 py-2 text-xs text-white placeholder:text-[#4a4e57]"
            />
          </label>
        </section>

        {error && (
          <p className="rounded-lg border border-[#5a2b2b] bg-[#1c1212] px-3 py-2 text-xs text-[#e08a8a]">
            {error}
          </p>
        )}

        <Button type="submit" disabled={!canSubmit} className="w-full">
          {busy ? "Queueing…" : `Adapt into ${effectiveTargets.length || "…"}`}
        </Button>
      </form>

      <div className="space-y-4">
        {batches.length === 0 && (
          <p className="rounded-xl border border-dashed border-[#30343c] p-8 text-center text-sm text-[#777b84]">
            No adaptations yet. Pick a source and a format to begin.
          </p>
        )}

        {batches.map((batch) => (
          <BatchCard
            key={batch.batch.id}
            projectId={projectId}
            batch={batch}
            onCancel={() => cancelBatch(batch.batch.id)}
          />
        ))}
      </div>
    </div>
  );
}

function BatchCard({
  projectId,
  batch,
  onCancel,
}: {
  projectId: string;
  batch: Batch;
  onCancel: () => void;
}) {
  const settled = TERMINAL.has(batch.batch.status);

  return (
    <section className="rounded-xl border border-[#202329] bg-[#121417] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-white">
            {batch.batch.sourceType.replace(/_/g, " ").toLowerCase()}
          </div>
          <div className="mt-0.5 text-[10px] text-[#62666f]">
            {new Date(batch.batch.createdAt).toLocaleString()} ·{" "}
            {batch.jobs.length} target{batch.jobs.length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatusPill status={batch.batch.status} />
          {!settled && (
            <Button variant="ghost" onClick={onCancel} className="text-[11px]">
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 h-1 overflow-hidden rounded-full bg-[#1b1e23]">
        <div
          className="h-full rounded-full bg-[#4f8a68] transition-[width]"
          style={{ width: `${batch.batch.progressPct}%` }}
        />
      </div>

      <ul className="mt-3 space-y-2">
        {batch.jobs.map((job) => (
          <li
            key={job.id}
            className="rounded-lg border border-[#1e2127] bg-[#0e1013] p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-white">{job.formatId}</span>
              <div className="flex items-center gap-2">
                <StatusPill status={job.status} />
                {job.kind !== "COPY" && job.status === "SUCCEEDED" && (
                  <a
                    href={`/api/projects/${projectId}/multiformat/jobs/${job.id}/stream`}
                    className="rounded-md border border-[#262a31] px-2 py-1 text-[10px] text-[#9aa0aa] hover:border-[#3a3f49] hover:text-white"
                  >
                    Download
                  </a>
                )}
              </div>
            </div>

            {job.outputWidth && job.outputHeight && (
              <div className="mt-1 text-[10px] text-[#62666f]">
                {job.outputWidth}x{job.outputHeight}
                {job.outputByteSize ? ` · ${formatBytes(job.outputByteSize)}` : ""}
              </div>
            )}

            {job.kind === "COPY" && job.outputText && (
              <p className="mt-2 whitespace-pre-wrap rounded-md bg-[#0a0c0e] p-2 text-[11px] leading-relaxed text-[#c9ced6]">
                {job.outputText}
              </p>
            )}

            {job.provenanceSourceIds.length > 0 && (
              <div className="mt-2 text-[10px] text-[#62666f]">
                Built from{" "}
                {job.provenanceSourceIds.map((id, index) => (
                  <span key={id} className="font-mono text-[#7f8794]">
                    {index > 0 && ", "}
                    {id.slice(0, 10)}
                  </span>
                ))}
              </div>
            )}

            {job.errorCode && (
              <p className="mt-2 rounded-md bg-[#1c1212] px-2 py-1.5 text-[10px] text-[#e08a8a]">
                {job.errorMessage ?? job.errorCode}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "SUCCEEDED"
      ? "border-[#2f5c42] bg-[#132019] text-[#7fc79a]"
      : status === "FAILED"
        ? "border-[#5a2b2b] bg-[#1c1212] text-[#e08a8a]"
        : status === "CANCELLED" || status === "CANCEL_REQUESTED"
          ? "border-[#3a3f49] bg-[#16181c] text-[#8b919b]"
          : "border-[#33405a] bg-[#121721] text-[#8fb0e0]";

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] ${tone}`}
    >
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
