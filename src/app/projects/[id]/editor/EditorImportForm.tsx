"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../../components/ui/Button";

interface Props {
  projectId: string;
}

const IMPORT_KINDS = [
  {
    value: "COMPOSITION",
    label: "Visual composition",
    sourceLabel: "Visual composition id",
  },
  {
    value: "MULTIMODAL",
    label: "Multimodal composition",
    sourceLabel: "Visual composition id",
  },
  {
    value: "AUDIO_COMPOSITION",
    label: "Audio composition",
    sourceLabel: "Audio composition id",
  },
  {
    value: "GENERATED_IMAGE",
    label: "Generated image",
    sourceLabel: "Generated asset id",
  },
  {
    value: "WRITING_VARIANT",
    label: "Writing variant",
    sourceLabel: "Writing document id",
  },
  {
    value: "ADAPTATION",
    label: "Adaptation",
    sourceLabel: "Adaptation job id",
  },
] as const;

export function EditorImportForm({ projectId }: Props) {
  const router = useRouter();
  const [kind, setKind] = useState<string>("COMPOSITION");
  const [sourceId, setSourceId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isWritingVariant = kind === "WRITING_VARIANT";
  const sourceLabel =
    IMPORT_KINDS.find((entry) => entry.value === kind)?.sourceLabel ??
    "Source id";

  async function Import(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const value = name.trim().length > 0 ? name.trim() : undefined;

    try {
      const payload = isWritingVariant
        ? { kind, documentId: sourceId, variantId, name: value }
        : { kind, sourceId, name: value };

      const response = await fetch(
        `/api/projects/${projectId}/editor/imports`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? "Could not import");
        return;
      }

      const created = (await response.json()) as {
        document: { id: string; name: string };
      };
      router.push(
        `/projects/${projectId}/editor/${created.document.id}`,
      );
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={Import}
      className="mt-4 rounded-xl border border-[#202329] bg-[#101216] p-4"
      data-testid="editor-import-form"
    >
      <p className="text-xs uppercase tracking-wide text-[#62666f]">
        Import from a checkpoint
      </p>

      <label className="mt-3 block text-[10px] text-[#777b84]">
        Source
        <select
          data-testid="editor-import-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
        >
          {IMPORT_KINDS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 block text-[10px] text-[#777b84]">
        {sourceLabel}
        <input
          data-testid="editor-import-source"
          value={sourceId}
          onChange={(event) => setSourceId(event.target.value)}
          className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
        />
      </label>

      {isWritingVariant && (
        <label className="mt-3 block text-[10px] text-[#777b84]">
          Variant id
          <input
            data-testid="editor-import-variant"
            value={variantId}
            onChange={(event) => setVariantId(event.target.value)}
            className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          />
        </label>
      )}

      <label className="mt-3 block text-[10px] text-[#777b84]">
        Name
        <input
          data-testid="editor-import-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Optional"
          className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
        />
      </label>

      {error && (
        <p className="mt-3 text-xs text-red-300" data-testid="editor-import-error">
          {error}
        </p>
      )}

      <Button
        className="mt-4 w-full"
        disabled={busy}
        data-testid="editor-import-submit"
      >
        Import
      </Button>
    </form>
  );
}