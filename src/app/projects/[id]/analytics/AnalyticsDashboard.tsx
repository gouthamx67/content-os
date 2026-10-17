"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Button } from "../../../../components/ui/Button";
import type { OptimizationRecommendationRecord } from "../../../../modules/publishing-engine/domain/types";
import type { AnalyticsOverview } from "../../../../modules/publishing-engine/analytics-service";

type AnalyticsDashboardProps = {
  projectId: string;
  initialOverview: AnalyticsOverview;
  initialRecommendations: OptimizationRecommendationRecord[];
};

type GenerateResult = {
  created?: OptimizationRecommendationRecord[];
  refreshed?: OptimizationRecommendationRecord[];
  skipped?: number;
  sampleSize?: number;
  minimumSampleSize?: number;
  error?: string;
};

export function AnalyticsDashboard({
  projectId,
  initialOverview,
  initialRecommendations,
}: AnalyticsDashboardProps) {
  const [overview, setOverview] = useState(initialOverview);
  const [recommendations, setRecommendations] = useState(initialRecommendations);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const loadOverview = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/analytics`, {
      credentials: "include",
    });
    if (!response.ok) return;
    setOverview((await response.json()) as AnalyticsOverview);
  }, [projectId]);

  const loadRecommendations = useCallback(async () => {
    const response = await fetch(
      `/api/projects/${projectId}/optimization/recommendations`,
      { credentials: "include" },
    );
    if (!response.ok) return;
    const payload = (await response.json()) as {
      recommendations: OptimizationRecommendationRecord[];
    };
    setRecommendations(payload.recommendations);
  }, [projectId]);

  async function refresh(publicationId: string) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const response = await fetch(
        `/api/projects/${projectId}/analytics/publications/${publicationId}/refresh`,
        { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "The refresh request failed");
        return;
      }
      setInfo("Collection requested. The worker is calling the provider now.");
    } catch {
      setError("The refresh request failed");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const response = await fetch(
        `/api/projects/${projectId}/optimization/recommendations`,
        { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" },
      );
      const payload = (await response.json().catch(() => null)) as GenerateResult | null;
      if (!response.ok) {
        setError(payload?.error ?? "Could not generate recommendations");
        return;
      }
      const createdCount = payload?.created?.length ?? 0;
      const refreshedCount = payload?.refreshed?.length ?? 0;
      setInfo(
        `Analyzed ${payload?.sampleSize ?? 0} measured posts: ${createdCount} new, ${refreshedCount} revived, ${payload?.skipped ?? 0} already reviewed.`,
      );
      await loadRecommendations();
    } catch {
      setError("Could not generate recommendations");
    } finally {
      setBusy(false);
    }
  }

  async function review(recommendationId: string, action: "accept" | "dismiss") {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const response = await fetch(
        `/api/projects/${projectId}/optimization/recommendations/${recommendationId}/${action}`,
        { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; recommendation?: OptimizationRecommendationRecord; publication?: { id: string } }
        | null;
      if (!response.ok) {
        setError(payload?.error ?? "The review failed");
        return;
      }
      await loadRecommendations();
      if (action === "accept") {
        setInfo(
          "Accepted. A new draft was created — validate and publish it from the publishing workspace when you are ready.",
        );
      }
    } catch {
      setError("The review failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {error ? (
        <p
          className="rounded-xl border border-[#3a1d1d] bg-[#180f0f] p-3 text-xs text-[#f87171]"
          data-testid="analytics-error"
        >
          {error}
        </p>
      ) : null}
      {info ? (
        <p
          className="rounded-xl border border-[#1d2b3a] bg-[#101820] p-3 text-xs text-[#7dd3fc]"
          data-testid="analytics-info"
        >
          {info}
        </p>
      ) : null}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-[#62666f]">
            Published posts
          </p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void loadOverview()}
            disabled={busy}
            data-testid="analytics-reload"
          >
            Reload
          </Button>
        </div>

        {overview.publications.length === 0 ? (
          <p
            className="rounded-xl border border-dashed border-[#30343c] p-6 text-xs text-[#777b84]"
            data-testid="analytics-empty"
          >
            Nothing has been published through this project yet, so there are no
            provider metrics to show.
          </p>
        ) : (
          <ul className="space-y-3">
            {overview.publications.map((entry) => (
              <li
                key={entry.publicationId}
                data-testid="analytics-row"
                data-publication-id={entry.publicationId}
                className="rounded-xl border border-[#202329] bg-[#101216] p-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-white">{entry.title}</p>
                    {entry.externalUrl ? (
                      <a
                        href={entry.externalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-[#7dd3fc] underline"
                      >
                        {entry.externalUrl}
                      </a>
                    ) : null}
                    <p className="text-[10px] text-[#62666f]">
                      Published {entry.publishedAt ?? "unknown"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => refresh(entry.publicationId)}
                    disabled={busy}
                    data-testid="analytics-refresh"
                  >
                    Refresh
                  </Button>
                </div>

                {entry.metrics.length === 0 ? (
                  <p
                    className="mt-2 rounded-lg bg-[#0b0d10] p-2 text-[10px] text-[#777b84]"
                    data-testid="analytics-unavailable"
                  >
                    No provider metrics collected yet. Missing metrics are shown
                    as unavailable, never as zero.
                  </p>
                ) : (
                  <>
                    <ul className="mt-2 grid gap-2 sm:grid-cols-3" data-testid="analytics-metrics">
                      {entry.metrics.map((metric) => (
                        <li
                          key={metric.metricKey}
                          data-metric={metric.metricKey}
                          className="rounded-lg bg-[#0b0d10] p-2"
                        >
                          <p className="text-[10px] uppercase tracking-wide text-[#62666f]">
                            {metric.metricKey}
                          </p>
                          <p className="text-lg text-white">{metric.value}</p>
                          <p className="text-[10px] text-[#62666f]">
                            {metric.unit} · {metric.provenance} · collected{" "}
                            {metric.collectedAt}
                          </p>
                          <p className="mt-1 text-[10px] text-[#777b84]">
                            {metric.definition}
                          </p>
                        </li>
                      ))}
                    </ul>
                    {entry.engagement ? (
                      <p
                        className="mt-2 text-[10px] text-[#9ca3af]"
                        data-testid="analytics-engagement"
                      >
                        Engagement {entry.engagement.value} ·{" "}
                        {entry.engagement.formula} · collected{" "}
                        {entry.engagement.collectedAt}
                      </p>
                    ) : (
                      <p
                        className="mt-2 text-[10px] text-[#777b84]"
                        data-testid="analytics-engagement-unavailable"
                      >
                        Engagement is unavailable: not every constituent metric
                        was collected, and a partial sum would be misleading.
                      </p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-[#62666f]">
            Optimization recommendations
          </p>
          <Button
            type="button"
            onClick={generate}
            disabled={busy}
            data-testid="recommendations-generate"
          >
            Generate
          </Button>
        </div>

        {recommendations.length === 0 ? (
          <p
            className="rounded-xl border border-dashed border-[#30343c] p-6 text-xs text-[#777b84]"
            data-testid="recommendations-empty"
          >
            No recommendations yet. Analysis needs at least three published posts
            with complete engagement readings before it will compare anything.
          </p>
        ) : (
          <ul className="space-y-3">
            {recommendations.map((recommendation) => (
              <li
                key={recommendation.id}
                data-testid="recommendation-card"
                data-category={recommendation.category}
                data-status={recommendation.status}
                className="rounded-xl border border-[#202329] bg-[#101216] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-white">{recommendation.title}</p>
                  <span className="rounded-full bg-[#202329] px-2 py-1 text-[10px] text-[#9ca3af]">
                    {recommendation.category} · {recommendation.confidence} ·{" "}
                    {recommendation.status}
                  </span>
                </div>
                <p className="mt-2 text-xs text-[#9ca3af]">
                  {recommendation.explanation}
                </p>
                <div
                  className="mt-2 rounded-lg bg-[#0b0d10] p-2"
                  data-testid="recommendation-evidence"
                >
                  <p className="text-[10px] text-[#62666f]">Evidence</p>
                  <p className="text-[10px] text-[#9ca3af]">
                    {recommendation.evidence.comparison}
                  </p>
                  <p className="mt-1 text-[10px] text-[#777b84]">
                    observed {recommendation.evidence.observedValue} vs{" "}
                    {recommendation.evidence.baselineLabel}{" "}
                    {recommendation.evidence.baselineValue} · sample{" "}
                    {recommendation.evidence.sampleSize}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {recommendation.evidence.items.slice(0, 6).map((item, index) => (
                      <li
                        key={`${item.publicationId}-${item.metricKey}-${index}`}
                        className="text-[10px] text-[#62666f]"
                      >
                        {item.metricKey} {item.value} · {item.publicationId}
                        {item.collectedAt ? ` · collected ${item.collectedAt}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="mt-2 text-[10px] text-[#777b84]">
                  {recommendation.confidenceRationale} {recommendation.limitations}
                </p>
                <p className="mt-2 text-[10px] text-[#9ca3af]">
                  {recommendation.suggestedAction}
                </p>
                {recommendation.status === "OPEN" ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      type="button"
                      onClick={() => review(recommendation.id, "accept")}
                      disabled={busy}
                      data-testid="recommendation-accept"
                    >
                      Accept as draft
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => review(recommendation.id, "dismiss")}
                      disabled={busy}
                      data-testid="recommendation-dismiss"
                    >
                      Dismiss
                    </Button>
                  </div>
                ) : null}
                {recommendation.resultPublicationId ? (
                  <Link
                    href={`/projects/${projectId}/publishing`}
                    data-testid="recommendation-result"
                    className="mt-2 block text-[10px] text-[#7dd3fc] underline"
                  >
                    Draft {recommendation.resultPublicationId} created — review it
                    in the publishing workspace.
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
