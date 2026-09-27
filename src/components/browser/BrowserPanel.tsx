"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, Globe, Loader2, Play, XCircle } from "lucide-react";
import { parseSuccessCriteria } from "../../core/domain/browser";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

/**
 * Browser agent panel: start a task against a project source, then read the
 * step-by-step trace. The panel is read-mostly — it can start and cancel runs,
 * but it never edits an action, because actions are validated server-side and
 * are not free-form.
 */

export type BrowserSessionSummary = {
  id: string;
  projectId: string;
  targetSourceId: string;
  targetClass: "PUBLIC" | "CONTROLLED_LOCAL";
  initialUrl: string;
  currentUrl: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  goal: string | null;
  successCriteria: string | null;
  startedAt: string | null;
  endedAt: string | null;
  pageCount: number;
  actionCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BrowserTraceStep = {
  order: number;
  actionType: string;
  targetSummary: string | null;
  inputSummary: string | null;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
  durationMs: number | null;
  result: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type BrowserObservation = {
  id: string;
  stepOrder: number;
  url: string;
  title: string;
  createdAt: string;
  payload: {
    url?: string;
    title?: string;
    pageText?: string;
    forms?: { testId?: string | null; name?: string | null; fields: { name: string; type: string; value: string }[] }[];
    interactiveElements?: { kind: string; role: string; name: string; enabled: boolean }[];
  } | null;
};

export type BrowserSourceOption = {
  id: string;
  name: string;
  uri: string | null;
};

const STATUS_STYLES: Record<BrowserSessionSummary["status"], string> = {
  QUEUED: "text-[#8b93a7] border-[#30343c]",
  RUNNING: "text-[#7fb3ff] border-[#2b4a7a]",
  COMPLETED: "text-[#5fd08a] border-[#2c5a41]",
  FAILED: "text-[#ff8a8a] border-[#6b2f2f]",
  CANCELLED: "text-[#c9a227] border-[#5c4a12]",
};

function StatusPill({ status }: { status: BrowserSessionSummary["status"] }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

export function BrowserPanel({
  projectId,
  sources,
  initialSessions,
}: {
  projectId: string;
  sources: BrowserSourceOption[];
  initialSessions: BrowserSessionSummary[];
}) {
  // The first paint is server-rendered; the panel only refetches in response to
  // a user action, so it needs no client effects.
  const [sessions, setSessions] = useState<BrowserSessionSummary[]>(initialSessions);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [steps, setSteps] = useState<BrowserTraceStep[]>([]);
  const [observations, setObservations] = useState<BrowserObservation[]>([]);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [url, setUrl] = useState(sources[0]?.uri ?? "");
  const [goal, setGoal] = useState("");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/browser/sessions`, { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { sessions: BrowserSessionSummary[] };
    setSessions(data.sessions);
  }, [projectId]);

  const loadTrace = useCallback(
    async (sessionId: string) => {
      const response = await fetch(`/api/projects/${projectId}/browser/sessions/${sessionId}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as { trace: { steps: BrowserTraceStep[] } | null };
      setSteps(data.trace?.steps ?? []);
    },
    [projectId],
  );

  const loadObservations = useCallback(
    async (sessionId: string) => {
      const response = await fetch(
        `/api/projects/${projectId}/browser/sessions/${sessionId}/observations?limit=20`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setObservations([]);
        return;
      }
      const data = (await response.json()) as { observations: BrowserObservation[] };
      setObservations(data.observations ?? []);
    },
    [projectId],
  );

  // A source selection seeds the target URL; the user can still override it.
  function selectSource(nextSourceId: string) {
    setSourceId(nextSourceId);
    const source = sources.find((candidate) => candidate.id === nextSourceId);
    if (source?.uri) setUrl(source.uri);
  }

  async function selectSession(sessionId: string) {
    setSelectedId(sessionId);
    setObservations([]);
    await loadTrace(sessionId);
    await loadObservations(sessionId);
  }

  async function runTask() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/browser/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetSourceId: sourceId,
          url,
          goal,
          successCriteria: successCriteria || null,
        }),
      });
      const data = (await response.json()) as { session?: BrowserSessionSummary; error?: string };
      if (!response.ok || !data.session) {
        setError(data.error ?? "Could not start the browser task");
        return;
      }
      await selectSession(data.session.id);
      await loadSessions();
    } catch {
      setError("Could not reach the browser agent");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(sessionId: string) {
    setBusy(true);
    try {
      await fetch(`/api/projects/${projectId}/browser/sessions/${sessionId}/cancel`, { method: "POST" });
      await loadSessions();
      await loadTrace(sessionId);
    } finally {
      setBusy(false);
    }
  }

  // Criteria are verified server-side against the final page; the count here is
  // only a hint so the goal is not written in a form that silently cannot pass.
  const checkableCount = useMemo(
    () => parseSuccessCriteria(successCriteria).length,
    [successCriteria],
  );

  const canRun = sourceId.length > 0 && url.startsWith("http") && goal.trim().length > 0 && !busy;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe size={18} className="text-[#8b93a7]" />
          <h2 className="text-lg font-semibold text-white">Browser Agent</h2>
        </div>
        <span className="text-xs text-[#8b93a7]">{sessions.length} session(s)</span>
      </div>

      <p className="mt-2 text-sm text-[#8b93a7]">
        Runs a real browser against a project target: observes the page, plans from a closed action set, acts,
        and verifies the result. Internal and private addresses are refused.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-[#8b93a7]">
          Target source
          <select
            value={sourceId}
            onChange={(event) => selectSource(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-sm text-white"
          >
            {sources.length === 0 ? <option value="">No sources yet</option> : null}
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs text-[#8b93a7]">
          Start URL
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com"
            className="mt-1 w-full rounded-lg border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-sm text-white"
          />
        </label>

        <label className="block text-xs text-[#8b93a7]">
          Goal
          <input
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="Create a project named Q3 Launch"
            className="mt-1 w-full rounded-lg border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-sm text-white"
          />
        </label>

        <label className="block text-xs text-[#8b93a7]">
          Success criteria (optional)
          <input
            value={successCriteria}
            onChange={(event) => setSuccessCriteria(event.target.value)}
            placeholder={'text contains "created" and url contains "/projects"'}
            className="mt-1 w-full rounded-lg border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-sm text-white"
          />
          {successCriteria.trim() ? (
            <span className="mt-1 block text-[11px] text-[#6d7689]">
              {checkableCount > 0
                ? `${checkableCount} criterion${checkableCount === 1 ? "" : "ia"} checked automatically against the final page; anything else must be backed by a passing assertion.`
                : "Free text: the run only succeeds if a page assertion also passes."}
            </span>
          ) : null}
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => void runTask()} disabled={!canRun}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Run task
        </Button>
        {selectedId && sessions.find((session) => session.id === selectedId)?.status === "RUNNING" ? (
          <Button variant="secondary" onClick={() => void cancel(selectedId)} disabled={busy}>
            <Ban size={14} />
            Cancel
          </Button>
        ) : null}
        {error ? (
          <span className="flex items-center gap-1 text-xs text-[#ff8a8a]">
            <AlertTriangle size={12} />
            {error}
          </span>
        ) : null}
      </div>

      {sessions.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-white">Sessions</h3>
          <ul className="mt-2 space-y-1">
            {sessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => void selectSession(session.id)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs ${
                    selectedId === session.id ? "border-[#4a5162] bg-[#15171c]" : "border-transparent"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[#d7dae0]">{session.goal ?? session.initialUrl}</span>
                    {session.status !== "RUNNING" && session.status !== "QUEUED" && session.errorMessage ? (
                      <span className="mt-0.5 block truncate text-[#ff8a8a]">
                        {session.errorCode}: {session.errorMessage}
                      </span>
                    ) : null}
                  </span>
                  <span className="ml-3 flex shrink-0 items-center gap-2">
                    <span className="text-[#8b93a7]">
                      {session.actionCount} action(s)
                    </span>
                    <StatusPill status={session.status} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {selectedId ? (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-white">Interaction trace</h3>
          {steps.length === 0 ? (
            <p className="mt-2 text-xs text-[#8b93a7]">No steps recorded.</p>
          ) : (
            <ol className="mt-2 space-y-1">
              {steps.map((step) => (
                <li
                  key={step.order}
                  className="flex items-start gap-2 rounded-lg border border-[#1d2027] px-3 py-2 text-xs"
                >
                  <span className="w-6 shrink-0 text-[#8b93a7]">{step.order}</span>
                  {step.status === "FAILED" ? (
                    <XCircle size={13} className="mt-0.5 shrink-0 text-[#ff8a8a]" />
                  ) : (
                    <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-[#5fd08a]" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-[#d7dae0]">{step.actionType}</span>
                    {step.targetSummary ? (
                      <span className="text-[#8b93a7]"> {step.targetSummary}</span>
                    ) : null}
                    {step.errorMessage ? (
                      <span className="mt-1 block text-[#ff8a8a]">
                        {step.errorCode}: {step.errorMessage}
                      </span>
                    ) : null}
                    {step.result ? (
                      <span className="mt-1 block truncate text-[#8b93a7]">{step.result}</span>
                    ) : null}
                  </span>
                  {step.durationMs !== null ? (
                    <span className="shrink-0 text-[#8b93a7]">{step.durationMs}ms</span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}

          <h3 className="mt-5 text-sm font-medium text-white">Page observations</h3>
          {observations.length === 0 ? (
            <p className="mt-2 text-xs text-[#8b93a7]">No observations recorded.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {observations.map((observation) => {
                const page = observation.payload;
                const elements = page?.interactiveElements ?? [];
                return (
                  <li
                    key={observation.id}
                    className="rounded-lg border border-[#1d2027] px-3 py-2 text-xs"
                  >
                    <span className="font-medium text-[#d7dae0]">
                      step {observation.stepOrder}: {observation.title || "(untitled)"}
                    </span>
                    <span className="mt-1 block truncate text-[#8b93a7]">{observation.url}</span>
                    <span className="mt-1 block text-[#8b93a7]">
                      {elements.length} control{elements.length === 1 ? "" : "s"}
                      {elements
                        .slice(0, 6)
                        .map((element) => element.name)
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                    {page?.pageText ? (
                      <span className="mt-1 block truncate text-[#6d7689]">{page.pageText}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </Card>
  );
}
