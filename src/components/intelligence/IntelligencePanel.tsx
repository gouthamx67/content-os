"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  Brain,
  Lock,
  Pencil,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  ASSET_ROLES,
  AUDIENCE_SIGNAL_KINDS,
  BRAND_SIGNAL_KINDS,
  CLAIM_TYPES,
  FEATURE_CATEGORIES,
  IMPORTANCE_LEVELS,
  VERIFICATION_STATUSES,
  type IntelligenceRun,
  type IntelligenceSnapshot,
  type Product,
  type VerificationStatus,
} from "../../core/domain/intelligence";
import type { SerializedIntelligenceGraph } from "../../lib/intelligence-api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

export type IntelligenceSummary = {
  project: { id: string; name: string };
  product: Product | null;
  counts: Record<string, number>;
  lastRun: IntelligenceRun | null;
  lastSnapshot: IntelligenceSnapshot | null;
};

type Section =
  | "product"
  | "features"
  | "problems"
  | "benefits"
  | "claims"
  | "workflows"
  | "audienceSignals"
  | "brandSignals"
  | "assets"
  | "evidence"
  | "connections";

type EntitySection = Exclude<Section, "product" | "evidence" | "connections">;

type Tone = "neutral" | "good" | "warn" | "info";

type Badge = { label: string; tone: Tone };

type CorrectionField =
  | { key: string; label: string; kind: "text" | "textarea" | "steps"; value: string }
  | { key: string; label: string; kind: "enum"; value: string; options: readonly string[] };

type Correction =
  | { scope: "product"; fields: CorrectionField[] }
  | { scope: EntitySection; canonicalKey: string; fields: CorrectionField[] };

/** Section ids are plural for readability; the correction API uses entity types. */
const CORRECTION_SCOPES: Record<EntitySection, string> = {
  features: "FEATURE",
  problems: "PROBLEM",
  benefits: "BENEFIT",
  claims: "CLAIM",
  workflows: "WORKFLOW",
  audienceSignals: "AUDIENCE_SIGNAL",
  brandSignals: "BRAND_SIGNAL",
  assets: "ASSET",
};

type Row = {
  id: string;
  section: Section;
  title: string;
  subtitle: string | null;
  badges: Badge[];
  provenance: { evidenceIds: number; sources: number; method: string | null };
  locked: boolean;
  correction: Correction | null;
};

const TONES: Record<Tone, string> = {
  neutral: "border-[#2c3037] bg-[#16181d] text-[#b4b7bf]",
  good: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  warn: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  info: "border-sky-500/20 bg-sky-500/10 text-sky-300",
};

const CONFIDENCE_TONES: Record<string, Tone> = {
  HIGH: "good",
  MEDIUM: "warn",
  LOW: "neutral",
};

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "product", label: "Product" },
  { id: "features", label: "Features" },
  { id: "problems", label: "Problems" },
  { id: "benefits", label: "Benefits" },
  { id: "claims", label: "Claims" },
  { id: "workflows", label: "Workflows" },
  { id: "audienceSignals", label: "Audience" },
  { id: "brandSignals", label: "Brand" },
  { id: "assets", label: "Assets" },
  { id: "evidence", label: "Evidence" },
  { id: "connections", label: "Connections" },
];

const inputClassName =
  "w-full rounded-lg border border-[#30343c] bg-[#15171c] px-3 py-2 text-sm text-white outline-none placeholder:text-[#62666f] focus:border-white/40";

function humanize(value: string): string {
  return value.replace(/_/g, " ").toLowerCase();
}

function truncateLabel(value: string): string {
  return value.length <= 48 ? value : `${value.slice(0, 47).trimEnd()}…`;
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function confidenceBadge(confidence: string): Badge {
  return { label: confidence, tone: CONFIDENCE_TONES[confidence] ?? "neutral" };
}

function assertionBadge(assertionKind: string): Badge {
  return {
    label: humanize(assertionKind),
    tone: assertionKind === "USER_PROVIDED" ? "info" : "neutral",
  };
}

function neutralBadge(value: string): Badge {
  return { label: humanize(value), tone: "neutral" };
}

function verificationBadge(verification: VerificationStatus): Badge {
  const tone: Tone =
    verification === "SUPPORTED"
      ? "good"
      : verification === "CONTRADICTED" || verification === "CONFLICTING"
        ? "warn"
        : "neutral";
  return { label: humanize(verification), tone };
}

function countProvenance(provenance: {
  sourceIds: string[];
  evidenceIds: string[];
  method: string;
} | null) {
  return {
    evidenceIds: provenance?.evidenceIds.length ?? 0,
    sources: provenance?.sourceIds.length ?? 0,
    method: provenance?.method ?? null,
  };
}

export function IntelligencePanel({
  projectId,
  summary,
  graph,
  runs,
  snapshots,
}: {
  projectId: string;
  summary: IntelligenceSummary;
  graph: SerializedIntelligenceGraph;
  runs: IntelligenceRun[];
  snapshots: IntelligenceSnapshot[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("product");
  const [editing, setEditing] = useState<string | null>(null);

  const rows = buildRows(graph, summary.product);
  const total = rows.filter((row) => row.section !== "product").length;

  async function post(url: string, body: Record<string, unknown>, label: string, success: string) {
    setError(null);
    setNotice(null);
    setBusy(label);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Request failed");
        return false;
      }
      setNotice(success);
      router.refresh();
      return true;
    } catch {
      setError("Request failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function runAnalysis(path: "analyze" | "refresh") {
    setError(null);
    setNotice(null);
    setBusy(path);
    try {
      const response = await fetch(`/api/projects/${projectId}/intelligence/${path}`, {
        method: "POST",
        headers: path === "analyze" ? { "Content-Type": "application/json" } : undefined,
        body: path === "analyze" ? JSON.stringify({}) : undefined,
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Intelligence run failed");
        return;
      }
      const notes: string[] = Array.isArray(data.notes) ? data.notes : [];
      setNotice(
        notes.length > 0
          ? notes.join(" ")
          : `Run ${String(data.run?.status ?? "finished").toLowerCase()}.`,
      );
      router.refresh();
    } catch {
      setError("Intelligence run failed");
    } finally {
      setBusy(null);
    }
  }

  async function save(row: Row, changes: Record<string, unknown>) {
    const correction = row.correction;
    if (!correction) {
      return;
    }
    const body =
      correction.scope === "product"
        ? { scope: "product", ...changes }
        : {
            scope: CORRECTION_SCOPES[correction.scope],
            canonicalKey: correction.canonicalKey,
            ...changes,
          };
    const saved = await post(
      `/api/projects/${projectId}/intelligence/corrections`,
      body,
      "correcting",
      "Correction saved and locked.",
    );
    if (saved) {
      setEditing(null);
    }
  }

  const visible = section === "product" ? rows : rows.filter((row) => row.section === section);

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
            <Brain size={14} />
            Product intelligence
          </div>
          <h2 className="mt-2 text-lg font-semibold text-white">
            {summary.product?.name ?? "Not analyzed yet"}
          </h2>
          <p className="mt-1 text-xs text-[#777b84]">
            {total} entities ·{" "}
            {summary.lastRun
              ? `last run ${humanize(summary.lastRun.trigger)} ${summary.lastRun.status.toLowerCase()} at ${formatTime(summary.lastRun.completedAt ?? summary.lastRun.createdAt)}`
              : "no runs yet"}
            {summary.lastSnapshot
              ? ` · snapshot v${summary.lastSnapshot.version}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => runAnalysis("refresh")}
            disabled={busy !== null}
            variant="secondary"
          >
            <RefreshCw size={14} />
            {busy === "refresh" ? "Refreshing…" : "Refresh changed"}
          </Button>
          <Button
            type="button"
            onClick={() => runAnalysis("analyze")}
            disabled={busy !== null}
          >
            <Sparkles size={14} />
            {busy === "analyze" ? "Analyzing…" : "Analyze sources"}
          </Button>
        </div>
      </div>

      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
      {notice ? <p className="mt-4 text-sm text-emerald-300">{notice}</p> : null}

      <div className="mt-5 flex flex-wrap gap-1 border-b border-[#202329] pb-3">
        {SECTIONS.map((item) => {
          const count =
            item.id === "product"
              ? summary.product
                ? 1
                : 0
              : rows.filter((row) => row.section === item.id).length;
          const active = item.id === section;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={[
                "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                active
                  ? "bg-white text-black"
                  : "text-[#b4b7bf] hover:bg-[#15171c] hover:text-white",
              ].join(" ")}
            >
              {item.label}
              <span className={active ? "ml-1.5 text-black/60" : "ml-1.5 text-[#62666f]"}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 space-y-3">
        {visible.length === 0 ? (
          <EmptyState analyzed={Boolean(summary.lastRun)} />
        ) : (
          visible.map((row) => (
            <EntityRow
              key={row.id}
              row={row}
              open={editing === row.id}
              busy={busy !== null}
              onOpen={() => setEditing(row.id)}
              onClose={() => setEditing(null)}
              onSave={(changes) => save(row, changes)}
            />
          ))
        )}
      </div>

      {summary.lastRun?.errorMessage ? (
        <p className="mt-4 flex items-start gap-2 text-xs text-amber-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {summary.lastRun.errorCode}: {summary.lastRun.errorMessage}
        </p>
      ) : null}

      {runs.length > 1 || snapshots.length > 1 ? (
        <details className="mt-5 text-xs text-[#777b84]">
          <summary className="cursor-pointer select-none">Run and snapshot history</summary>
          <ul className="mt-2 space-y-1">
            {runs.map((run) => (
              <li key={run.id}>
                {humanize(run.trigger)} · {run.status.toLowerCase()} ·{" "}
                {run.provider ?? "deterministic"}
                {run.model ? ` (${run.model})` : ""} · {formatTime(run.createdAt)}
                {run.errorCode ? ` · ${run.errorCode}` : ""}
              </li>
            ))}
            {snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                snapshot v{snapshot.version} · {formatTime(snapshot.createdAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function EntityRow({
  row,
  open,
  busy,
  onOpen,
  onClose,
  onSave,
}: {
  row: Row;
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSave: (changes: Record<string, unknown>) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<CorrectionField[]>(row.correction?.fields ?? []);
  const initialSteps =
    row.correction?.fields.find((field) => field.kind === "steps")?.value ?? null;

  function update(key: string, value: string) {
    setDraft((current) =>
      current.map((field) => (field.key === key ? { ...field, value } : field)),
    );
  }

  function submit() {
    const changes: Record<string, unknown> = {};
    for (const field of draft) {
      if (field.kind === "steps") {
        if (field.value === initialSteps) continue;
        changes[field.key] = field.value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((action, order) => ({ order, action, description: null, featureIds: [] }));
        continue;
      }
      const value = field.kind === "enum" ? field.value : field.value.trim();
      if (value === "") continue;
      changes[field.key] = value;
    }
    if (Object.keys(changes).length === 0) {
      return;
    }
    onSave(changes);
  }

  return (
    <div className="rounded-xl border border-[#24272e] bg-[#0c0e11] p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-white">{row.title}</span>
            {row.locked ? <Lock size={12} className="text-sky-300" /> : null}
            {row.badges.map((badge) => (
              <Badge key={badge.label} label={badge.label} tone={badge.tone} />
            ))}
          </div>
          {row.subtitle ? (
            <p className="mt-1.5 text-xs text-[#9ea2ab]">{row.subtitle}</p>
          ) : null}
        </div>
        {!open && row.correction ? (
          <Button
            type="button"
            onClick={onOpen}
            variant="ghost"
            className="min-h-8 px-2.5 py-1 text-xs"
          >
            <Pencil size={12} />
            Correct
          </Button>
        ) : null}
      </div>

      {row.provenance.evidenceIds > 0 || row.provenance.sources > 0 ? (
        <p className="mt-2 text-[11px] text-[#62666f]">
          {row.provenance.evidenceIds} evidence · {row.provenance.sources} sources
          {row.provenance.method ? ` · ${humanize(row.provenance.method)}` : ""}
        </p>
      ) : null}

      {open ? (
        <div className="mt-3 space-y-3 border-t border-[#202329] pt-3">
          {draft.map((field) => (
            <label key={field.key} className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-[#62666f]">
                {field.label}
              </span>
              {field.kind === "enum" ? (
                <select
                  className={inputClassName}
                  value={field.value}
                  onChange={(event) => update(field.key, event.target.value)}
                >
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {humanize(option)}
                    </option>
                  ))}
                </select>
              ) : field.kind === "textarea" || field.kind === "steps" ? (
                <textarea
                  rows={field.kind === "steps" ? 4 : 2}
                  className={inputClassName}
                  value={field.value}
                  placeholder={field.kind === "steps" ? "One step action per line" : undefined}
                  onChange={(event) => update(field.key, event.target.value)}
                />
              ) : (
                <input
                  className={inputClassName}
                  value={field.value}
                  onChange={(event) => update(field.key, event.target.value)}
                />
              )}
            </label>
          ))}
          {initialSteps !== null ? (
            <p className="text-[11px] text-[#62666f]">
              Saving a changed step list replaces the current steps.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button type="button" onClick={submit} disabled={busy}>
              <BadgeCheck size={14} />
              Save correction
            </Button>
            <Button type="button" onClick={onClose} variant="secondary" disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Badge({ label, tone }: Badge) {
  return (
    <span
      className={[
        "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        TONES[tone],
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function EmptyState({ analyzed }: { analyzed: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-[#24272e] p-6 text-center">
      <p className="text-sm text-[#9ea2ab]">
        {analyzed ? "Nothing extracted yet." : "No analysis has run yet."}
      </p>
      <p className="mt-1 text-xs text-[#62666f]">
        {analyzed
          ? "Add a readable source, then run an analysis."
          : "Add a readable source, then analyze it."}
      </p>
    </div>
  );
}

function buildRows(graph: SerializedIntelligenceGraph, product: Product | null): Row[] {
  const rows: Row[] = [];

  if (product) {
    rows.push({
      id: product.id,
      section: "product",
      title: product.name ?? "Untitled product",
      subtitle: product.purpose ?? product.shortDescription ?? product.longDescription,
      badges: [
        confidenceBadge(product.confidence),
        assertionBadge(product.assertionKind),
        ...(product.category ? [neutralBadge(product.category)] : []),
      ],
      provenance: countProvenance(product.provenance),
      locked: product.userLocked,
      correction: {
        scope: "product",
        fields: [
          { key: "name", label: "Name", kind: "text", value: product.name ?? "" },
          {
            key: "shortDescription",
            label: "Short description",
            kind: "textarea",
            value: product.shortDescription ?? "",
          },
          {
            key: "valueProposition",
            label: "Value proposition",
            kind: "textarea",
            value: product.valueProposition ?? "",
          },
          {
            key: "targetUserSummary",
            label: "Target user",
            kind: "textarea",
            value: product.targetUserSummary ?? "",
          },
        ],
      },
    });
  }

  for (const item of graph.features) {
    rows.push({
      id: item.id,
      section: "features",
      title: item.name,
      subtitle: item.description,
      badges: [
        confidenceBadge(item.confidence),
        assertionBadge(item.assertionKind),
        neutralBadge(item.category),
        {
          label: humanize(item.importance),
          tone: item.importance === "PRIMARY" ? "good" : "neutral",
        },
      ],
      provenance: countProvenance(item.provenance),
      locked: item.userLocked,
      correction: {
        scope: "features",
        canonicalKey: item.canonicalKey,
        fields: [
          { key: "name", label: "Name", kind: "text", value: item.name },
          {
            key: "description",
            label: "Description",
            kind: "textarea",
            value: item.description ?? "",
          },
          {
            key: "category",
            label: "Category",
            kind: "enum",
            value: item.category,
            options: FEATURE_CATEGORIES,
          },
          {
            key: "importance",
            label: "Importance",
            kind: "enum",
            value: item.importance,
            options: IMPORTANCE_LEVELS,
          },
        ],
      },
    });
  }

  for (const item of graph.problems) {
    rows.push({
      id: item.id,
      section: "problems",
      title: item.name,
      subtitle: item.description,
      badges: [confidenceBadge(item.confidence), assertionBadge(item.assertionKind)],
      provenance: countProvenance(item.provenance),
      locked: item.userLocked,
      correction: {
        scope: "problems",
        canonicalKey: item.canonicalKey,
        fields: [
          { key: "name", label: "Name", kind: "text", value: item.name },
          {
            key: "description",
            label: "Description",
            kind: "textarea",
            value: item.description ?? "",
          },
        ],
      },
    });
  }

  for (const item of graph.benefits) {
    rows.push({
      id: item.id,
      section: "benefits",
      title: item.name,
      subtitle: item.description,
      badges: [confidenceBadge(item.confidence), assertionBadge(item.assertionKind)],
      provenance: countProvenance(item.provenance),
      locked: item.userLocked,
      correction: {
        scope: "benefits",
        canonicalKey: item.canonicalKey,
        fields: [
          { key: "name", label: "Name", kind: "text", value: item.name },
          {
            key: "description",
            label: "Description",
            kind: "textarea",
            value: item.description ?? "",
          },
        ],
      },
    });
  }

  for (const item of graph.claims) {
    rows.push({
      id: item.id,
      section: "claims",
      title: item.text,
      subtitle: item.conflictsWithClaimId ? "Conflicts with another claim" : null,
      badges: [
        confidenceBadge(item.confidence),
        assertionBadge(item.assertionKind),
        neutralBadge(item.claimType),
        verificationBadge(item.verification),
      ],
      provenance: countProvenance(item.provenance),
      locked: item.userLocked,
      correction: {
        scope: "claims",
        canonicalKey: item.canonicalKey,
        fields: [
          { key: "text", label: "Claim", kind: "textarea", value: item.text },
          {
            key: "claimType",
            label: "Type",
            kind: "enum",
            value: item.claimType,
            options: CLAIM_TYPES,
          },
          {
            key: "verification",
            label: "Verification",
            kind: "enum",
            value: item.verification,
            options: VERIFICATION_STATUSES,
          },
        ],
      },
    });
  }

  for (const item of graph.workflows) {
    rows.push({
      id: item.id,
      section: "workflows",
      title: item.name,
      subtitle: item.description ?? item.steps.map((step) => step.action).join(" → "),
      badges: [confidenceBadge(item.confidence), assertionBadge(item.assertionKind)],
      provenance: countProvenance(item.provenance),
      locked: item.userLocked,
      correction: {
        scope: "workflows",
        canonicalKey: item.canonicalKey,
        fields: [
          { key: "name", label: "Name", kind: "text", value: item.name },
          {
            key: "description",
            label: "Description",
            kind: "textarea",
            value: item.description ?? "",
          },
          {
            key: "steps",
            label: "Steps",
            kind: "steps",
            value: item.steps.map((step) => step.action).join("\n"),
          },
        ],
      },
    });
  }

  for (const item of graph.audienceSignals) {
    rows.push({
      id: item.id,
      section: "audienceSignals",
      title: item.segment,
      subtitle: item.description,
      badges: [
        confidenceBadge(item.confidence),
        assertionBadge(item.assertionKind),
        neutralBadge(item.kind),
      ],
      provenance: countProvenance(item.provenance),
      locked: item.userLocked,
      correction: {
        scope: "audienceSignals",
        canonicalKey: item.canonicalKey,
        fields: [
          { key: "segment", label: "Segment", kind: "text", value: item.segment },
          {
            key: "description",
            label: "Description",
            kind: "textarea",
            value: item.description ?? "",
          },
          {
            key: "kind",
            label: "Kind",
            kind: "enum",
            value: item.kind,
            options: AUDIENCE_SIGNAL_KINDS,
          },
        ],
      },
    });
  }

  for (const item of graph.brandSignals) {
    rows.push({
      id: item.id,
      section: "brandSignals",
      title: `${item.label}: ${item.value}`,
      subtitle: null,
      badges: [
        confidenceBadge(item.confidence),
        assertionBadge(item.assertionKind),
        neutralBadge(item.kind),
      ],
      provenance: countProvenance(item.provenance),
      locked: item.userLocked,
      correction: {
        scope: "brandSignals",
        canonicalKey: item.canonicalKey,
        fields: [
          { key: "label", label: "Label", kind: "text", value: item.label },
          { key: "value", label: "Value", kind: "text", value: item.value },
          {
            key: "kind",
            label: "Kind",
            kind: "enum",
            value: item.kind,
            options: BRAND_SIGNAL_KINDS,
          },
        ],
      },
    });
  }

  for (const item of graph.assets) {
    rows.push({
      id: item.id,
      section: "assets",
      title: item.name,
      subtitle:
        item.width && item.height
          ? `${item.width}×${item.height}`
          : item.durationMs
            ? `${(item.durationMs / 1000).toFixed(1)}s`
            : null,
      badges: [
        confidenceBadge(item.confidence),
        assertionBadge(item.assertionKind),
        neutralBadge(item.role),
        neutralBadge(item.mediaType),
      ],
      provenance: { evidenceIds: 0, sources: 1, method: null },
      locked: item.userLocked,
      correction: {
        scope: "assets",
        canonicalKey: item.canonicalKey,
        fields: [
          { key: "name", label: "Name", kind: "text", value: item.name },
          {
            key: "role",
            label: "Role",
            kind: "enum",
            value: item.role,
            options: ASSET_ROLES,
          },
        ],
      },
    });
  }

  for (const item of graph.evidence) {
    rows.push({
      id: item.id,
      section: "evidence",
      title: item.locator || humanize(item.kind),
      subtitle: item.excerpt,
      badges: [neutralBadge(item.kind)],
      provenance: { evidenceIds: 1, sources: 1, method: null },
      locked: false,
      correction: null,
    });
  }

  // Relationships are derived by the service, not authored by the user, so they
  // render read-only: this panel explains how extraction connected the graph
  // without ever offering a correction form for an edge.
  const labels = new Map<string, string>();
  for (const item of graph.features) labels.set(item.id, item.name);
  for (const item of graph.problems) labels.set(item.id, item.name);
  for (const item of graph.benefits) labels.set(item.id, item.name);
  for (const item of graph.workflows) labels.set(item.id, item.name);
  for (const item of graph.claims) labels.set(item.id, item.text);
  for (const item of graph.audienceSignals) labels.set(item.id, item.segment);
  for (const item of graph.brandSignals) labels.set(item.id, `${item.label}: ${item.value}`);
  for (const item of graph.assets) labels.set(item.id, item.name);
  // Evidence is the target end of every *_SUPPORTED_BY_EVIDENCE edge, so it needs
  // a readable name too; otherwise those rows would print raw row ids.
  for (const item of graph.evidence) {
    labels.set(item.id, truncateLabel(item.locator || humanize(item.kind)));
  }

  for (const edge of graph.relationships) {
    const from = labels.get(edge.fromId) ?? "Unknown entity";
    const to = labels.get(edge.toId) ?? "Unknown entity";
    rows.push({
      id: edge.id,
      section: "connections",
      title: `${from} ${humanize(edge.type)} ${to}`,
      subtitle: null,
      badges: [neutralBadge(edge.type)],
      provenance: { evidenceIds: 0, sources: 0, method: null },
      locked: false,
      correction: null,
    });
  }

  return rows;
}
