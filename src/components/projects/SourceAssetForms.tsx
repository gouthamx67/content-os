"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileText, FolderOpen, Link2, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "../ui/Button";

export type InputItem = {
  id: string;
  kind: string;
  name: string;
  origin: string;
  uri: string | null;
  status: "queued" | "processing" | "ready" | "failed";
  mimeType: string | null;
  sizeBytes: number | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type InputVersion = {
  contentHash: string;
  sourceIds: string[];
};

export type AssetItem = {
  id: string;
  type: string;
  name: string;
  uri: string;
  createdAt: string;
};

type DraftType = "url" | "repository" | "text" | "upload" | "folder";
type UrlKind = "website" | "web_app" | "figma";
type Provider = "github" | "gitlab";

type InputDraft = {
  id: string;
  type: DraftType;
  value: string;
  name: string;
  provider: Provider;
  urlKind: UrlKind;
  files: File[];
};

type DirectoryInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
};

const inputClassName =
  "w-full rounded-lg border border-[#30343c] bg-[#15171c] px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#62666f] focus:border-white/40";

function emptyDraft(id: string): InputDraft {
  return {
    id,
    type: "url",
    value: "",
    name: "",
    provider: "github",
    urlKind: "website",
    files: [],
  };
}

function relativePath(file: File): string {
  const browserFile: File & { webkitRelativePath?: string } = file;
  return browserFile.webkitRelativePath || file.name;
}

function formatBytes(value: number | null): string {
  if (value === null) return "Size pending";
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function statusClass(status: InputItem["status"]): string {
  if (status === "ready") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  if (status === "failed") return "border-red-500/20 bg-red-500/10 text-red-300";
  if (status === "processing") return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  return "border-sky-500/20 bg-sky-500/10 text-sky-300";
}

export function SourceAssetForms({
  projectId,
  inputs,
  versions,
  assets,
}: {
  projectId: string;
  inputs: InputItem[];
  versions: InputVersion[];
  assets: AssetItem[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<InputDraft[]>([emptyDraft("1")]);
  const [nextDraftId, setNextDraftId] = useState(2);
  const [assetName, setAssetName] = useState("");
  const [assetUri, setAssetUri] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function addDraft() {
    if (drafts.length >= 20) {
      setError("A batch can contain at most 20 inputs");
      return;
    }
    setDrafts((current) => [...current, emptyDraft(String(nextDraftId))]);
    setNextDraftId((current) => current + 1);
    setError(null);
  }

  function updateDraft(id: string, changes: Partial<InputDraft>) {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...changes } : draft)),
    );
  }

  function removeDraft(id: string) {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
  }

  async function addInputs(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const descriptors: Array<Record<string, unknown>> = [];
    const files: File[] = [];

    for (const draft of drafts) {
      const value = draft.value.trim();
      if (draft.type === "url") {
        if (!value) {
          setError("Every URL input needs an address");
          return;
        }
        descriptors.push({ type: "url", kind: draft.urlKind, value });
      } else if (draft.type === "repository") {
        if (!value) {
          setError("Every repository input needs a repository URL");
          return;
        }
        descriptors.push({ type: "repository", provider: draft.provider, value });
      } else if (draft.type === "text") {
        if (!value) {
          setError("Every text input needs content");
          return;
        }
        descriptors.push({
          type: "text",
          value,
          ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
        });
      } else if (draft.type === "upload") {
        const file = draft.files[0];
        if (!file) {
          setError("Every upload input needs a file");
          return;
        }
        descriptors.push({ type: "upload", fileIndex: files.length });
        files.push(file);
      } else {
        if (draft.files.length === 0) {
          setError("Every folder input needs at least one file");
          return;
        }
        const fileIndices = draft.files.map((_file, index) => files.length + index);
        files.push(...draft.files);
        descriptors.push({
          type: "folder",
          name: draft.name.trim() || draft.files[0]?.name || "Folder",
          fileIndices,
          paths: draft.files.map(relativePath),
        });
      }
    }

    setLoading(true);
    try {
      const isMultipart = files.length > 0;
      const body: BodyInit = isMultipart
        ? (() => {
            const form = new FormData();
            form.set("inputs", JSON.stringify(descriptors));
            files.forEach((file) => form.append("files", file));
            return form;
          })()
        : JSON.stringify({ inputs: descriptors });
      const response = await fetch(`/api/projects/${projectId}/inputs`, {
        method: "POST",
        headers: isMultipart ? undefined : { "Content-Type": "application/json" },
        body,
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        inputs?: Array<{ status?: string; name?: string; error?: { code?: string; message?: string } | null }>;
      };
      if (!response.ok) {
        setError(data.message ?? data.error ?? "Unable to add inputs");
        return;
      }
      const failed = data.inputs?.filter((input) => input.status === "failed") ?? [];
      if (failed.length > 0) {
        const first = failed[0];
        setError(
          `${failed.length} input${failed.length === 1 ? "" : "s"} failed: ${first?.name ?? "input"}${
            first?.error?.code ? ` (${first.error.code})` : ""
          }`,
        );
      } else {
        setError(null);
      }
      setDrafts([emptyDraft("1")]);
      setNextDraftId(2);
      router.refresh();
    } catch {
      setError("Unable to add inputs");
    } finally {
      setLoading(false);
    }
  }

  async function removeInput(inputId: string) {
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/inputs/${inputId}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setError(data.message ?? data.error ?? "Unable to remove input");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to remove input");
    }
  }

  async function addAsset(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "IMAGE",
          name: assetName.trim() || "Asset",
          uri: assetUri.trim() || "",
        }),
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setError(data.message ?? data.error ?? "Unable to add asset");
        return;
      }
      setAssetName("");
      setAssetUri("");
      router.refresh();
    } catch {
      setError("Unable to add asset");
    } finally {
      setLoading(false);
    }
  }

  async function removeAsset(assetId: string) {
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/assets/${assetId}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        setError(data.message ?? data.error ?? "Unable to remove asset");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to remove asset");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-[#24272e] bg-[#101216] p-5 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-white">
            <Link2 size={16} />
            Inputs
          </h2>
          <p className="text-xs text-[#777b84]">
            {inputs.length} input{inputs.length === 1 ? "" : "s"} · {versions.length} version
            {versions.length === 1 ? "" : "s"}
          </p>
        </div>

        <ul className="mt-4 grid gap-2 lg:grid-cols-2">
          {inputs.length === 0 ? (
            <li className="text-sm text-[#777b84]">No inputs yet.</li>
          ) : (
            inputs.map((input) => {
              const versionSize = versions.find((version) =>
                version.sourceIds.includes(input.id),
              )?.sourceIds.length;
              return (
                <li
                  key={input.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-[#24272e] bg-[#15171c] px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm text-white">{input.name}</p>
                      <span
                        className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${statusClass(input.status)}`}
                      >
                        {input.status}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-[#777b84]">
                      {input.kind} · {input.origin} · {formatBytes(input.sizeBytes)}
                    </p>
                    {input.uri ? (
                      <p className="mt-0.5 truncate text-xs text-[#62666f]">{input.uri}</p>
                    ) : null}
                    {input.error ? (
                      <p className="mt-1 text-xs text-red-300">
                        {input.error.code}: {input.error.message}
                      </p>
                    ) : null}
                    {input.contentHash ? (
                      <p className="mt-1 truncate font-mono text-[10px] text-[#62666f]">
                        {input.contentHash.slice(0, 12)}
                        {versionSize && versionSize > 1 ? ` · v${versionSize}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeInput(input.id)}
                    className="shrink-0 text-[#62666f] transition-colors hover:text-red-400"
                    aria-label={`Remove ${input.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <form onSubmit={addInputs} className="mt-5 space-y-3 border-t border-[#24272e] pt-5">
          {drafts.map((draft, index) => (
            <div
              key={draft.id}
              className="rounded-xl border border-[#24272e] bg-[#15171c] p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[#777b84]">Input {index + 1}</span>
                  <select
                    value={draft.type}
                    onChange={(event) =>
                      updateDraft(draft.id, {
                        type: event.target.value as DraftType,
                        value: "",
                        files: [],
                      })
                    }
                    className="rounded-md border border-[#30343c] bg-[#101216] px-2 py-1 text-xs text-white outline-none"
                    aria-label={`Input ${index + 1} type`}
                  >
                    <option value="url">Website or web app</option>
                    <option value="repository">GitHub or GitLab repository</option>
                    <option value="text">Pasted text</option>
                    <option value="upload">File upload</option>
                    <option value="folder">Project folder</option>
                  </select>
                </div>
                {drafts.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removeDraft(draft.id)}
                    className="text-[#62666f] hover:text-red-400"
                    aria-label={`Remove input ${index + 1}`}
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </div>

              {draft.type === "url" ? (
                <div className="grid gap-2 sm:grid-cols-[150px_1fr]">
                  <select
                    value={draft.urlKind}
                    onChange={(event) =>
                      updateDraft(draft.id, { urlKind: event.target.value as UrlKind })
                    }
                    className={inputClassName}
                    aria-label={`Input ${index + 1} URL type`}
                  >
                    <option value="website">Website</option>
                    <option value="web_app">Web app</option>
                    <option value="figma">Figma reference</option>
                  </select>
                  <input
                    type="url"
                    value={draft.value}
                    onChange={(event) => updateDraft(draft.id, { value: event.target.value })}
                    className={inputClassName}
                    placeholder="https://example.com"
                    aria-label={`Input ${index + 1} URL`}
                  />
                </div>
              ) : null}

              {draft.type === "repository" ? (
                <div className="grid gap-2 sm:grid-cols-[150px_1fr]">
                  <select
                    value={draft.provider}
                    onChange={(event) =>
                      updateDraft(draft.id, { provider: event.target.value as Provider })
                    }
                    className={inputClassName}
                    aria-label={`Input ${index + 1} repository provider`}
                  >
                    <option value="github">GitHub</option>
                    <option value="gitlab">GitLab</option>
                  </select>
                  <input
                    type="url"
                    value={draft.value}
                    onChange={(event) => updateDraft(draft.id, { value: event.target.value })}
                    className={inputClassName}
                    placeholder="https://github.com/org/repository"
                    aria-label={`Input ${index + 1} repository URL`}
                  />
                </div>
              ) : null}

              {draft.type === "text" ? (
                <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) => updateDraft(draft.id, { name: event.target.value })}
                    className={inputClassName}
                    placeholder="Optional name"
                    aria-label={`Input ${index + 1} text name`}
                  />
                  <textarea
                    value={draft.value}
                    onChange={(event) => updateDraft(draft.id, { value: event.target.value })}
                    className={`${inputClassName} min-h-20 resize-y`}
                    placeholder="Paste a brief, notes, or requirements"
                    aria-label={`Input ${index + 1} text`}
                  />
                </div>
              ) : null}

              {draft.type === "upload" ? (
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#3a3f48] px-3 py-3 text-xs text-[#a0a4ad] hover:border-white/30 hover:text-white">
                  <Upload size={16} />
                  {draft.files[0]?.name ?? "Choose one file"}
                  <input
                    type="file"
                    className="sr-only"
                    onChange={(event) =>
                      updateDraft(draft.id, { files: Array.from(event.target.files ?? []).slice(0, 1) })
                    }
                    aria-label={`Input ${index + 1} file`}
                  />
                </label>
              ) : null}

              {draft.type === "folder" ? (
                <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) => updateDraft(draft.id, { name: event.target.value })}
                    className={inputClassName}
                    placeholder="Folder name"
                    aria-label={`Input ${index + 1} folder name`}
                  />
                  <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#3a3f48] px-3 py-2 text-xs text-[#a0a4ad] hover:border-white/30 hover:text-white">
                    <FolderOpen size={16} />
                    <span className="truncate">
                      {draft.files.length > 0
                        ? `${draft.files.length} file${draft.files.length === 1 ? "" : "s"} selected`
                        : "Choose project folder"}
                    </span>
                    <input
                      type="file"
                      multiple
                      className="sr-only"
                      onChange={(event) =>
                        updateDraft(draft.id, { files: Array.from(event.target.files ?? []) })
                      }
                      aria-label={`Input ${index + 1} folder`}
                      {...({ webkitdirectory: "", directory: "" } as DirectoryInputProps)}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="secondary" onClick={addDraft} disabled={loading}>
              <FileText size={14} />
              Add another
            </Button>
            <Button type="submit" disabled={loading}>
              <Plus size={14} />
              {loading ? "Processing…" : "Add input batch"}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-[#24272e] bg-[#101216] p-5 lg:col-span-2">
        <h2 className="text-sm font-medium text-white">Assets</h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {assets.length === 0 ? (
            <li className="text-sm text-[#777b84]">No assets yet.</li>
          ) : (
            assets.map((asset) => (
              <li
                key={asset.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[#24272e] bg-[#15171c] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{asset.name}</p>
                  <p className="truncate text-xs text-[#777b84]">
                    {asset.type} · {asset.uri}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeAsset(asset.id)}
                  className="shrink-0 text-[#62666f] transition-colors hover:text-red-400"
                  aria-label={`Remove ${asset.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))
          )}
        </ul>
        <form onSubmit={addAsset} className="mt-4 space-y-2">
          <input
            type="text"
            value={assetName}
            onChange={(event) => setAssetName(event.target.value)}
            className={inputClassName}
            placeholder="Asset name"
          />
          <div className="flex gap-2">
            <input
              type="url"
              value={assetUri}
              onChange={(event) => setAssetUri(event.target.value)}
              className={inputClassName}
              placeholder="https://…/image.png"
            />
            <Button type="submit" disabled={loading}>
              <Plus size={14} />
              Add
            </Button>
          </div>
        </form>
      </section>

      {error ? <p className="text-sm text-red-400 lg:col-span-2">{error}</p> : null}
    </div>
  );
}
