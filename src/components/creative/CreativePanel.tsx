"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, RefreshCw, Sparkles, X } from "lucide-react";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import type {
  SerializedCreativeDirection,
} from "../../lib/creative-direction-api";
import type { CreativeMode } from "../../core/domain/creative-direction";

type Registry = ReturnType<typeof import("../../lib/creative-direction-api").creativeRegistry> | null;

type Run = {
  creativeRunId: string;
  mode: CreativeMode;
  provider: string;
  model: string | null;
  fallbackFrom: string | null;
  fallbackReason: string | null;
};

type DirectionEdit = {
  name?: string;
  thesis?: string;
  hook?: SerializedCreativeDirection["hook"];
};

const MODE_LABELS: Readonly<Record<string, string>> = {
  GUIDED: "Guided",
  BALANCED: "Balanced",
  WILD: "Wild",
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  DRAFT: "Draft",
  SELECTED: "Chosen",
  REJECTED: "Passed over",
  ARCHIVED: "Archived",
};

const ANGLE_LABELS: Readonly<Record<string, string>> = {
  PROBLEM_SOLUTION: "Problem and solution",
  PRODUCT_FIRST: "Product first",
  WORKFLOW: "How it works",
  TRANSFORMATION: "Before and after",
  FOUNDER: "Founder-led",
  TECHNICAL: "Technical",
  SOCIAL: "Social proof",
  EMOTIONAL: "Emotional",
  EDUCATIONAL: "Educational",
  BEFORE_AFTER: "Transformation",
  DEMO: "Product demo",
  CUSTOM: "Custom",
};

function statusColor(status: string): string {
  if (status === "SELECTED") return "text-[#7ee2a8]";
  if (status === "REJECTED") return "text-[#5c6069]";
  return "text-[#8b8f98]";
}

export type CreativePanelProps = {
  projectId: string;
  /** Only a resolved request can be directed; the panel stays closed without one. */
  intent: { id: string; contentTypeName: string; status: string } | null;
  initialDirections?: SerializedCreativeDirection[];
  initialRegistry?: Registry;
};

export function CreativePanel({
  projectId,
  intent,
  initialDirections = [],
  initialRegistry = null,
}: CreativePanelProps) {
  const router = useRouter();
  const [directions, setDirections] = useState<SerializedCreativeDirection[]>(initialDirections);
  const [registry, setRegistry] = useState<Registry>(initialRegistry);
  const [run, setRun] = useState<Run | null>(null);
  const [mode, setMode] = useState<CreativeMode>("BALANCED");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DirectionEdit>({});

  async function call(
    label: string,
    url: string,
    init: RequestInit,
    onSuccess: (data: Record<string, unknown>) => void,
  ) {
    setError(null);
    setBusy(label);
    try {
      const response = await fetch(url, init);
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        const issues = Array.isArray(data.issues)
          ? (data.issues as { message?: string }[]).map((issue) => issue.message ?? "").filter(Boolean).join(", ")
          : "";
        setError(
          issues
            ? `${String(data.error ?? "Request failed")} (${issues})`
            : String(data.error ?? "Request failed"),
        );
        return null;
      }
      onSuccess(data);
      router.refresh();
      return data;
    } catch {
      setError("Request failed");
      return null;
    } finally {
      setBusy(null);
    }
  }

  function generate() {
    if (!intent) return null;
    return call(
      "generate",
      `/api/projects/${projectId}/creative-directions/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId: intent.id, mode }),
      },
      (data) => {
        if (data.registry) setRegistry(data.registry as Registry);
        setDirections(data.directions as SerializedCreativeDirection[]);
        setRun(data.run as Run);
      },
    );
  }

  function choose(directionId: string) {
    return call(
      `select:${directionId}`,
      `/api/projects/${projectId}/creative-directions/${directionId}/select`,
      { method: "POST" },
      (data) => {
        const selected = data.direction as SerializedCreativeDirection;
        setDirections((current) =>
          current.map((direction) =>
            direction.id === selected.id
              ? { ...direction, status: "SELECTED", updatedAt: selected.updatedAt }
              : direction.status === "SELECTED"
                ? { ...direction, status: "DRAFT" }
                : direction,
          ),
        );
      },
    );
  }

  function startEdit(direction: SerializedCreativeDirection) {
    setEditingId(direction.id);
    setError(null);
    setDraft({
      name: direction.name,
      thesis: direction.thesis,
      hook: { ...direction.hook },
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft({});
  }

  function saveEdit(directionId: string) {
    const body: Record<string, unknown> = {};
    if (draft.name !== undefined) body.name = draft.name;
    if (draft.thesis !== undefined) body.thesis = draft.thesis;
    if (draft.hook !== undefined) body.hook = draft.hook;
    if (Object.keys(body).length === 0) {
      cancelEdit();
      return null;
    }

    return call(
      `save:${directionId}`,
      `/api/projects/${projectId}/creative-directions/${directionId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      (data) => {
        const saved = data.direction as SerializedCreativeDirection;
        setDirections((current) =>
          current.map((direction) => (direction.id === saved.id ? saved : direction)),
        );
        cancelEdit();
      },
    );
  }

  /**
   * Passing a direction over is a status change, so it goes through the same
   * edit route a reworded thesis does and is revalidated the same way. The row
   * is archived rather than deleted, so a mistake is recoverable.
   */
  function reject(directionId: string) {
    return call(
      `reject:${directionId}`,
      `/api/projects/${projectId}/creative-directions/${directionId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      },
      (data) => {
        const archived = data.direction as SerializedCreativeDirection;
        setDirections((current) =>
          current.map((direction) =>
            direction.id === archived.id ? archived : direction,
          ),
        );
      },
    );
  }

  if (!intent) {
    return (
      <Card title="Creative direction">
        <p className="text-sm text-[#8b8f98]">
          Resolve a content request first. A direction is written for a decided brief.
        </p>
      </Card>
    );
  }

  if (intent.status !== "RESOLVED") {
    return (
      <Card title="Creative direction">
        <p className="text-sm text-[#8b8f98]">
          {intent.contentTypeName} still needs a detail before it can be directed.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Creative direction">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[#8b8f98]">
          Concepts for {intent.contentTypeName}. Not a script or a shot list.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
            Mode
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as CreativeMode)}
              className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
            >
              {(registry?.modes ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {MODE_LABELS[entry.id] ?? entry.id}
                  {entry.requireProductUi ? " - needs product UI" : ""}
                </option>
              ))}
            </select>
          </label>

          <Button onClick={generate} disabled={busy !== null}>
            <Sparkles size={14} />
            {busy === "generate" ? "Thinking" : "Propose directions"}
          </Button>

          {directions.length > 0 ? (
            <Button variant="ghost" onClick={generate} disabled={busy !== null}>
              <RefreshCw size={14} />
              {busy === "generate" ? "Working" : "Propose another set"}
            </Button>
          ) : null}
        </div>

        {run?.fallbackFrom ? (
          <p className="text-[11px] text-[#8a7a45]">
            {MODE_LABELS[run.mode] ?? run.mode} fell back to the built-in director
            {run.fallbackReason ? ` (${run.fallbackReason})` : ""}. These are grounded
            templates, not a model&apos;s reading.
          </p>
        ) : null}

        {error ? <p className="text-xs text-[#f0a8a8]">{error}</p> : null}

        {directions.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {directions.map((direction) => (
              <li key={direction.id}>
                <Card>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="text-sm font-semibold text-white">
                        {direction.name}
                        {direction.editedByUser ? (
                          <span className="ml-2 text-[11px] font-normal text-[#5c6069]">
                            edited
                          </span>
                        ) : null}
                      </h4>
                      <span className={`text-[11px] ${statusColor(direction.status)}`}>
                        {STATUS_LABELS[direction.status] ?? direction.status}
                      </span>
                    </div>

                    <p className="text-[11px] text-[#5c6069]">
                      {ANGLE_LABELS[direction.angle] ?? direction.angle} ·{" "}
                      {MODE_LABELS[direction.mode] ?? direction.mode}
                    </p>

                    {editingId === direction.id ? (
                      <div className="grid gap-3">
                        <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                          Name
                          <input
                            value={draft.name ?? ""}
                            onChange={(event) =>
                              setDraft((current) => ({ ...current, name: event.target.value }))
                            }
                            className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                          Thesis
                          <textarea
                            value={draft.thesis ?? ""}
                            onChange={(event) =>
                              setDraft((current) => ({ ...current, thesis: event.target.value }))
                            }
                            rows={2}
                            className="rounded-lg border border-[#24272e] bg-[#15171c] px-2 py-1 text-sm text-white"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                          Opening line
                          <input
                            value={draft.hook?.statement ?? ""}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                hook: {
                                  statement: event.target.value,
                                  mechanism: current.hook?.mechanism ?? "",
                                  emotionalTrigger: current.hook?.emotionalTrigger ?? "",
                                },
                              }))
                            }
                            className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
                          />
                        </label>
                        <p className="text-[11px] text-[#5c6069]">
                          An edit is held to the same grounding rules as a proposal.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            onClick={() => saveEdit(direction.id)}
                            disabled={busy !== null}
                          >
                            {busy === `save:${direction.id}` ? "Saving" : "Save"}
                          </Button>
                          <Button variant="ghost" onClick={cancelEdit}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-[#e6e6e6]">{direction.hook.statement}</p>
                        <p className="text-sm text-[#b8bcc4]">{direction.thesis}</p>
                        <p className="text-xs text-[#8b8f98]">
                          {direction.narrativeSummary}
                        </p>

                        <dl className="grid gap-2 text-xs text-[#8b8f98] sm:grid-cols-2">
                          <div>
                            <dt className="text-[#5c6069]">Look</dt>
                            <dd>{direction.visualStrategy.approach}</dd>
                          </div>
                          <div>
                            <dt className="text-[#5c6069]">Proof</dt>
                            <dd>{direction.proofStrategy.proofPoints.join("; ")}</dd>
                          </div>
                          <div>
                            <dt className="text-[#5c6069]">Voice</dt>
                            <dd>{direction.voiceDirection}</dd>
                          </div>
                          <div>
                            <dt className="text-[#5c6069]">
                              {direction.cta ? "Call to action" : "No call to action"}
                            </dt>
                            <dd>{direction.cta ?? "Left out"}</dd>
                          </div>
                        </dl>

                        <div className="flex flex-wrap items-center gap-2">
                          {direction.status === "SELECTED" ? null : (
                            <Button
                              variant="ghost"
                              onClick={() => choose(direction.id)}
                              disabled={busy !== null}
                            >
                              <Check size={14} />
                              {busy === `select:${direction.id}` ? "Choosing" : "Choose this"}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            onClick={() => startEdit(direction)}
                            disabled={busy !== null}
                          >
                            <Pencil size={14} />
                            Edit
                          </Button>
                          {direction.status !== "ARCHIVED" ? (
                            <Button
                              variant="ghost"
                              onClick={() => reject(direction.id)}
                              disabled={busy !== null}
                            >
                              <X size={14} />
                              Pass over
                            </Button>
                          ) : null}
                        </div>
                      </>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[#5c6069]">
            No directions yet. Propose a set to choose from.
          </p>
        )}
      </div>
    </Card>
  );
}
