"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { EditorImportForm } from "./EditorImportForm";
import type { EditorDocumentSummary } from "../../../../modules/editor-engine/editor-service";

interface Props {
  projectId: string;
  initialDocuments: EditorDocumentSummary[];
}

export function EditorList({ projectId, initialDocuments }: Props) {
  const router = useRouter();
  const [documents] = useState(initialDocuments);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}/editor`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim().length > 0 ? name : undefined,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? "Could not create edit");
        return;
      }

      const payload = (await response.json()) as {
        document: { id: string; name: string };
      };
      router.push(`/projects/${projectId}/editor/${payload.document.id}`);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        {documents.length === 0 ? (
          <p
            className="rounded-xl border border-dashed border-[#30343c] p-6 text-sm text-[#777b84]"
            data-testid="editor-empty"
          >
            No edits yet. Create one to open the editor.
          </p>
        ) : (
          <ul className="space-y-2">
            {documents.map((document) => (
              <li key={document.id}>
                <Link
                  href={`/projects/${projectId}/editor/${document.id}`}
                  data-testid="editor-document"
                  data-editor-id={document.id}
                  className="flex items-center justify-between rounded-xl border border-[#202329] bg-[#101216] px-4 py-3 hover:border-[#30343c]"
                >
                  <span>
                    <span className="block text-sm text-white">
                      {document.name}
                    </span>
                    <span className="text-xs text-[#62666f]">
                      {document.status} · {document.revisionCount} revision
                      {document.revisionCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="text-xs text-[#62666f]">
                    {document.nodeCount} node{document.nodeCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        onSubmit={create}
        className="h-fit rounded-xl border border-[#202329] bg-[#101216] p-4"
      >
        <p className="text-xs uppercase tracking-wide text-[#62666f]">
          New edit
        </p>

        <label className="mt-3 block text-[10px] text-[#777b84]">
          Name
          <input
            data-testid="editor-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Untitled edit"
            className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          />
        </label>

        {error && (
          <p className="mt-3 text-xs text-red-300" data-testid="editor-create-error">
            {error}
          </p>
        )}

        <Button
          className="mt-4 w-full"
          disabled={busy}
          data-testid="create-editor-document"
        >
          Create edit
        </Button>
      </form>

      <EditorImportForm projectId={projectId} />
    </div>
  );
}