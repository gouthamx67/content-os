"use client";

import { useState } from "react";
import { Button } from "../../../../../components/ui/Button";

type LocalizedArtifactPanelProps = {
  projectId: string;
  jobId: string;
  applied: boolean;
};

export function LocalizedArtifactPanel({
  projectId,
  jobId,
  applied,
}: LocalizedArtifactPanelProps) {
  const [artifact, setArtifact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const base = `/api/projects/${projectId}/localization/${jobId}`;

  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${base}/export`, { credentials: "include" });
      const payload = (await response.json().catch(() => null)) as
        | { artifact?: unknown; error?: string }
        | null;
      if (!response.ok) {
        setError(payload?.error ?? `Request failed (${response.status})`);
        return;
      }
      setArtifact(JSON.stringify(payload?.artifact ?? payload, null, 2));
    } catch {
      setError("Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-[#202329] bg-[#101216] p-4">
      <p className="text-xs uppercase tracking-wide text-[#62666f]">
        Localized artifact
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="secondary"
          onClick={load}
          disabled={busy || !applied}
          data-testid="preview-artifact"
        >
          Preview
        </Button>
        <a
          href={`${base}/export`}
          data-testid="download-artifact"
          className={`inline-flex min-h-10 items-center justify-center rounded-lg border border-[#30343c] px-4 text-sm font-medium text-white hover:bg-[#1b1e24] ${
            applied ? "" : "pointer-events-none opacity-40"
          }`}
        >
          Download
        </a>
      </div>

      {!applied && (
        <p className="mt-2 text-[10px] text-[#62666f]">
          Apply the approved revision to export.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-300" data-testid="artifact-error">
          {error}
        </p>
      )}
      {artifact && (
        <pre
          data-testid="artifact-json"
          className="mt-3 max-h-64 overflow-auto rounded-md border border-[#30343c] bg-[#0b0c0f] p-2 text-[10px] text-[#b4b7bf]"
        >
          {artifact}
        </pre>
      )}
    </section>
  );
}
