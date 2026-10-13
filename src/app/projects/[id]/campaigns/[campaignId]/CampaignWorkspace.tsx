"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../../../../components/ui/Button";
import type {
  CampaignDeliverableRecord,
  CampaignDetail,
  CampaignReadiness,
  CampaignRecord,
} from "../../../../../modules/campaign-engine/domain/types";

type CampaignWorkspaceProps = {
  projectId: string;
  initialCampaign: CampaignRecord;
  initialDeliverables: CampaignDeliverableRecord[];
  initialReadiness: CampaignReadiness;
};

const SEVERITY_CLASS: Record<string, string> = {
  BLOCKING: "text-red-300",
  WARNING: "text-amber-300",
  INFO: "text-[#777b84]",
};

export function CampaignWorkspace({
  projectId,
  initialCampaign,
  initialDeliverables,
  initialReadiness,
}: CampaignWorkspaceProps) {
  const router = useRouter();
  const [campaign, setCampaign] = useState(initialCampaign);
  const [deliverables, setDeliverables] =
    useState<CampaignDeliverableRecord[]>(initialDeliverables);
  const [readiness, setReadiness] = useState(initialReadiness);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const base = `/api/projects/${projectId}/campaigns/${initialCampaign.id}`;

  async function refreshReadiness() {
    const response = await fetch(`${base}/readiness`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (response.ok) {
      setReadiness((await response.json()) as CampaignReadiness);
    }
  }

  async function applyDetail(detail: CampaignDetail) {
    setCampaign(detail.campaign);
    setDeliverables(detail.deliverables);
    await refreshReadiness();
    router.refresh();
  }

  async function call(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<unknown | null> {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${path}`, {
        method: init.method ?? "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(init.body ?? {}),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(
          (payload && "error" in payload && payload.error) ||
            `Request failed (${response.status})`,
        );
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

  async function plan() {
    const result = await call(`${base}/plan`, {
      body: { expectedRevisionNumber: campaign.revisionNumber },
    });
    if (result) {
      await applyDetail(result as CampaignDetail);
      setNotice("Plan generated");
    }
  }

  async function scheduleAll() {
    const start = campaign.brief.launchWindow?.start ?? new Date().toISOString();
    const entries = deliverables.map((deliverable, index) => ({
      deliverableId: deliverable.id,
      scheduledFor: new Date(
        Date.parse(start) + index * 24 * 60 * 60 * 1000,
      ).toISOString(),
    }));
    const result = await call(`${base}/schedule`, {
      body: { expectedRevisionNumber: campaign.revisionNumber, entries },
    });
    if (result) await applyDetail(result as CampaignDetail);
  }

  async function transition(path: string, label: string) {
    const result = await call(`${base}/${path}`, {
      body: { expectedRevisionNumber: campaign.revisionNumber },
    });
    if (result) {
      await applyDetail(result as CampaignDetail);
      setNotice(label);
    }
  }

  async function setDeliverableStatus(
    deliverable: CampaignDeliverableRecord,
    status: "READY" | "BLOCKED",
  ) {
    const result = await call(`${base}/deliverables/${deliverable.id}`, {
      method: "PATCH",
      body: { expectedRevisionNumber: campaign.revisionNumber, status },
    });
    if (result) await applyDetail(result as CampaignDetail);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <section className="rounded-xl border border-[#202329] bg-[#101216] p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-[#62666f]">
              Lifecycle
            </p>
            <span
              className="rounded-full border border-[#30343c] px-2 py-0.5 text-[10px] uppercase tracking-wide text-white"
              data-testid="campaign-status"
            >
              {campaign.status}
            </span>
          </div>
          <p className="mt-2 text-xs text-[#777b84]">
            Revision {campaign.revisionNumber}
            {campaign.approvalHash
              ? ` · approved at ${campaign.approvalHash.slice(0, 8)}`
              : ""}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={plan}
              disabled={busy || campaign.status === "IN_REVIEW" || campaign.status === "APPROVED"}
              data-testid="plan-campaign"
            >
              Plan
            </Button>
            <Button
              variant="secondary"
              onClick={scheduleAll}
              disabled={busy || campaign.plan === null}
              data-testid="schedule-campaign"
            >
              Schedule
            </Button>
            <Button
              variant="secondary"
              onClick={() => transition("review", "Submitted for review")}
              disabled={busy || campaign.status !== "PLANNED"}
              data-testid="submit-review"
            >
              Submit for review
            </Button>
            <Button
              variant="secondary"
              onClick={() => transition("return", "Returned to planning")}
              disabled={busy || campaign.status !== "IN_REVIEW"}
              data-testid="return-campaign"
            >
              Return
            </Button>
            <Button
              onClick={() => transition("approve", "Approved")}
              disabled={busy || campaign.status !== "IN_REVIEW"}
              data-testid="approve-campaign"
            >
              Approve
            </Button>
            <Button
              onClick={() => transition("assemble", "Launch kit assembled")}
              disabled={busy || campaign.status !== "APPROVED"}
              data-testid="assemble-campaign"
            >
              Assemble
            </Button>
            <a
              href={`${base}/export`}
              data-testid="export-campaign"
              className={`inline-flex min-h-10 items-center justify-center rounded-lg border border-[#30343c] px-4 text-sm font-medium text-white hover:bg-[#1b1e24] ${
                campaign.hasLaunchKit ? "" : "pointer-events-none opacity-40"
              }`}
            >
              Export
            </a>
          </div>

          {error && (
            <p className="mt-3 text-xs text-red-300" data-testid="campaign-error">
              {error}
            </p>
          )}
          {notice && (
            <p className="mt-3 text-xs text-emerald-300" data-testid="campaign-notice">
              {notice}
            </p>
          )}
        </section>

        <div className="rounded-xl border border-[#202329] bg-[#101216] p-4">
          <p className="text-xs uppercase tracking-wide text-[#62666f]">
            Strategy
          </p>
          {campaign.strategy ? (
            <div className="mt-2 space-y-2 text-xs text-[#b4b7bf]">
              <p>
                <span className="text-[#62666f]">Positioning: </span>
                {campaign.strategy.positioning}
              </p>
              <p>
                <span className="text-[#62666f]">Key message: </span>
                {campaign.strategy.keyMessage}
              </p>
              <p className="text-[#62666f]">
                {campaign.strategy.phases.length} phase
                {campaign.strategy.phases.length === 1 ? "" : "s"} ·{" "}
                {campaign.strategy.platformIds.length} platform
                {campaign.strategy.platformIds.length === 1 ? "" : "s"}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-[#777b84]" data-testid="strategy-empty">
              No strategy yet. Run the plan to generate one.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-[#202329] bg-[#101216] p-4">
          <p className="text-xs uppercase tracking-wide text-[#62666f]">
            Deliverables
          </p>
          {initialDeliverables.length === 0 ? (
            <p
              className="mt-2 text-xs text-[#777b84]"
              data-testid="deliverable-empty"
            >
              No deliverables yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-2" data-testid="deliverable-list">
              {initialDeliverables.map((deliverable) => (
                <li
                  key={deliverable.id}
                  data-testid="deliverable-row"
                  data-deliverable-id={deliverable.id}
                  className="flex items-center justify-between rounded-lg border border-[#202329] px-3 py-2"
                >
                  <span>
                    <span className="block text-sm text-white">
                      {deliverable.title}
                    </span>
                    <span className="text-xs text-[#62666f]">
                      {deliverable.channel} · {deliverable.platformId} ·{" "}
                      {deliverable.status}
                      {deliverable.scheduledFor
                        ? ` · ${deliverable.scheduledFor}`
                        : ""}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setDeliverableStatus(deliverable, "READY")
                    }
                    disabled={busy}
                    data-testid="mark-deliverable-ready"
                  >
                    {deliverable.status === "READY" ? "Ready" : "Mark ready"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="h-fit rounded-xl border border-[#202329] bg-[#101216] p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-[#62666f]">
            Readiness
          </p>
          <span
            className="text-[10px] uppercase tracking-wide text-[#777b84]"
            data-testid="readiness-ready"
          >
            {readiness.ready ? "Ready" : "Not ready"}
          </span>
        </div>
        <p className="mt-2 text-xs text-[#777b84]" data-testid="readiness-summary">
          {readiness.summary.blocking} blocking · {readiness.summary.warning}{" "}
          warning · {readiness.summary.info} info
        </p>
        <ul className="mt-3 space-y-2">
          {readiness.checks.map((check, index) => (
            <li
              key={`${check.code}-${index}`}
              data-testid="readiness-check"
              data-check-code={check.code}
              data-severity={check.severity}
              className="rounded-lg border border-[#202329] px-3 py-2"
            >
              <p className={`text-xs ${SEVERITY_CLASS[check.severity] ?? "text-white"}`}>
                {check.message}
              </p>
              <p className="text-[10px] text-[#62666f]">
                {check.severity} · {check.remediation}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
