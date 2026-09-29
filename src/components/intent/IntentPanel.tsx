"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleHelp, Pencil, Plus, Sparkles, Target, X } from "lucide-react";
import type {
  ContentIntentRegistry,
  SerializedClarification,
  SerializedContentIntent,
} from "../../lib/content-intent-api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

type IntentView = {
  intent: SerializedContentIntent;
  clarifications: SerializedClarification[];
};

type Registry = ContentIntentRegistry | null;

/** The editor takes dimensions the way a person writes them - "1080x1920" - and
 * sends the object the API validates. A half-typed value becomes a null clear
 * rather than a malformed patch, because the field is only optional per field. */
function parseDimensions(value: string): { width: number; height: number } | null {
  const match = /^(\d{1,5})\s*[x×,/ ]\s*(\d{1,5})$/.exec(value.trim());
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  contentType: "Content type",
  platform: "Platform",
  duration: "Duration",
  aspectRatio: "Aspect ratio",
  quantity: "Quantity",
  tone: "Tone",
  style: "Style",
  language: "Language",
  audience: "Audience",
  cta: "Call to action",
  custom: "Other",
};

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  USER: "You",
  PROJECT: "Project",
  BRAND: "Brand profile",
  AI: "Model reading",
  SYSTEM: "Default",
};

function confidenceColor(confidence: string): string {
  if (confidence === "HIGH") return "text-[#7ee2a8]";
  if (confidence === "MEDIUM") return "text-[#f0c674]";
  return "text-[#8b8f98]";
}

function statusLabel(status: string): string {
  if (status === "NEEDS_CLARIFICATION") return "Needs a detail";
  if (status === "DRAFT") return "Draft";
  if (status === "BLOCKED") return "Blocked";
  return "Resolved";
}

/**
 * The panel shows the reading and lets the user correct it. It deliberately does
 * not suggest what to make: choosing a type is a choice, and the panel's only
 * job is to make the current choice - and where it came from - visible.
 */
export function IntentPanel({
  projectId,
  initialIntents,
  initialRegistry,
}: {
  projectId: string;
  initialIntents: IntentView[];
  initialRegistry: Registry;
}) {
  const router = useRouter();
  const [intents, setIntents] = useState<IntentView[]>(initialIntents);
  const [registry, setRegistry] = useState<Registry>(initialRegistry);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  /** Notes the server attached to this reading but does not persist on the
   * intent - a fallback notice, for instance. Without this the user would see a
   * reading whose provenance quietly went missing after a reload. */
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string[]>>({});

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
        const issues = Array.isArray(data.issues) ? (data.issues as string[]).join(", ") : "";
        setError(issues ? `${String(data.error ?? "Request failed")} (${issues})` : String(data.error ?? "Request failed"));
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

  function adopt(data: Record<string, unknown>) {
    const view: IntentView = {
      intent: data.intent as SerializedContentIntent,
      clarifications: (data.clarifications ?? []) as SerializedClarification[],
    };
    if (data.registry) setRegistry(data.registry as ContentIntentRegistry);
    const resolution = data.resolution as { notes?: string[] } | undefined;
    const notes = (resolution?.notes ?? []).filter(
      (note) => !view.intent.notes.includes(note),
    );
    setResolutionNotes((current) => ({ ...current, [view.intent.id]: notes }));
    setIntents((current) => [view, ...current.filter((entry) => entry.intent.id !== view.intent.id)]);
    return view;
  }

  function resolve(event: React.FormEvent) {
    event.preventDefault();
    const text = request.trim();
    if (!text) {
      setError("Type what you want to make first.");
      return;
    }
    return call(
      "resolve",
      `/api/projects/${projectId}/intent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: text }),
      },
      (data) => {
        adopt(data);
        setRequest("");
        const view = data as unknown as IntentView;
        if (view.clarifications.length > 0) {
          setEditingId(view.intent.id);
          startEdit(view.intent);
        }
      },
    );
  }

  function startEdit(intent: SerializedContentIntent) {
    setEditingId(intent.id);
    setError(null);
    setDraft({
      contentTypeId: intent.contentTypeId,
      platforms: intent.platforms.join(", "),
      durationSeconds: intent.durationSeconds === null ? "" : String(intent.durationSeconds),
      quantity: String(intent.quantity),
      aspectRatio: intent.aspectRatio ?? "",
      customAspectRatio: intent.customAspectRatio
        ? `${intent.customAspectRatio.width}x${intent.customAspectRatio.height}`
        : "",
      tone: intent.tone ?? "",
      style: intent.style ?? "",
      language: intent.language ?? "",
      audience: intent.audience ?? "",
      cta: intent.cta ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft({});
  }

  function saveEdit(intentId: string) {
    const body: Record<string, unknown> = {};

    if ((draft.contentTypeId ?? "") !== intentContentType(intentId)) {
      body.contentTypeId = (draft.contentTypeId ?? "").trim();
    }

    const platforms = (draft.platforms ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (platforms.join(",") !== intents.find((entry) => entry.intent.id === intentId)?.intent.platforms.join(",")) {
      body.platforms = platforms;
    }

    const duration = (draft.durationSeconds ?? "").trim();
    if (duration === "") {
      body.durationSeconds = null;
    } else if (Number(duration) !== intentDuration(intentId)) {
      body.durationSeconds = Number(duration);
    }

    const quantity = Number((draft.quantity ?? "1").trim() || "1");
    if (quantity !== intentQuantity(intentId)) {
      body.quantity = quantity;
    }

    if ((draft.aspectRatio ?? "") !== intentAspectRatio(intentId)) {
      body.aspectRatio = (draft.aspectRatio ?? "").trim();
    }

    // A custom ratio is two numbers, not a name, so they travel together and are
    // only sent when the ratio is actually custom - otherwise a stale pair from
    // the draft would be pushed onto a named ratio.
    if ((body.aspectRatio ?? intentAspectRatio(intentId)) === "CUSTOM") {
      const custom = (draft.customAspectRatio ?? "").trim();
      if (custom !== intentCustomDimensions(intentId)) {
        body.customAspectRatio = custom === "" ? null : parseDimensions(custom);
      }
    }

    for (const key of ["tone", "style", "language", "audience", "cta"] as const) {
      const next = (draft[key] ?? "").trim();
      if (next !== (intentText(intentId, key) ?? "")) {
        body[key] = next === "" ? null : next;
      }
    }

    if (Object.keys(body).length === 0) {
      cancelEdit();
      return;
    }

    return call(
      "save",
      `/api/projects/${projectId}/intent/${intentId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      (data) => {
        adopt(data);
        cancelEdit();
      },
    );
  }

  function intentContentType(id: string): string {
    return intents.find((entry) => entry.intent.id === id)?.intent.contentTypeId ?? "";
  }
  function intentDuration(id: string): number | null {
    return intents.find((entry) => entry.intent.id === id)?.intent.durationSeconds ?? null;
  }
  function intentQuantity(id: string): number {
    return intents.find((entry) => entry.intent.id === id)?.intent.quantity ?? 1;
  }
  function intentAspectRatio(id: string): string {
    return intents.find((entry) => entry.intent.id === id)?.intent.aspectRatio ?? "";
  }
  /** The dimensions as the editor shows them, so a save can tell a real change
   * from a draft the user never touched. */
  function intentCustomDimensions(id: string): string {
    const custom = intents.find((entry) => entry.intent.id === id)?.intent.customAspectRatio ?? null;
    return custom ? `${custom.width}x${custom.height}` : "";
  }
  function intentText(id: string, key: string): string | null {
    const intent = intents.find((entry) => entry.intent.id === id)?.intent;
    if (!intent) return null;
    return (intent as unknown as Record<string, string | null>)[key] ?? null;
  }

  const activeIntent = registry
    ? intents.find((entry) => entry.intent.contentTypeId === draft.contentTypeId)
    : undefined;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
        <Target size={14} />
        Content request
      </div>
      <h2 className="mt-2 text-xl font-semibold text-white">What do you want to make?</h2>
      <p className="mt-1 max-w-2xl text-sm text-[#777b84]">
        Say it as you would to a person. This reads your request into what, where, how long and
        how many - the shape of the work, not the work itself. You can correct every answer.
      </p>

      <form onSubmit={resolve} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="Make a 30 second launch video for LinkedIn"
          aria-label="Content request"
          className="min-h-10 flex-1 rounded-lg border border-[#24272e] bg-[#15171c] px-3 text-sm text-white placeholder:text-[#5c6069]"
        />
        <Button type="submit" disabled={busy !== null}>
          <Sparkles size={14} />
          {busy === "resolve" ? "Reading…" : "Resolve request"}
        </Button>
      </form>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[#ff9a9a]">
          {error}
        </p>
      ) : null}

      {intents.length === 0 ? (
        <p className="mt-5 text-sm text-[#62666f]">
          No content request yet. Nothing is generated until you have resolved one.
        </p>
      ) : null}

      <ul className="mt-5 flex flex-col gap-4">
        {intents.map(({ intent, clarifications }) => (
          <li key={intent.id} className="rounded-xl border border-[#24272e] bg-[#0c0e12] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-white">{intent.rawRequest}</p>
                {/* Each fact is its own element so the reading can be read - and
                    asserted - one value at a time rather than as one run of text. */}
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#777b84]">
                  <span>{intent.contentTypeName ?? "Content type not decided"}</span>
                  {intent.platformNames.length > 0 ? <span>{intent.platformNames.join(", ")}</span> : null}
                  {intent.durationSeconds !== null ? (
                    <span>{intent.durationSeconds}s</span>
                  ) : null}
                  {intent.quantity > 1 ? <span>{intent.quantity} of them</span> : null}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded-full border border-[#24272e] px-2 py-1 text-[#b4b7bf]">
                  {statusLabel(intent.status)}
                </span>
                <span className={confidenceColor(intent.confidence)}>{intent.confidence}</span>
                {editingId === intent.id ? (
                  <Button variant="ghost" onClick={cancelEdit} aria-label="Cancel edit">
                    <X size={14} />
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => startEdit(intent)} aria-label={`Edit ${intent.id}`}>
                    <Pencil size={14} />
                  </Button>
                )}
              </div>
            </div>

            {clarifications.length > 0 ? (
              <div className="mt-3 rounded-lg border border-[#3a3320] bg-[#17140c] p-3">
                <p className="flex items-center gap-2 text-xs font-medium text-[#f0c674]">
                  <CircleHelp size={13} />
                  {clarifications.length === 1
                    ? "One detail is missing"
                    : `${clarifications.length} details are missing`}
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {clarifications.map((clarification) => (
                    <li key={clarification.field} className="text-xs text-[#d8cfae]">
                      {clarification.question}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {intent.constraints.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {intent.constraints.map((constraint, index) => (
                  <li
                    key={`${constraint.key}-${constraint.source}-${index}`}
                    className="rounded-full border border-[#24272e] px-2 py-1 text-[11px] text-[#8b8f98]"
                  >
                    <span>
                      {FIELD_LABELS[constraint.key] ?? constraint.key}: {constraint.value}
                    </span>
                    <span className="ml-1 text-[#5c6069]">
                      ({SOURCE_LABELS[constraint.source] ?? constraint.source})
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {[...intent.notes, ...(resolutionNotes[intent.id] ?? [])].length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {intent.notes.map((note) => (
                  <li key={note} className="text-[11px] text-[#5c6069]">
                    {note}
                  </li>
                ))}
                {(resolutionNotes[intent.id] ?? []).map((note) => (
                  <li key={note} className="text-[11px] text-[#8a7a45]">
                    {note}
                  </li>
                ))}
              </ul>
            ) : null}

            {editingId === intent.id ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                  Content type
                  <select
                    value={draft.contentTypeId ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, contentTypeId: event.target.value }))
                    }
                    className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
                  >
                    <option value="">Not decided yet</option>
                    {(registry?.contentTypes ?? []).map((contentType) => (
                      <option key={contentType.id} value={contentType.id}>
                        {contentType.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                  Platforms
                  <input
                    value={draft.platforms ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, platforms: event.target.value }))
                    }
                    placeholder="linkedin"
                    className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
                  />
                </label>

                {registry ? (
                  <p className="text-[11px] text-[#5c6069] sm:col-span-2">
                    {activeIntent
                      ? `${activeIntent.intent.contentTypeName} supports platforms: ${
                          registry.contentTypes
                            .find((entry) => entry.id === draft.contentTypeId)
                            ?.supportedPlatforms.join(", ") ?? "none"
                        }`
                      : "Pick a content type to see where it can run."}
                  </p>
                ) : null}

                <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                  Duration (seconds)
                  <input
                    value={draft.durationSeconds ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, durationSeconds: event.target.value }))
                    }
                    className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                  Quantity
                  <input
                    value={draft.quantity ?? "1"}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, quantity: event.target.value }))
                    }
                    className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                  Aspect ratio
                  <select
                    value={draft.aspectRatio ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, aspectRatio: event.target.value }))
                    }
                    className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
                  >
                    <option value="">Not decided</option>
                    {(registry?.aspectRatios ?? []).map((ratio) => (
                      <option key={ratio} value={ratio}>
                        {ratio}
                      </option>
                    ))}
                  </select>
                </label>

                {(draft.aspectRatio ?? "") === "CUSTOM" ? (
                  <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                    Custom dimensions (width x height)
                    <input
                      value={draft.customAspectRatio ?? ""}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          customAspectRatio: event.target.value,
                        }))
                      }
                      placeholder="1080x1920"
                      className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
                    />
                  </label>
                ) : null}

                <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                  Tone
                  <input
                    value={draft.tone ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, tone: event.target.value }))
                    }
                    className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                  Style
                  <input
                    value={draft.style ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, style: event.target.value }))
                    }
                    className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                  Language
                  <input
                    value={draft.language ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, language: event.target.value }))
                    }
                    placeholder="en"
                    className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                  Audience
                  <input
                    value={draft.audience ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, audience: event.target.value }))
                    }
                    className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                  Call to action
                  <input
                    value={draft.cta ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, cta: event.target.value }))
                    }
                    className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
                  />
                </label>

                <div className="flex items-end sm:col-span-2">
                  <Button onClick={() => saveEdit(intent.id)} disabled={busy !== null}>
                    <Plus size={14} />
                    {busy === "save" ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
