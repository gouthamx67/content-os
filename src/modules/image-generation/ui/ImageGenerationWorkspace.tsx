"use client";

import { useCallback, useEffect, useState } from "react";
import { Image as ImageIcon, Sparkles } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import type { GraphicTemplateType, ImageOutputFormat } from "../domain/types";
import { GeneratedImageLibrary } from "./GeneratedImageLibrary";
import { ImageResult } from "./ImageResult";
import { TemplatePicker } from "./TemplatePicker";
import type {
  GeneratedAssetView,
  GraphicDocumentView,
  ImageJobView,
} from "./types";

const POLL_INTERVAL_MS = 750;
const POLL_ATTEMPTS = 80;

type Props = {
  projectId: string;
};

/**
 * The CP17 workspace.
 *
 * Enqueueing never shows an image; a job is queued, the worker renders it, and
 * this component polls the job until bytes exist. That is deliberate: a spinner
 * that resolves to a placeholder would make an unrendered graphic look finished.
 */
export function ImageGenerationWorkspace({ projectId }: Props) {
  const [templateType, setTemplateType] =
    useState<GraphicTemplateType>("PRODUCT_HERO");
  const [prompt, setPrompt] = useState("");
  const [outputFormat, setOutputFormat] = useState<ImageOutputFormat>("PNG");
  const [transparent, setTransparent] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [jobs, setJobs] = useState<ImageJobView[]>([]);
  const [assets, setAssets] = useState<GeneratedAssetView[]>([]);
  const [documents, setDocuments] = useState<GraphicDocumentView[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  const selectedAsset =
    assets.find((asset) => asset.id === selectedAssetId) ?? null;

  const refresh = useCallback(async () => {
    const [jobsResponse, assetsResponse, documentsResponse] = await Promise.all([
      fetch(`/api/projects/${projectId}/images/generations`, {
        credentials: "include",
      }),
      fetch(`/api/projects/${projectId}/images/assets`, {
        credentials: "include",
      }),
      fetch(`/api/projects/${projectId}/graphics`, { credentials: "include" }),
    ]);

    if (jobsResponse.ok) {
      const payload = (await jobsResponse.json()) as {
        imageGenerationJobs: ImageJobView[];
      };
      setJobs(payload.imageGenerationJobs);
    }

    if (assetsResponse.ok) {
      const payload = (await assetsResponse.json()) as {
        assets: GeneratedAssetView[];
      };
      setAssets(payload.assets);
    }

    if (documentsResponse.ok) {
      const payload = (await documentsResponse.json()) as {
        graphicDocuments: GraphicDocumentView[];
      };
      setDocuments(payload.graphicDocuments);
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await refresh();
      } catch {
        if (!cancelled) setError("Failed to load image data");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function pollJob(jobId: string): Promise<ImageJobView | null> {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const response = await fetch(
        `/api/projects/${projectId}/images/generations/${jobId}`,
        { credentials: "include" },
      );
      if (!response.ok) return null;

      const payload = (await response.json()) as {
        imageGenerationJob: ImageJobView;
      };
      const status = payload.imageGenerationJob.status;

      if (
        status === "SUCCEEDED" ||
        status === "FAILED" ||
        status === "CANCELLED"
      ) {
        return payload.imageGenerationJob;
      }
    }

    return null;
  }

  async function waitFor(jobIds: string[]): Promise<void> {
    const finals = await Promise.all(jobIds.map((id) => pollJob(id)));
    await refresh();

    const failed = finals.find((job) => job?.status === "FAILED");
    if (failed) {
      setError(failed.errorMessage ?? "Image generation failed");
      return;
    }

    const created = finals.find((job) => job?.status === "SUCCEEDED");
    if (created) {
      setNotice("Image generated");
      return;
    }

    setNotice("Generation queued; the worker will finish it shortly");
  }

  async function requestJson(
    path: string,
    body: unknown,
  ): Promise<{ ok: boolean; payload: Record<string, unknown> }> {
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return { ok: response.ok, payload };
  }

  async function generate() {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const { ok, payload } = await requestJson(
        `/api/projects/${projectId}/images/generate`,
        {
          templateType,
          prompt,
          outputFormat,
          transparent,
        },
      );

      if (!ok) {
        setError(
          typeof payload["error"] === "string"
            ? payload["error"]
            : "Generation request failed",
        );
        return;
      }

      const job = payload["imageGenerationJob"] as ImageJobView | undefined;
      if (job) await waitFor([job.id]);
      else await refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function generateVariants() {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const { ok, payload } = await requestJson(
        `/api/projects/${projectId}/images/generate-variants`,
        { templateType, prompt },
      );

      if (!ok) {
        setError(
          typeof payload["error"] === "string"
            ? payload["error"]
            : "Variant request failed",
        );
        return;
      }

      const created = (payload["imageGenerationJobs"] as ImageJobView[]) ?? [];
      await waitFor(created.map((job) => job.id));
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function saveDocument() {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const { ok, payload } = await requestJson(
        `/api/projects/${projectId}/graphics`,
        {
          name: prompt.trim().slice(0, 60) || "Untitled graphic",
          templateType,
          prompt,
          outputFormat,
          transparent,
        },
      );

      if (!ok) {
        setError(
          typeof payload["error"] === "string"
            ? payload["error"]
            : "Could not save design",
        );
        return;
      }

      setNotice("Design saved");
      await refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="image-generation-workspace"
      className="rounded-xl border border-[#202329] bg-[#101216] p-5"
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
        <ImageIcon size={14} />
        Image generation
      </div>

      <h2 className="mt-2 text-lg font-semibold text-white">
        Generate a graphic
      </h2>
      <p className="mt-1 text-xs text-[#777b84]">
        The worker rasterises the design to a real PNG or JPEG and stores it with
        a checksum.
      </p>

      <div className="mt-4">
        <TemplatePicker
          value={templateType}
          onChange={setTemplateType}
          disabled={busy}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px_140px]">
        <textarea
          data-testid="image-prompt-input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="What should this graphic say?"
          rows={2}
          className="w-full resize-none rounded-md border border-[#30343c] bg-[#15171c] px-3 py-2 text-sm text-white"
        />

        <select
          data-testid="image-format-select"
          value={outputFormat}
          onChange={(event) =>
            setOutputFormat(event.target.value as ImageOutputFormat)
          }
          className="w-full rounded-md border border-[#30343c] bg-[#15171c] px-3 py-2 text-sm text-white"
        >
          <option value="PNG">PNG</option>
          <option value="JPEG">JPEG</option>
        </select>

        <label className="flex items-center gap-2 rounded-md border border-[#30343c] bg-[#15171c] px-3 py-2 text-sm text-white">
          <input
            data-testid="image-transparent-toggle"
            type="checkbox"
            checked={transparent}
            disabled={outputFormat === "JPEG"}
            onChange={(event) => setTransparent(event.target.checked)}
          />
          Transparent
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          data-testid="generate-image-button"
          disabled={busy || prompt.trim().length === 0}
          onClick={() => void generate()}
        >
          Generate image
        </Button>
        <Button
          variant="secondary"
          data-testid="generate-variants-button"
          disabled={busy || prompt.trim().length === 0}
          onClick={() => void generateVariants()}
        >
          Generate variants
        </Button>
        <Button
          variant="ghost"
          data-testid="save-graphic-button"
          disabled={busy || prompt.trim().length === 0}
          onClick={() => void saveDocument()}
        >
          Save design
        </Button>
      </div>

      {(error || notice) && (
        <p
          data-testid="image-status"
          className={[
            "mt-4 rounded-md border px-3 py-2 text-xs",
            error
              ? "border-red-500/40 bg-red-500/10 text-red-300"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
          ].join(" ")}
        >
          {error || notice}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {selectedAsset ? (
            <ImageResult asset={selectedAsset} />
          ) : (
            <p className="rounded-xl border border-dashed border-[#202329] p-6 text-center text-xs text-[#62666f]">
              No image selected yet.
            </p>
          )}

          {selectedAsset && (
            <label className="block text-xs text-[#777b84]">
              Media reference
              <input
                data-testid="generated-asset-ref"
                readOnly
                value={`generated:${selectedAsset.id}`}
                className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-3 py-2 text-xs text-white"
              />
            </label>
          )}

          <div className="rounded-xl border border-[#202329] bg-[#101216] p-4">
            <p className="text-xs uppercase tracking-wide text-[#62666f]">
              Jobs
            </p>
            {jobs.length === 0 ? (
              <p className="mt-2 text-xs text-[#62666f]">No jobs yet.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {jobs.map((job) => (
                  <li
                    key={job.id}
                    data-testid="image-job"
                    data-job-id={job.id}
                    data-status={job.status}
                    className="flex items-center justify-between rounded-md border border-[#202329] bg-[#0b0c0f] px-2 py-1.5 text-xs text-[#b4b7bf]"
                  >
                    <span className="truncate">
                      {job.provider} · {job.width}×{job.height}{" "}
                      {job.outputFormat}
                    </span>
                    <span className="flex items-center gap-2 text-[10px]">
                      <Sparkles size={12} />
                      {job.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <GeneratedImageLibrary
            assets={assets}
            selectedId={selectedAssetId}
            onSelect={(asset) => setSelectedAssetId(asset.id)}
          />

          <div className="rounded-xl border border-[#202329] bg-[#101216] p-4">
            <p className="text-xs uppercase tracking-wide text-[#62666f]">
              Saved designs
            </p>
            {documents.length === 0 ? (
              <p className="mt-2 text-xs text-[#62666f]">No saved designs.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {documents.map((document) => (
                  <li
                    key={document.id}
                    data-testid="graphic-document"
                    data-document-id={document.id}
                    className="truncate rounded-md border border-[#202329] bg-[#0b0c0f] px-2 py-1.5 text-xs text-[#b4b7bf]"
                  >
                    {document.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
