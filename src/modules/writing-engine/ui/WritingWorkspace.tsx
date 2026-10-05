"use client";

import { useCallback, useEffect, useState } from "react";
import { PenLine, RefreshCw, Wand2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { ClaimSources } from "./ClaimSources";
import type {
  WritingDocumentDetail,
  WritingDocumentView,
  WritingJobView,
} from "./types";

const POLL_INTERVAL_MS = 750;
const POLL_ATTEMPTS = 80;

const BLOCK_TYPES = [
  "HEADLINE",
  "HOOK",
  "SUBHEAD",
  "BODY",
  "CAPTION",
  "CTA",
  "AD_COPY",
  "PRODUCT_DESCRIPTION",
  "SCRIPT",
  "VOICEOVER",
] as const;

const TONES = [
  "BRAND",
  "PROFESSIONAL",
  "FRIENDLY",
  "PLAYFUL",
  "BOLD",
  "MINIMAL",
  "TECHNICAL",
  "CONVERSATIONAL",
] as const;

const LENGTHS = ["SHORT", "MEDIUM", "LONG"] as const;

const OBJECTIVES = [
  "AWARENESS",
  "EDUCATION",
  "CONSIDERATION",
  "CONVERSION",
  "RETENTION",
  "PRODUCT_EXPLANATION",
] as const;

const INSTRUCTIONS = [
  "SHORTEN",
  "SIMPLIFY",
  "MAKE_MORE_DIRECT",
  "MAKE_MORE_CONVERSATIONAL",
  "REMOVE_HYPE",
] as const;

type Props = {
  projectId: string;
};

/**
 * The CP18 workspace.
 *
 * Enqueueing never shows copy: a job is queued, the worker generates and
 * grounds it, and this component polls until the job reaches a terminal state.
 * That is deliberate — a placeholder headline would make an ungrounded
 * generation look finished.
 */
export function WritingWorkspace({ projectId }: Props) {
  const [blockType, setBlockType] = useState<(typeof BLOCK_TYPES)[number]>("HEADLINE");
  const [tone, setTone] = useState<(typeof TONES)[number]>("BRAND");
  const [length, setLength] = useState<(typeof LENGTHS)[number]>("MEDIUM");
  const [objective, setObjective] =
    useState<(typeof OBJECTIVES)[number]>("AWARENESS");
  const [prompt, setPrompt] = useState("");
  const [variantCount, setVariantCount] = useState(3);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<WritingJobView[]>([]);
  const [documents, setDocuments] = useState<WritingDocumentView[]>([]);
  const [detail, setDetail] = useState<WritingDocumentDetail | null>(null);

  const refresh = useCallback(async () => {
    const [jobsResponse, documentsResponse] = await Promise.all([
      fetch(`/api/projects/${projectId}/writing/generations`, {
        credentials: "include",
      }),
      fetch(`/api/projects/${projectId}/writing/documents`, {
        credentials: "include",
      }),
    ]);

    if (jobsResponse.ok) {
      const payload = (await jobsResponse.json()) as {
        writingGenerationJobs: WritingJobView[];
      };
      setJobs(payload.writingGenerationJobs);
    }
    if (documentsResponse.ok) {
      const payload = (await documentsResponse.json()) as {
        writingDocuments: WritingDocumentView[];
      };
      setDocuments(payload.writingDocuments);
    }
  }, [projectId]);

  const loadDocument = useCallback(
    async (documentId: string) => {
      const response = await fetch(
        `/api/projects/${projectId}/writing/documents/${documentId}`,
        { credentials: "include" },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as WritingDocumentDetail;
      setDetail(payload);
    },
    [projectId],
  );

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch {
        setError("Failed to load writing data");
      }
    })();
  }, [refresh]);

  async function pollJob(jobId: string): Promise<WritingJobView | null> {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const response = await fetch(
        `/api/projects/${projectId}/writing/generations/${jobId}`,
        { credentials: "include" },
      );
      if (!response.ok) return null;

      const payload = (await response.json()) as {
        writingGenerationJob: WritingJobView;
      };
      const status = payload.writingGenerationJob.status;

      if (
        status === "SUCCEEDED" ||
        status === "FAILED" ||
        status === "CANCELLED"
      ) {
        return payload.writingGenerationJob;
      }
    }
    return null;
  }

  async function generate() {
    setBusy(true);
    setError("");
    setDetail(null);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/writing/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            blockType,
            tone,
            length,
            objective,
            prompt,
            variantCount,
          }),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Generation could not be queued");
      }

      const payload = (await response.json()) as {
        writingGenerationJob: WritingJobView;
      };
      const finished = await pollJob(payload.writingGenerationJob.id);

      if (!finished || finished.status !== "SUCCEEDED") {
        throw new Error(
          finished?.errorMessage ?? "Generation did not produce grounded copy",
        );
      }

      await refresh();
      if (finished.documentId) await loadDocument(finished.documentId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function rewrite(instruction: string) {
    if (!detail) return;
    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/writing/documents/${detail.document.id}/rewrite`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ instruction }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Rewrite failed");
      }
      await loadDocument(detail.document.id);
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Rewrite failed");
    } finally {
      setBusy(false);
    }
  }

  async function generateVariants() {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/projects/${projectId}/writing/documents/${detail.document.id}/variants`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ variantCount }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Variant generation failed");
      }
      await loadDocument(detail.document.id);
      await refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Variant generation failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function selectVariant(variantId: string) {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/projects/${projectId}/writing/documents/${detail.document.id}/select-variant`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ variantId }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Could not select variant");
      }
      await loadDocument(detail.document.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Selection failed");
    } finally {
      setBusy(false);
    }
  }

  const selectedVariant =
    detail?.variants.find(
      (variant) => variant.id === detail.document.selectedVariantId,
    ) ?? null;
  const selectedClaims =
    detail?.claims.filter(
      (claim) =>
        selectedVariant && claim.variantId === selectedVariant.id,
    ) ?? [];

  return (
    <section
      data-testid="writing-workspace"
      className="rounded-xl border border-neutral-200 bg-white p-6"
    >
      <header className="flex items-center gap-2">
        <PenLine className="h-5 w-5 text-neutral-700" aria-hidden />
        <h2 className="text-lg font-semibold text-neutral-900">Writing</h2>
      </header>
      <p className="mt-1 text-sm text-neutral-500">
        Grounded copy built only from the project&apos;s recorded facts.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="text-sm">
          <span className="block text-neutral-600">Block</span>
          <select
            data-testid="writing-block-type"
            className="mt-1 w-full rounded border border-neutral-300 p-2"
            value={blockType}
            onChange={(event) =>
              setBlockType(event.target.value as (typeof BLOCK_TYPES)[number])
            }
          >
            {BLOCK_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-neutral-600">Tone</span>
          <select
            data-testid="writing-tone"
            className="mt-1 w-full rounded border border-neutral-300 p-2"
            value={tone}
            onChange={(event) =>
              setTone(event.target.value as (typeof TONES)[number])
            }
          >
            {TONES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-neutral-600">Length</span>
          <select
            data-testid="writing-length"
            className="mt-1 w-full rounded border border-neutral-300 p-2"
            value={length}
            onChange={(event) =>
              setLength(event.target.value as (typeof LENGTHS)[number])
            }
          >
            {LENGTHS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-neutral-600">Objective</span>
          <select
            data-testid="writing-objective"
            className="mt-1 w-full rounded border border-neutral-300 p-2"
            value={objective}
            onChange={(event) =>
              setObjective(event.target.value as (typeof OBJECTIVES)[number])
            }
          >
            {OBJECTIVES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex gap-3">
        <input
          data-testid="writing-prompt"
          className="flex-1 rounded border border-neutral-300 p-2 text-sm"
          placeholder="What should this copy be about?"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <label className="text-sm">
          <span className="sr-only">Variants</span>
          <input
            data-testid="writing-variant-count"
            type="number"
            min={1}
            max={5}
            className="w-20 rounded border border-neutral-300 p-2 text-sm"
            value={variantCount}
            onChange={(event) => setVariantCount(Number(event.target.value))}
          />
        </label>
        <Button
          data-testid="writing-generate"
          disabled={busy}
          onClick={() => void generate()}
        >
          {busy ? "Working..." : "Generate"}
        </Button>
      </div>

      {error ? (
        <p data-testid="writing-error" className="mt-3 text-sm text-rose-600">
          {error}
        </p>
      ) : null}

      {jobs.length > 0 ? (
        <ul className="mt-4 space-y-1" data-testid="writing-jobs">
          {jobs.slice(0, 5).map((job) => (
            <li
              key={job.id}
              data-testid="writing-job"
              data-status={job.status}
              className="flex items-center justify-between rounded border border-neutral-200 px-3 py-2 text-sm"
            >
              <span className="font-mono text-xs text-neutral-500">{job.id}</span>
              <span className="text-neutral-700">
                {job.blockType} · {job.status}
                {job.errorMessage ? ` · ${job.errorMessage}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {detail ? (
        <div className="mt-6" data-testid="writing-document">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-neutral-900">
              {detail.document.title}
            </h3>
            <span
              data-testid="writing-document-context-sha"
              className="font-mono text-xs text-neutral-400"
            >
              {detail.document.contextSha256.slice(0, 12)}
            </span>
          </div>

          <p
            data-testid="writing-document-content"
            className="mt-2 whitespace-pre-wrap rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-800"
          >
            {detail.document.content}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {INSTRUCTIONS.map((instruction) => (
              <Button
                key={instruction}
                data-testid={`writing-rewrite-${instruction}`}
                variant="secondary"
                disabled={busy}
                onClick={() => void rewrite(instruction)}
              >
                {instruction.replace(/_/g, " ").toLowerCase()}
              </Button>
            ))}
            <Button
              data-testid="writing-generate-variants"
              variant="secondary"
              disabled={busy}
              onClick={() => void generateVariants()}
            >
              <Wand2 className="h-4 w-4" aria-hidden /> More variants
            </Button>
          </div>

          <ul className="mt-4 space-y-2" data-testid="writing-variants">
            {detail.variants.map((variant) => (
              <li
                key={variant.id}
                data-testid="writing-variant"
                data-variant-id={variant.id}
                data-selected={variant.selected ? "true" : "false"}
                className={`rounded-lg border p-3 text-sm ${
                  variant.selected
                    ? "border-neutral-900 bg-neutral-50"
                    : "border-neutral-200"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-neutral-500">
                    {variant.label}
                    {variant.instruction ? ` · ${variant.instruction}` : ""}
                  </span>
                  {!variant.selected ? (
                    <button
                      type="button"
                      data-testid={`writing-select-${variant.id}`}
                      className="text-xs text-neutral-600 underline"
                      disabled={busy}
                      onClick={() => void selectVariant(variant.id)}
                    >
                      Select
                    </button>
                  ) : (
                    <span className="text-xs text-neutral-500">Selected</span>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-neutral-800">
                  {variant.text}
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-4">
            <h4 className="text-sm font-medium text-neutral-700">Claims</h4>
            {selectedClaims.length === 0 ? (
              <p className="mt-1 text-xs text-neutral-500">
                No claims detected in the selected variant.
              </p>
            ) : (
              <ul className="mt-2 space-y-2" data-testid="writing-claims">
                {selectedClaims.map((claim) => (
                  <ClaimSources key={claim.id} claim={claim} />
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {documents.length > 0 ? (
        <div className="mt-6">
          <h4 className="flex items-center gap-2 text-sm font-medium text-neutral-700">
            <RefreshCw className="h-4 w-4" aria-hidden /> Documents
          </h4>
          <ul className="mt-2 space-y-1" data-testid="writing-documents">
            {documents.slice(0, 8).map((document) => (
              <li key={document.id}>
                <button
                  type="button"
                  data-testid={`writing-document-${document.id}`}
                  className="w-full rounded border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50"
                  onClick={() => void loadDocument(document.id)}
                >
                  {document.title} · {document.blockType}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
