"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "../ui/Button";

export function ProjectActions({
  projectId,
  name,
  archived,
}: {
  projectId: string;
  name: string;
  archived: boolean;
}) {
  const router = useRouter();

  const [editing, setEditing] = useState(false);

  const [renameValue, setRenameValue] = useState(name);

  const [error, setError] = useState<string | null>(null);

  const [action, setAction] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  const [job, setJob] = useState<{
    id: string;
    status: string;
  } | null>(null);

  async function rename() {
    if (!renameValue.trim() || renameValue.trim() === name) {
      setEditing(false);

      return;
    }

    setError(null);

    setLoading(true);

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameValue.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Unable to rename project");

        return;
      }

      setEditing(false);

      router.refresh();
    } catch {
      setError("Unable to rename project");
    } finally {
      setLoading(false);
    }
  }

  async function toggleArchive() {
    setError(null);

    setAction(archived ? "restoring" : "archiving");

    setLoading(true);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/${
          archived ? "restore" : "archive"
        }`,
        { method: "POST" },
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Unable to update project");
      }

      router.refresh();
    } catch {
      setError("Unable to update project");
    } finally {
      setAction(null);

      setLoading(false);
    }
  }

  async function generate() {
    setError(null);

    setAction("generating");

    setLoading(true);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Generation failed");

        return;
      }

      setJob({ id: data.job.id, status: data.job.status });
    } catch {
      setError("Generation failed");
    } finally {
      setAction(null);

      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={renameValue}
              onChange={(event) =>
                setRenameValue(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  rename();
                }

                if (event.key === "Escape") {
                  setRenameValue(name);

                  setEditing(false);
                }
              }}
              autoFocus
              className="w-64 rounded-lg border border-[#30343c] bg-[#15171c] px-3 py-2 text-sm text-white outline-none focus:border-white/40"
            />

            <Button
              type="button"
              onClick={rename}
              disabled={loading}
            >
              <Check size={14} />
              Save
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            onClick={() => setEditing(true)}
            variant="secondary"
          >
            <Pencil size={14} />
            Rename
          </Button>
        )}

        <Button
          type="button"
          onClick={toggleArchive}
          disabled={loading}
          variant="secondary"
        >
          {archived ? (
            <>
              <RotateCcw size={14} />
              Restore
            </>
          ) : (
            <>
              <Archive size={14} />
              Archive
            </>
          )}
        </Button>

        <Button
          type="button"
          onClick={generate}
          disabled={loading}
        >
          <Sparkles size={14} />
          {action === "generating" ? "Generating…" : "Generate content"}
        </Button>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {job ? (
        <p className="text-sm text-[#b4b7bf]">
          Generation job <span className="text-white">{job.id}</span>{" "}
          is <span className="text-white">{job.status}</span>.
        </p>
      ) : null}

      {action && action !== "generating" ? (
        <p className="text-sm text-[#b4b7bf]">{action}…</p>
      ) : null}
    </div>
  );
}