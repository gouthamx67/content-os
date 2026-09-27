"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  Droplet,
  Lock,
  LockOpen,
  Palette,
  Pencil,
  RefreshCw,
  Sparkles,
  Type,
} from "lucide-react";
import type { BrandExecutionProfile } from "../../core/domain/brand";
import type {
  SerializedBrandColor,
  SerializedBrandProfile,
} from "../../lib/brand-api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

type TextField =
  | "name"
  | "positioning"
  | "tagline"
  | "valueProposition"
  | "voiceSummary"
  | "visualStyle";

const TEXT_FIELDS: ReadonlyArray<{ key: TextField; label: string; long: boolean }> = [
  { key: "name", label: "Name", long: false },
  { key: "positioning", label: "Positioning", long: true },
  { key: "tagline", label: "Tagline", long: true },
  { key: "valueProposition", label: "Value proposition", long: true },
  { key: "voiceSummary", label: "Voice", long: true },
  { key: "visualStyle", label: "Visual style", long: true },
];

const STATUS_LABEL: Record<SerializedBrandProfile["status"], string> = {
  DRAFT: "Draft",
  READY: "Ready",
  STALE: "Stale",
};

function toneForConfidence(confidence: string): string {
  if (confidence === "HIGH") return "text-[#7ee2a8]";
  if (confidence === "MEDIUM") return "text-[#f0c674]";
  return "text-[#8b8f98]";
}

export function BrandPanel({
  projectId,
  brand,
  execution,
  sourceStates,
}: {
  projectId: string;
  brand: SerializedBrandProfile | null;
  execution: BrandExecutionProfile | null;
  sourceStates: ReadonlyArray<{
    sourceId: string;
    contentHash: string | null;
    sourceUpdatedAt: string;
    analyzerId: string;
    brandVersion: number;
    analyzedAt: string;
  }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingText, setEditingText] = useState(false);
  const [textDraft, setTextDraft] = useState<Record<string, string>>({});
  const [editingPalette, setEditingPalette] = useState(false);
  const [paletteDraft, setPaletteDraft] = useState<
    Record<string, { name: string; hex: string; role: string }>
  >({});

  async function call(
    label: string,
    url: string,
    init: RequestInit,
    success: (data: Record<string, unknown>) => string,
  ) {
    setError(null);
    setNotice(null);
    setBusy(label);
    try {
      const response = await fetch(url, init);
      const data = await response.json();
      if (!response.ok) {
        setError(String(data.error ?? "Request failed"));
        return null;
      }
      setNotice(success(data));
      router.refresh();
      return data as Record<string, unknown>;
    } catch {
      setError("Request failed");
      return null;
    } finally {
      setBusy(null);
    }
  }

  function describeRun(data: Record<string, unknown>): string {
    const skipped = String(data.skipped ?? "NONE");
    const notes = Array.isArray(data.notes) ? (data.notes as string[]) : [];
    if (skipped === "UP_TO_DATE") {
      return "No new or changed sources since the last brand analysis.";
    }
    if (skipped === "LOCKED") {
      return "The brand is locked. New evidence was recorded but no value changed.";
    }
    const analyzed = Array.isArray(data.analyzedSourceIds) ? data.analyzedSourceIds.length : 0;
    return `Analyzed ${analyzed} source${analyzed === 1 ? "" : "s"}.${
      notes.length > 0 ? ` ${notes.join(" ")}` : ""
    }`;
  }

  function analyze() {
    return call(
      "analyze",
      `/api/projects/${projectId}/brand/analyze`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      describeRun,
    );
  }

  function refresh() {
    return call("refresh", `/api/projects/${projectId}/brand/refresh`, { method: "POST" }, describeRun);
  }

  function setLock(locked: boolean) {
    return call(
      locked ? "lock" : "unlock",
      `/api/projects/${projectId}/brand/${locked ? "lock" : "unlock"}`,
      { method: "POST" },
      () => (locked ? "Brand locked. New evidence will not change canonical values." : "Brand unlocked."),
    );
  }

  function startTextEdit() {
    if (!brand) return;
    setTextDraft(
      Object.fromEntries(
        TEXT_FIELDS.map((field) => [field.key, brand[field.key] ?? ""]),
      ) as Record<string, string>,
    );
    setEditingText(true);
  }

  async function saveText() {
    if (!brand) return;
    const body: Record<string, unknown> = {};
    for (const field of TEXT_FIELDS) {
      const next = (textDraft[field.key] ?? "").trim();
      const current = brand[field.key];
      // An untouched field is omitted so the patch owns only what it changes.
      if (next !== (current ?? "")) {
        body[field.key] = next === "" ? null : next;
      }
    }
    if (Object.keys(body).length === 0) {
      setEditingText(false);
      return;
    }
    const saved = await call(
      "save",
      `/api/projects/${projectId}/brand`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      () => "Brand updated. Corrections are kept across the next refresh.",
    );
    if (saved) setEditingText(false);
  }

  function startPaletteEdit() {
    if (!brand) return;
    setPaletteDraft(
      Object.fromEntries(
        brand.colors.map((color) => [
          color.id,
          { name: color.name, hex: color.hex, role: color.role },
        ]),
      ) as Record<string, { name: string; hex: string; role: string }>,
    );
    setEditingPalette(true);
  }

  async function savePalette() {
    if (!brand) return;
    const colors = Object.values(paletteDraft).map((entry) => ({
      name: entry.name,
      hex: entry.hex,
      role: entry.role,
    }));
    const saved = await call(
      "save",
      `/api/projects/${projectId}/brand`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colors }),
      },
      () => "Palette updated. The replaced color is kept as a visible conflict.",
    );
    if (saved) setEditingPalette(false);
  }

  const analyzedSources = sourceStates.length;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
            <Palette size={14} />
            Brand
          </div>
          <h2 className="mt-2 text-xl font-semibold text-white">
            {brand?.name ?? "No brand profile yet"}
          </h2>
          <p className="mt-1 text-sm text-[#777b84]">
            {brand
              ? `Version ${brand.version} · ${STATUS_LABEL[brand.status]} · ${brand.confidence.toLowerCase()} confidence`
              : "Analyze the project's sources to build a canonical brand profile."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!brand ? (
            <Button onClick={analyze} disabled={busy !== null}>
              <Sparkles size={14} />
              {busy === "analyze" ? "Analyzing" : "Analyze brand"}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={refresh}
                disabled={busy !== null || brand.locked === true}
                title={
                  brand.locked
                    ? "Unlock the brand before refreshing canonical values"
                    : "Re-read new or changed sources"
                }
              >
                <RefreshCw size={14} />
                {busy === "refresh" ? "Refreshing" : "Refresh"}
              </Button>
              <Button
                variant="secondary"
                onClick={analyze}
                disabled={busy !== null}
                title="Re-read every source, ignoring change detection"
              >
                <Sparkles size={14} />
                {busy === "analyze" ? "Analyzing" : "Re-analyze all"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setLock(!brand.locked)}
                disabled={busy !== null}
              >
                {brand.locked ? <Lock size={14} /> : <LockOpen size={14} />}
                {busy === "lock"
                  ? "Locking"
                  : busy === "unlock"
                    ? "Unlocking"
                    : brand.locked
                      ? "Unlock"
                      : "Lock"}
              </Button>
            </>
          )}
        </div>
      </div>

      {notice ? <p className="mt-3 text-xs text-[#7ee2a8]">{notice}</p> : null}
      {error ? <p className="mt-3 text-xs text-[#f08a8a]">{error}</p> : null}

      {!brand ? (
        <p className="mt-5 text-sm text-[#777b84]">
          The brand layer reads the sources already connected to this project. Nothing is sent
          anywhere else, and an optional model pass can only reorder evidence the analyzers
          already found.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {brand.locked ? (
            <p className="flex items-center gap-2 rounded-lg border border-[#24272e] bg-[#0d0f13] px-3 py-2 text-xs text-[#b4b7bf]">
              <Lock size={13} />
              Locked. New evidence is still recorded, but no canonical value changes until you
              unlock.
            </p>
          ) : null}

          <section>
            <SectionHeader
              title="Identity"
              action={
                brand.locked ? null : editingText ? (
                  <span className="flex gap-2">
                    <Button variant="ghost" onClick={() => setEditingText(false)} disabled={busy !== null}>
                      Cancel
                    </Button>
                    <Button onClick={saveText} disabled={busy !== null}>
                      {busy === "save" ? "Saving" : "Save"}
                    </Button>
                  </span>
                ) : (
                  <Button variant="ghost" onClick={startTextEdit}>
                    <Pencil size={13} />
                    Edit
                  </Button>
                )
              }
            />

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {TEXT_FIELDS.map((field) => {
                const value = brand[field.key];
                const origin = brand.textOrigins[field.key];
                return (
                  <div
                    key={field.key}
                    className={field.long ? "rounded-xl border border-[#1b1e24] bg-[#0d0f13] p-3 sm:col-span-2" : "rounded-xl border border-[#1b1e24] bg-[#0d0f13] p-3"}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs uppercase tracking-wide text-[#62666f]">
                        {field.label}
                      </span>
                      {origin ? (
                        <span className="text-[10px] uppercase tracking-wide text-[#4d515a]">
                          {origin}
                        </span>
                      ) : null}
                    </div>
                    {editingText ? (
                      field.long ? (
                        <textarea
                          value={textDraft[field.key] ?? ""}
                          onChange={(event) =>
                            setTextDraft((draft) => ({ ...draft, [field.key]: event.target.value }))
                          }
                          rows={2}
                          className="mt-2 w-full rounded-lg border border-[#24272e] bg-[#101216] px-2 py-1.5 text-sm text-white outline-none focus:border-[#3a3f49]"
                        />
                      ) : (
                        <input
                          value={textDraft[field.key] ?? ""}
                          onChange={(event) =>
                            setTextDraft((draft) => ({ ...draft, [field.key]: event.target.value }))
                          }
                          className="mt-2 w-full rounded-lg border border-[#24272e] bg-[#101216] px-2 py-1.5 text-sm text-white outline-none focus:border-[#3a3f49]"
                        />
                      )
                    ) : (
                      <p className="mt-1.5 text-sm text-white">
                        {value ?? <span className="text-[#4d515a]">Not set</span>}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <SectionHeader
              title="Color"
              icon={<Droplet size={13} />}
              action={
                brand.locked ? null : editingPalette ? (
                  <span className="flex gap-2">
                    <Button variant="ghost" onClick={() => setEditingPalette(false)} disabled={busy !== null}>
                      Cancel
                    </Button>
                    <Button onClick={savePalette} disabled={busy !== null}>
                      {busy === "save" ? "Saving" : "Save"}
                    </Button>
                  </span>
                ) : (
                  <Button variant="ghost" onClick={startPaletteEdit}>
                    <Pencil size={13} />
                    Edit
                  </Button>
                )
              }
            />
            {brand.colors.length === 0 ? (
              <Empty>No colors extracted yet.</Empty>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {brand.colors.map((color) => (
                  <ColorRow
                    key={color.id}
                    color={color}
                    draft={editingPalette ? paletteDraft[color.id] : undefined}
                    onChange={(next) =>
                      setPaletteDraft((draft) => ({ ...draft, [color.id]: next }))
                    }
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionHeader title="Typography" icon={<Type size={13} />} />
            {brand.fonts.length === 0 ? (
              <Empty>No fonts extracted yet.</Empty>
            ) : (
              <ul className="mt-3 divide-y divide-[#1b1e24] rounded-xl border border-[#1b1e24] bg-[#0d0f13]">
                {brand.fonts.map((font) => (
                  <li key={font.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                    <div>
                      <p className="text-sm text-white">{font.family}</p>
                      <p className="text-xs text-[#62666f]">
                        {font.role.toLowerCase()}
                        {font.weight ? ` · ${font.weight}` : ""}
                        {font.style ? ` · ${font.style}` : ""}
                      </p>
                    </div>
                    <Provenance origin={font.origin} basis={font.basis} confidence={font.confidence} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionHeader title="Logo assets" />
            {brand.assets.length === 0 ? (
              <Empty>No brand assets recognized yet.</Empty>
            ) : (
              <ul className="mt-3 divide-y divide-[#1b1e24] rounded-xl border border-[#1b1e24] bg-[#0d0f13]">
                {brand.assets.map((asset) => (
                  <li key={asset.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                    <div>
                      <p className="text-sm text-white">{asset.label}</p>
                      <p className="text-xs text-[#62666f]">{asset.role.toLowerCase()}</p>
                    </div>
                    <Provenance origin={asset.origin} basis={asset.basis} confidence={asset.confidence} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionHeader title="Language" />
            {brand.terms.length === 0 &&
            brand.guidelines.length === 0 &&
            brand.voiceSignals.length === 0 ? (
              <Empty>No terminology or voice signals extracted yet.</Empty>
            ) : (
              <div className="mt-3 space-y-3">
                {brand.terms.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {brand.terms.map((term) => (
                      <span
                        key={term.id}
                        className={[
                          "rounded-lg border px-2.5 py-1 text-xs",
                          term.preference === "AVOID"
                            ? "border-[#4a2b2b] bg-[#1a1012] text-[#e59a9a]"
                            : term.preference === "PREFERRED"
                              ? "border-[#26402f] bg-[#0f1a13] text-[#8fd9a6]"
                              : "border-[#24272e] bg-[#0d0f13] text-[#b4b7bf]",
                        ].join(" ")}
                      >
                        {term.term}
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide opacity-60">
                          {term.origin}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}

                {brand.voiceSignals.length > 0 ? (
                  <ul className="divide-y divide-[#1b1e24] rounded-xl border border-[#1b1e24] bg-[#0d0f13]">
                    {brand.voiceSignals.map((signal) => (
                      <li key={signal.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="text-xs text-[#62666f]">{signal.kind.replace(/_/g, " ").toLowerCase()}</span>
                        <span className="text-sm text-white">{signal.value}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {brand.guidelines.length > 0 ? (
                  <ul className="space-y-2">
                    {brand.guidelines.map((guideline) => (
                      <li
                        key={guideline.id}
                        className="rounded-xl border border-[#1b1e24] bg-[#0d0f13] px-3 py-2.5"
                      >
                        <p className="text-sm text-white">{guideline.title}</p>
                        <p className="mt-0.5 text-xs text-[#777b84]">{guideline.detail}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </section>

          {brand.conflicts.length > 0 ? (
            <section>
              <SectionHeader title="Unresolved disagreements" icon={<AlertTriangle size={13} />} />
              <ul className="mt-3 space-y-2">
                {brand.conflicts.map((conflict) => (
                  <li
                    key={conflict.id}
                    className="rounded-xl border border-[#3a3120] bg-[#14120d] px-3 py-2.5"
                  >
                    <p className="text-xs uppercase tracking-wide text-[#f0c674]">{conflict.field}</p>
                    <p className="mt-1 text-sm text-white">
                      Kept {conflict.retained}
                      <span className="text-[#62666f]"> · over </span>
                      {conflict.competing}
                    </p>
                    <p className="mt-1 text-xs text-[#777b84]">
                      Resolved by {conflict.resolvedBy.toLowerCase().replace(/_/g, " ")}. Both values
                      stay visible so a reviewer can overrule the decision.
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {execution ? (
            <section>
              <SectionHeader title="Available to generation" icon={<BadgeCheck size={13} />} />
              <div className="mt-3 rounded-xl border border-[#1b1e24] bg-[#0d0f13] px-3 py-2.5">
                <p className="text-xs text-[#777b84]">
                  Generation reads this projection, not the raw profile: sorted colors and fonts,
                  deduplicated terms, and nothing marked as internal.
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {executionSections(execution).map((section) => (
                    <li
                      key={section.label}
                      className={[
                        "rounded-lg border px-2.5 py-1 text-xs",
                        section.available
                          ? "border-[#26402f] bg-[#0f1a13] text-[#8fd9a6]"
                          : "border-[#24272e] bg-[#101216] text-[#62666f]",
                      ].join(" ")}
                    >
                      {section.label}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          <section>
            <SectionHeader title="Source coverage" />
            <p className="mt-2 text-xs text-[#62666f]">
              {analyzedSources === 0
                ? "No source has been read for brand yet."
                : `${analyzedSources} source${analyzedSources === 1 ? "" : "s"} read. A refresh re-reads only new or changed sources.`}
            </p>
          </section>
        </div>
      )}
    </Card>
  );
}

/** What a downstream generation step can actually assert, section by section. */
function executionSections(execution: BrandExecutionProfile): { label: string; available: boolean }[] {
  return [
    { label: "name", available: Boolean(execution.name) },
    { label: "positioning", available: Boolean(execution.positioning ?? execution.valueProposition) },
    { label: "voice", available: Boolean(execution.voice.summary) || execution.voice.signals.length > 0 },
    { label: "colors", available: execution.visual.colors.length > 0 },
    { label: "fonts", available: execution.visual.fonts.length > 0 },
    { label: "logo assets", available: execution.visual.assets.length > 0 },
    {
      label: "terms",
      available: execution.terms.preferred.length > 0 || execution.terms.avoid.length > 0,
    },
    { label: "guidelines", available: execution.guidelines.length > 0 },
  ];
}

function SectionHeader({
  title,
  icon,
  action,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-sm font-medium text-white">
        {icon}
        {title}
      </h3>
      {action}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-[#4d515a]">{children}</p>;
}

function Provenance({
  origin,
  basis,
  confidence,
}: {
  origin: string;
  basis: string;
  confidence: string;
}) {
  return (
    <span className="flex items-center gap-2 text-[10px] uppercase tracking-wide">
      {/* Origin says where the value came from; basis says which precedence layer
          won, so a design token never looks the same as a loose extraction. */}
      <span className="text-[#4d515a]">{origin.toLowerCase().replace(/_/g, " ")}</span>
      <span className="text-[#33373f]">·</span>
      <span className="text-[#4d515a]">{basis.toLowerCase().replace(/_/g, " ")}</span>
      <span className="text-[#33373f]">·</span>
      <span className={toneForConfidence(confidence)}>{confidence.toLowerCase()}</span>
    </span>
  );
}

function ColorRow({
  color,
  draft,
  onChange,
}: {
  color: SerializedBrandColor;
  draft: { name: string; hex: string; role: string } | undefined;
  onChange: (next: { name: string; hex: string; role: string }) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#1b1e24] bg-[#0d0f13] px-3 py-2.5">
      <span
        className="h-8 w-8 shrink-0 rounded-lg border border-[#24272e]"
        style={{ backgroundColor: color.hex }}
        aria-hidden
      />
      {draft ? (
        <div className="grid flex-1 gap-2 sm:grid-cols-3">
          <input
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            className="rounded-lg border border-[#24272e] bg-[#101216] px-2 py-1 text-xs text-white outline-none focus:border-[#3a3f49]"
          />
          <input
            value={draft.hex}
            onChange={(event) => onChange({ ...draft, hex: event.target.value })}
            className="rounded-lg border border-[#24272e] bg-[#101216] px-2 py-1 font-mono text-xs text-white outline-none focus:border-[#3a3f49]"
          />
          <select
            value={draft.role}
            onChange={(event) => onChange({ ...draft, role: event.target.value })}
            className="rounded-lg border border-[#24272e] bg-[#101216] px-2 py-1 text-xs text-white outline-none focus:border-[#3a3f49]"
          >
            {["PRIMARY", "SECONDARY", "ACCENT", "BACKGROUND", "TEXT"].map((role) => (
              <option key={role} value={role}>
                {role.toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white">{color.name}</p>
          <p className="font-mono text-xs text-[#62666f]">
            {color.hex} · {color.role.toLowerCase()}
          </p>
        </div>
      )}
      <Provenance origin={color.origin} basis={color.basis} confidence={color.confidence} />
    </div>
  );
}
