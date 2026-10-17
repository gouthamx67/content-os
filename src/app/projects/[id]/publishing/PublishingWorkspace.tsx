"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "../../../../components/ui/Button";
import type {
  PublicationRecord,
  PublishingConnectionRecord,
  ValidationFinding,
} from "../../../../modules/publishing-engine/domain/types";
import type { PublishAttemptRecord } from "../../../../modules/publishing-engine/domain/types";

type ProviderCatalogEntry = {
  id: string;
  displayName: string;
  capabilities: readonly string[];
};

type PublishingWorkspaceProps = {
  projectId: string;
  initialConnections: PublishingConnectionRecord[];
  initialPublications: PublicationRecord[];
  providers: ProviderCatalogEntry[];
  cryptoProblem: string | null;
  writingOptions: { id: string; title: string }[];
  deliverableOptions: { id: string; title: string }[];
  notice: string | null;
};

type PublicationDetail = {
  publication: PublicationRecord;
  attempts: PublishAttemptRecord[];
};

const POLLING_STATUSES = new Set(["QUEUED", "PUBLISHING"]);

function statusClass(status: string): string {
  if (status === "PUBLISHED") return "bg-[#123024] text-[#4ade80]";
  if (status === "READY") return "bg-[#1d2b3a] text-[#7dd3fc]";
  if (status === "FAILED" || status === "AUTH_REQUIRED") {
    return "bg-[#3a1d1d] text-[#f87171]";
  }
  if (status === "AMBIGUOUS" || status === "STALE") {
    return "bg-[#3a311d] text-[#fbbf24]";
  }
  return "bg-[#202329] text-[#9ca3af]";
}

export function PublishingWorkspace({
  projectId,
  initialConnections,
  initialPublications,
  providers,
  cryptoProblem,
  writingOptions,
  deliverableOptions,
  notice,
}: PublishingWorkspaceProps) {
  const router = useRouter();
  const [connections, setConnections] = useState(initialConnections);
  const [publications, setPublications] = useState(initialPublications);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PublicationDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState(notice ?? "");

  const [connectionId, setConnectionId] = useState(
    initialConnections.find((entry) => entry.status === "CONNECTED")?.id ?? "",
  );
  const [sourceType, setSourceType] = useState("WRITING_DOCUMENT");
  const [sourceId, setSourceId] = useState(writingOptions[0]?.id ?? "");
  const [scheduledFor, setScheduledFor] = useState("");
  const [timezone, setTimezone] = useState("UTC");

  const connected = connections.filter((entry) => entry.status === "CONNECTED");
  const optionList = sourceType === "WRITING_DOCUMENT" ? writingOptions : deliverableOptions;
  const shouldPoll = publications.some((entry) => POLLING_STATUSES.has(entry.status));

  const loadPublications = useCallback(async () => {
    const response = await fetch(
      `/api/projects/${projectId}/publishing/publications`,
      { credentials: "include" },
    );
    if (!response.ok) return;
    const payload = (await response.json()) as { publications: PublicationRecord[] };
    setPublications(payload.publications);
  }, [projectId]);

  const loadDetail = useCallback(
    async (publicationId: string) => {
      const response = await fetch(
        `/api/projects/${projectId}/publishing/publications/${publicationId}`,
        { credentials: "include" },
      );
      const payload = (await response.json().catch(() => null)) as
        | PublicationDetail
        | { error?: string }
        | null;
      if (!response.ok || !payload || !("publication" in payload)) {
        setError(
          payload && "error" in payload && payload.error
            ? payload.error
            : "Could not load the publication",
        );
        return;
      }
      setDetail(payload);
    },
    [projectId],
  );

  useEffect(() => {
    if (!shouldPoll) return;
    const timer = setInterval(() => {
      void loadPublications();
      if (selectedId) void loadDetail(selectedId);
    }, 2500);
    return () => clearInterval(timer);
  }, [shouldPoll, loadPublications, loadDetail, selectedId]);

  async function post(url: string, body?: unknown): Promise<unknown | null> {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; findings?: ValidationFinding[] }
        | null;
      if (!response.ok) {
        setError(payload?.error ?? "Request failed");
        if (payload?.findings) {
          setDetail((current) =>
            current
              ? {
                  ...current,
                  publication: {
                    ...current.publication,
                    validation: payload.findings ?? null,
                  },
                }
              : current,
          );
        }
        return null;
      }
      return payload;
    } catch {
      setError("Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  function selectPublication(publicationId: string) {
    setSelectedId(publicationId);
    void loadDetail(publicationId);
  }

  async function connect(providerId: string) {
    const payload = (await post(
      `/api/projects/${projectId}/publishing/connections`,
      { providerId },
    )) as { authorizationUrl?: string } | null;
    if (payload?.authorizationUrl) {
      window.location.assign(payload.authorizationUrl);
    }
  }

  async function connectionAction(connectionIdValue: string, action: "verify" | "disconnect") {
    const payload = (await post(
      `/api/projects/${projectId}/publishing/connections/${connectionIdValue}/${action}`,
    )) as { connection?: PublishingConnectionRecord } | null;
    if (payload?.connection) {
      setConnections((current) =>
        current.map((entry) =>
          entry.id === payload.connection!.id ? payload.connection! : entry,
        ),
      );
    }
  }

  async function createPublication(event: React.FormEvent) {
    event.preventDefault();
    if (!connectionId || !sourceId) {
      setError("Choose a connected destination and a source.");
      return;
    }
    const payload = (await post(
      `/api/projects/${projectId}/publishing/publications`,
      { connectionId, sourceType, sourceId },
    )) as { publication?: PublicationRecord } | null;
    if (payload?.publication) {
      setPublications((current) => [payload.publication!, ...current]);
      selectPublication(payload.publication.id);
      setBanner("");
      router.refresh();
    }
  }

  async function publicationAction(
    publicationId: string,
    action: "validate" | "publish" | "unschedule" | "cancel" | "retry" | "reconcile",
  ) {
    const payload = (await post(
      `/api/projects/${projectId}/publishing/publications/${publicationId}/${action}`,
    )) as { publication?: PublicationRecord } | null;
    if (payload?.publication) {
      replacePublication(payload.publication);
    }
    await loadDetail(publicationId);
    await loadPublications();
  }

  async function schedulePublication(publicationId: string) {
    if (!scheduledFor) {
      setError("Pick a date and time to schedule.");
      return;
    }
    const iso = new Date(scheduledFor).toISOString();
    const payload = (await post(
      `/api/projects/${projectId}/publishing/publications/${publicationId}/schedule`,
      { scheduledFor: iso, timezone: timezone || "UTC" },
    )) as { publication?: PublicationRecord } | null;
    if (payload?.publication) {
      replacePublication(payload.publication);
    }
    await loadDetail(publicationId);
    await loadPublications();
  }

  async function refreshAnalytics(publicationId: string) {
    await post(
      `/api/projects/${projectId}/analytics/publications/${publicationId}/refresh`,
    );
    await loadPublications();
  }

  function replacePublication(publication: PublicationRecord) {
    setPublications((current) =>
      current.map((entry) => (entry.id === publication.id ? publication : entry)),
    );
  }

  const selected = detail?.publication;
  const selectedConnection = useMemo(
    () => connections.find((entry) => entry.id === selected?.connectionId),
    [connections, selected?.connectionId],
  );

  return (
    <div className="space-y-6">
      {cryptoProblem ? (
        <p
          className="rounded-xl border border-[#3a311d] bg-[#1a1710] p-3 text-xs text-[#fbbf24]"
          data-testid="publishing-secrets-warning"
        >
          Credentials cannot be stored or read on this deployment: {cryptoProblem}.
          Connect and publish actions stay unavailable until the key is configured.
        </p>
      ) : null}
      {banner ? (
        <p
          className="rounded-xl border border-[#1d2b3a] bg-[#101820] p-3 text-xs text-[#7dd3fc]"
          data-testid="publishing-notice"
        >
          {banner}
        </p>
      ) : null}
      {error ? (
        <p
          className="rounded-xl border border-[#3a1d1d] bg-[#180f0f] p-3 text-xs text-[#f87171]"
          data-testid="publishing-error"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="space-y-6">
          <div>
            <p className="mb-3 text-xs uppercase tracking-wide text-[#62666f]">
              Destinations
            </p>
            {connections.length === 0 ? (
              <p
                className="rounded-xl border border-dashed border-[#30343c] p-6 text-xs text-[#777b84]"
                data-testid="connections-empty"
              >
                {providers.length === 0
                  ? "No publishing provider is configured on this deployment."
                  : "No destination connected yet."}
              </p>
            ) : (
              <ul className="space-y-2" data-testid="connection-list">
                {connections.map((connection) => (
                  <li
                    key={connection.id}
                    data-testid="connection-row"
                    data-status={connection.status}
                    className="flex items-center justify-between rounded-xl border border-[#202329] bg-[#101216] px-4 py-3"
                  >
                    <span>
                      <span className="block text-sm text-white">
                        {connection.displayName}
                      </span>
                      <span className="text-xs text-[#62666f]">
                        {connection.providerId} · {connection.status}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => connectionAction(connection.id, "verify")}
                        disabled={busy}
                        data-testid="connection-verify"
                      >
                        Verify
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => connectionAction(connection.id, "disconnect")}
                        disabled={busy}
                        data-testid="connection-disconnect"
                      >
                        Disconnect
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {providers.filter(
              (provider) =>
                !connected.some((entry) => entry.providerId === provider.id),
            ).length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {providers
                  .filter(
                    (provider) =>
                      !connected.some((entry) => entry.providerId === provider.id),
                  )
                  .map((provider) => (
                    <Button
                      key={provider.id}
                      type="button"
                      onClick={() => connect(provider.id)}
                      disabled={busy || cryptoProblem !== null}
                      data-testid={`connect-${provider.id}`}
                    >
                      Connect {provider.displayName}
                    </Button>
                  ))}
              </div>
            ) : null}
          </div>

          <div>
            <p className="mb-3 text-xs uppercase tracking-wide text-[#62666f]">
              Publications
            </p>
            {publications.length === 0 ? (
              <p
                className="rounded-xl border border-dashed border-[#30343c] p-6 text-xs text-[#777b84]"
                data-testid="publishing-empty"
              >
                No publications yet.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="publishing-list">
                {publications.map((publication) => (
                  <li key={publication.id}>
                    <button
                      type="button"
                      onClick={() => selectPublication(publication.id)}
                      data-testid="publishing-row"
                      data-publication-id={publication.id}
                      data-status={publication.status}
                      className="flex w-full items-center justify-between rounded-xl border border-[#202329] bg-[#101216] px-4 py-3 text-left hover:border-[#30343c]"
                    >
                      <span>
                        <span className="block text-sm text-white">
                          {publication.title}
                        </span>
                        <span className="text-xs text-[#62666f]">
                          {publication.sourceType} · {publication.sourceRevision}
                          {publication.externalPostId
                            ? ` · post ${publication.externalPostId}`
                            : ""}
                        </span>
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] ${statusClass(publication.status)}`}
                      >
                        {publication.status}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="space-y-6">
          <form
            onSubmit={createPublication}
            className="rounded-xl border border-[#202329] bg-[#101216] p-4"
            data-testid="publication-create-form"
          >
            <p className="text-xs uppercase tracking-wide text-[#62666f]">
              New publication
            </p>

            <label className="mt-3 block text-[10px] text-[#777b84]">
              Destination
              <select
                value={connectionId}
                onChange={(event) => setConnectionId(event.target.value)}
                data-testid="publication-connection"
                className="mt-1 w-full rounded-lg border border-[#202329] bg-[#0b0d10] px-3 py-2 text-xs text-white"
              >
                <option value="">Choose a connected destination</option>
                {connected.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.displayName}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block text-[10px] text-[#777b84]">
              Source type
              <select
                value={sourceType}
                onChange={(event) => {
                  setSourceType(event.target.value);
                  setSourceId("");
                }}
                data-testid="publication-source-type"
                className="mt-1 w-full rounded-lg border border-[#202329] bg-[#0b0d10] px-3 py-2 text-xs text-white"
              >
                <option value="WRITING_DOCUMENT">Writing document</option>
                <option value="CAMPAIGN_DELIVERABLE">Campaign deliverable</option>
              </select>
            </label>

            <label className="mt-3 block text-[10px] text-[#777b84]">
              Source
              <select
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
                data-testid="publication-source"
                className="mt-1 w-full rounded-lg border border-[#202329] bg-[#0b0d10] px-3 py-2 text-xs text-white"
              >
                <option value="">Choose a source</option>
                {optionList.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                  </option>
                ))}
              </select>
            </label>

            <Button
              type="submit"
              className="mt-4 w-full"
              disabled={busy || !connectionId || !sourceId}
              data-testid="publication-create"
            >
              Create draft
            </Button>
          </form>

          {selected ? (
            <div
              className="rounded-xl border border-[#202329] bg-[#101216] p-4"
              data-testid="publication-detail"
              data-status={selected.status}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm text-white">{selected.title}</p>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] ${statusClass(selected.status)}`}
                  data-testid="publication-status"
                >
                  {selected.status}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-[#62666f]">
                {selectedConnection
                  ? `Destination: ${selectedConnection.displayName}`
                  : "Destination: unknown"}{" "}
                · Hash {selected.sourceHash.slice(0, 10)}…
              </p>
              {selected.externalUrl ? (
                <a
                  href={selected.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="publication-external-url"
                  className="mt-1 block text-xs text-[#7dd3fc] underline"
                >
                  {selected.externalUrl}
                </a>
              ) : null}
              {selected.scheduledFor ? (
                <p className="mt-1 text-[10px] text-[#fbbf24]">
                  Scheduled {selected.scheduledFor} ({selected.scheduledTimezone})
                </p>
              ) : null}
              {selected.lastErrorCode ? (
                <p className="mt-2 rounded-lg bg-[#180f0f] p-2 text-[10px] text-[#f87171]">
                  {selected.lastErrorCode}: {selected.lastErrorMessage}
                </p>
              ) : null}

              {selected.validation && selected.validation.length > 0 ? (
                <ul className="mt-2 space-y-1" data-testid="publication-findings">
                  {selected.validation.map((finding, index) => (
                    <li
                      key={`${finding.code}-${index}`}
                      data-severity={finding.severity}
                      className={`rounded-lg p-2 text-[10px] ${
                        finding.severity === "ERROR"
                          ? "bg-[#180f0f] text-[#f87171]"
                          : "bg-[#1a1710] text-[#fbbf24]"
                      }`}
                    >
                      [{finding.severity}] {finding.code}: {finding.message}
                      {finding.remediation ? ` — ${finding.remediation}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => publicationAction(selected.id, "validate")}
                  disabled={busy}
                  data-testid="publication-validate"
                >
                  Validate
                </Button>
                <Button
                  type="button"
                  onClick={() => publicationAction(selected.id, "publish")}
                  disabled={busy || selected.status !== "READY"}
                  data-testid="publication-publish"
                >
                  Publish now
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => publicationAction(selected.id, "cancel")}
                  disabled={busy}
                  data-testid="publication-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => publicationAction(selected.id, "retry")}
                  disabled={busy || selected.status !== "FAILED"}
                  data-testid="publication-retry"
                >
                  Retry
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => publicationAction(selected.id, "reconcile")}
                  disabled={busy || selected.status !== "AMBIGUOUS"}
                  data-testid="publication-reconcile"
                >
                  Reconcile
                </Button>
                {selected.status === "PUBLISHED" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => refreshAnalytics(selected.id)}
                    disabled={busy}
                    data-testid="publication-refresh-analytics"
                  >
                    Refresh analytics
                  </Button>
                ) : null}
              </div>

              <div className="mt-3 rounded-lg border border-[#202329] p-2">
                <p className="text-[10px] text-[#777b84]">Schedule</p>
                <div className="mt-1 flex gap-2">
                  <input
                    type="datetime-local"
                    value={scheduledFor}
                    onChange={(event) => setScheduledFor(event.target.value)}
                    data-testid="publication-schedule-at"
                    className="w-full rounded-lg border border-[#202329] bg-[#0b0d10] px-2 py-1 text-[10px] text-white"
                  />
                  <input
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    data-testid="publication-schedule-zone"
                    className="w-28 rounded-lg border border-[#202329] bg-[#0b0d10] px-2 py-1 text-[10px] text-white"
                  />
                </div>
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => schedulePublication(selected.id)}
                    disabled={busy || selected.status !== "READY"}
                    data-testid="publication-schedule"
                  >
                    Schedule
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => publicationAction(selected.id, "unschedule")}
                    disabled={busy || selected.status !== "SCHEDULED"}
                    data-testid="publication-unschedule"
                  >
                    Unschedule
                  </Button>
                </div>
              </div>

              <div className="mt-3">
                <p className="text-[10px] text-[#777b84]">Attempts</p>
                {(detail?.attempts ?? []).length === 0 ? (
                  <p
                    className="mt-1 text-[10px] text-[#62666f]"
                    data-testid="publication-attempts-empty"
                  >
                    No provider attempts yet.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-1" data-testid="publication-attempts">
                    {(detail?.attempts ?? []).map((attempt) => (
                      <li
                        key={attempt.id}
                        data-outcome={attempt.outcome}
                        className="rounded-lg bg-[#0b0d10] p-2 text-[10px] text-[#9ca3af]"
                      >
                        #{attempt.attemptNumber} {attempt.outcome}
                        {attempt.errorCode ? ` · ${attempt.errorCode}` : ""}
                        {attempt.providerRequestId
                          ? ` · request ${attempt.providerRequestId}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Link
                href={`/projects/${projectId}/analytics`}
                className="mt-3 block text-[10px] text-[#7dd3fc] underline"
              >
                Open analytics
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
