"use client";

import { useEffect, useState } from "react";
import { Button } from "../../../../../components/ui/Button";

type RenderJob = {
  id: string;
  status:
    | "QUEUED"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCEL_REQUESTED"
    | "CANCELLED";
  progressPct: number;
  width: number;
  height: number;
  durationMs: number;
  ffmpegVersion: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type RenderArtifact = {
  byteSize: number;
  checksumSha256: string;
  mimeType: string;
  downloadUrl: string;
};

const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING", "CANCEL_REQUESTED"]);

interface Props {
  projectId: string;
  compositionId: string;
}

/**
 * Enqueues a render and follows it to completion.
 *
 * Rendering is asynchronous, so this panel is a small state machine over a job
 * id: enqueue, poll, then either offer the file or explain why it failed. It
 * never assumes success from a 201 — the job is what says so.
 */
export function RenderPanel({ projectId, compositionId }: Props) {
  const [job, setJob] = useState<RenderJob | null>(null);
  const [artifact, setArtifact] = useState<RenderArtifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const base = `/api/projects/${projectId}/visual/compositions/${compositionId}/render`;

  useEffect(() => {
    if (!job || !ACTIVE_STATUSES.has(job.status)) return;

    const interval = setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/projects/${projectId}/renders/${job.id}`,
            { credentials: "include" },
          );
          if (!response.ok) return;
          const payload = (await response.json()) as {
            renderJob: RenderJob;
            artifact: RenderArtifact | null;
          };
          setJob(payload.renderJob);
          setArtifact(payload.artifact);
        } catch {
          // A dropped poll retries on the next interval.
        }
      })();
    }, 1_000);

    return () => clearInterval(interval);
  }, [job, projectId]);

  async function startRender() {
    setBusy(true);
    setError("");
    setArtifact(null);

    try {
      const response = await fetch(base, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? `Render request failed (${response.status})`);
        return;
      }

      const payload = (await response.json()) as { renderJob: RenderJob };
      setJob(payload.renderJob);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function cancelRender() {
    if (!job) return;
    setBusy(true);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/renders/${job.id}/cancel`,
        { method: "POST", credentials: "include" },
      );
      if (response.ok) {
        const payload = (await response.json()) as { renderJob: RenderJob };
        setJob(payload.renderJob);
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  const active = job ? ACTIVE_STATUSES.has(job.status) : false;

  return (
    <div className="rounded-xl border border-[#202329] bg-[#101216] p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-[#62666f]">
          Render
        </p>
        {artifact && (
          <a
            data-testid="render-download"
            href={artifact.downloadUrl}
            className="text-xs text-sky-400 hover:text-sky-300"
          >
            Download MP4
          </a>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={busy || active}
          data-testid="render-video"
          onClick={() => void startRender()}
        >
          {active ? "Rendering…" : "Render video"}
        </Button>

        {active && (
          <Button
            variant="secondary"
            disabled={busy}
            data-testid="render-cancel"
            onClick={() => void cancelRender()}
          >
            Cancel
          </Button>
        )}
      </div>

      {job && (
        <div className="mt-3 space-y-2">
          <p data-testid="render-status" className="text-xs text-[#b4b7bf]">
            {job.status} · {job.progressPct}% · {job.width}×{job.height}
          </p>

          <div className="h-1.5 w-full overflow-hidden rounded bg-[#202329]">
            <div
              data-testid="render-progress"
              data-progress={job.progressPct}
              className="h-full bg-sky-400 transition-all"
              style={{ width: `${job.progressPct}%` }}
            />
          </div>

          {job.status === "FAILED" && job.errorMessage && (
            <p data-testid="render-error" className="text-xs text-red-300">
              {job.errorMessage}
              {job.errorCode ? ` (${job.errorCode})` : ""}
            </p>
          )}

          {artifact && (
            <p className="text-[10px] text-[#62666f]">
              {Math.round(artifact.byteSize / 1024)} KB ·{" "}
              {artifact.checksumSha256.slice(0, 12)}…
            </p>
          )}
        </div>
      )}

      {error && (
        <p data-testid="render-panel-error" className="mt-3 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
