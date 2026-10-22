"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Compass,
  ExternalLink,
  Layers3,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
} from "lucide-react";
import type {
  SocialStrategy,
  StrategyEvidenceLevel,
  StrategyPlatformRole,
  StrategyTrendLayer,
} from "../../modules/strategy-engine/domain/types";
import { strategyEvidenceLabel } from "../../modules/strategy-engine/domain/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

const EVIDENCE_STYLES: Record<StrategyEvidenceLevel, string> = {
  MEASURED: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  GROUNDED: "border-sky-500/25 bg-sky-500/10 text-sky-300",
  HYPOTHESIS: "border-amber-500/25 bg-amber-500/10 text-amber-300",
};

const ROLE_LABELS: Record<StrategyPlatformRole, string> = {
  AUTHORITY: "Authority",
  REACH: "Reach",
  PROOF: "Proof",
  LAUNCH: "Launch",
  CONVERSION: "Conversion",
  OWNED: "Owned",
};

export function StrategyDeskPanel({
  projectId,
  initialStrategy,
}: {
  projectId: string;
  initialStrategy: SocialStrategy;
}) {
  const [strategy, setStrategy] = useState(initialStrategy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [trends, setTrends] = useState<StrategyTrendLayer | null>(null);
  const [trendBusy, setTrendBusy] = useState(true);
  const [trendError, setTrendError] = useState("");

  useEffect(() => {
    let cancelled = false;
    requestTrends(projectId)
      .then((next) => {
        if (!cancelled) {
          setTrends(next);
          setTrendError("");
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setTrendError(
            cause instanceof Error
              ? cause.message
              : "Recent signals could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setTrendBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function refreshTrends() {
    setTrendBusy(true);
    setTrendError("");
    try {
      const next = await requestTrends(projectId);
      setTrends(next);
    } catch (cause) {
      setTrendError(
        cause instanceof Error
          ? cause.message
          : "Recent signals could not be loaded.",
      );
    } finally {
      setTrendBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/strategy`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | { strategy?: SocialStrategy; error?: string }
        | null;
      if (!response.ok || !payload?.strategy) {
        setError(payload?.error ?? "The strategy could not be refreshed.");
        return;
      }
      setStrategy(payload.strategy);
    } catch {
      setError("The strategy could not be refreshed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 sm:p-6" data-testid="strategy-desk">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
            <Compass size={14} />
            Social strategy
          </div>
          <h2 className="mt-2 text-xl font-semibold text-white">
            The strategist&apos;s read
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[#777b84]">
            A point of view built from this project&apos;s own product, audience,
            proof and measured performance. When the evidence is thin, it says so
            instead of inventing a fact.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <EvidenceBadge level={strategy.confidence} />
          <Link
            href={`/projects/${projectId}/analytics`}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#30343c] bg-[#15171c] px-4 text-sm font-medium text-white hover:bg-[#1b1e24]"
          >
            Analytics
            <ArrowUpRight size={14} />
          </Link>
          <Button variant="secondary" onClick={refresh} disabled={busy}>
            <RefreshCw size={14} />
            {busy ? "Refreshing" : "Refresh"}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-[#3a1d1d] bg-[#180f0f] p-3 text-xs text-[#f87171]">
          {error}
        </p>
      ) : null}

      <div className="mt-6 rounded-2xl border border-[#2a2e36] bg-[#0b0d10] p-5">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#62666f]">
          The bet
        </p>
        <h3 className="mt-2 text-2xl font-semibold tracking-tight text-white">
          {strategy.thesis.headline}
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#b4b7bf]">
          {strategy.thesis.argument}
        </p>
        <p className="mt-4 border-l border-[#3a4050] pl-3 text-xs leading-5 text-[#9ca3af]">
          {strategy.thesis.proof}
        </p>
        {strategy.thesis.basis.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {strategy.thesis.basis.map((item) => (
              <li
                key={item}
                className="rounded-full border border-[#2a2e36] px-2 py-1 text-[10px] text-[#777b84]"
              >
                {item}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-[#24272e] bg-[#15171c] p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
            <Target size={14} />
            Audience
          </div>
          <p className="mt-3 text-sm leading-6 text-[#d4d6db]">
            {strategy.audience.summary}
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-[#62666f]">
                Pain
              </dt>
              <dd className="mt-1 text-xs text-[#b4b7bf]">
                {strategy.audience.pain ?? "Not recorded"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-[#62666f]">
                Desired outcome
              </dt>
              <dd className="mt-1 text-xs text-[#b4b7bf]">
                {strategy.audience.desiredOutcome ?? "Not recorded"}
              </dd>
            </div>
          </dl>
          {strategy.audience.missing.length > 0 ? (
            <MissingList items={strategy.audience.missing} />
          ) : null}
        </section>

        <section className="rounded-2xl border border-[#24272e] bg-[#15171c] p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
            <Activity size={14} />
            Measurement
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-white">
              {strategy.measurement.headline}
            </h3>
            <EvidenceBadge level={strategy.measurement.evidenceLevel} />
          </div>
          <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
            {strategy.measurement.detail}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label="Published" value={strategy.measurement.publishedPosts} />
            <Metric label="Measured" value={strategy.measurement.measuredPosts} />
          </div>
          <p className="mt-3 text-[11px] leading-5 text-[#777b84]">
            {strategy.measurement.nextCheck}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-[#777b84]">
            {strategy.measurement.decisionRule}
          </p>
        </section>
      </div>

      <section className="mt-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
          <Layers3 size={14} />
          Where to play
        </div>
        <p className="mt-1 text-xs text-[#777b84]">
          Each platform gets a job. Do not publish the same asset everywhere and
          call it distribution.
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {strategy.platforms.map((platform) => (
            <div
              key={platform.platformId}
              className="rounded-xl border border-[#24272e] bg-[#15171c] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-white">
                  {platform.platformName}
                </h3>
                <span className="rounded-full border border-[#30343c] px-2 py-0.5 text-[10px] text-[#9ca3af]">
                  {ROLE_LABELS[platform.role]}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
                {platform.job}
              </p>
              <dl className="mt-3 space-y-1 text-[11px] text-[#777b84]">
                <div className="flex justify-between gap-3">
                  <dt>Format</dt>
                  <dd className="text-right text-[#b4b7bf]">{platform.format}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Starting cadence</dt>
                  <dd className="text-right text-[#b4b7bf]">{platform.cadence}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[11px] leading-5 text-[#777b84]">
                {platform.why}
              </p>
              <div className="mt-3">
                <EvidenceBadge level={platform.evidenceLevel} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-[#24272e] bg-[#15171c] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
            <Clock3 size={14} />
            When to post
          </div>
          <EvidenceBadge level={strategy.timing.evidenceLevel} />
        </div>
        <h3 className="mt-3 text-lg font-semibold text-white">
          {strategy.timing.headline}
        </h3>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-[#9ca3af]">
          {strategy.timing.detail}
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {strategy.timing.windows.map((window) => (
            <div
              key={window.label}
              className="rounded-lg border border-[#2a2e36] bg-[#0b0d10] p-3"
            >
              <p className="text-sm font-medium text-white">{window.label}</p>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-[#62666f]">
                {window.confidence === "HYPOTHESIS"
                  ? "Test, not a recommendation"
                  : `${window.confidence} confidence`}
              </p>
              <p className="mt-2 text-[11px] leading-5 text-[#777b84]">
                {window.note}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 border-l border-[#3a4050] pl-3 text-[11px] leading-5 text-[#9ca3af]">
          {strategy.timing.measurement}
        </p>
        {strategy.timing.evidence.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {strategy.timing.evidence.slice(0, 3).map((item) => (
              <li key={item} className="text-[10px] leading-5 text-[#62666f]">
                {item}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mt-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
          <Compass size={14} />
          Content system
        </div>
        <p className="mt-1 text-xs text-[#777b84]">
          {strategy.contentSystem.principle}
        </p>
        <p className="mt-2 rounded-lg border border-[#2a2e36] bg-[#0b0d10] p-3 text-[11px] leading-5 text-[#9ca3af]">
          {strategy.contentSystem.rotationRule}
        </p>
        <ol className="mt-3 space-y-3">
          {strategy.contentSystem.plays.map((play) => (
            <li
              key={play.id}
              className="rounded-xl border border-[#24272e] bg-[#15171c] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#30343c] text-[10px] text-[#9ca3af]">
                    {play.sequence}
                  </span>
                  <div>
                    <h3 className="text-sm font-medium text-white">{play.title}</h3>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-[#62666f]">
                      {play.angleLabel} · {play.format} · {play.platformName}
                    </p>
                  </div>
                </div>
                {play.proofReady ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
                    <CheckCircle2 size={12} />
                    Evidence on file
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-300">
                    <AlertTriangle size={12} />
                    Capture proof
                  </span>
                )}
              </div>

              <p className="mt-3 text-xs leading-5 text-[#d4d6db]">{play.hook}</p>
              <p className="mt-2 text-[11px] leading-5 text-[#9ca3af]">
                <span className="text-[#62666f]">Proof: </span>
                {play.proof}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-[#777b84]">
                <span className="text-[#62666f]">Why now: </span>
                {play.whyNow}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[#62666f]">
                <span>Signal: {play.successSignal}</span>
                <span>CTA: {play.cta}</span>
              </div>
            </li>
          ))}
        </ol>
        {strategy.contentSystem.plays.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-[#30343c] p-6 text-xs text-[#777b84]">
            No grounded plays yet. Add a product record, a feature, a problem or a
            supported claim first.
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-2xl border border-[#24272e] bg-[#15171c] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
              <Sparkles size={14} />
              Recent signals
            </div>
            <p className="mt-1 max-w-2xl text-xs text-[#777b84]">
              Public trend feeds, adapted by AI into angles this project can
              actually make. The model may only use the articles it was given.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TrendStatus status={trends?.status ?? null} busy={trendBusy} />
            <Button
              variant="secondary"
              onClick={refreshTrends}
              disabled={trendBusy}
            >
              <RefreshCw size={14} />
              {trendBusy ? "Scanning" : "Rescan"}
            </Button>
          </div>
        </div>

        {trendBusy ? (
          <p className="mt-4 rounded-lg border border-[#2a2e36] bg-[#0b0d10] p-3 text-xs text-[#9ca3af]">
            Scanning public trend feeds and adapting the strongest signals...
          </p>
        ) : null}

        {trendError ? (
          <p className="mt-4 rounded-lg border border-[#4a3a1f] bg-[#1f1a10] p-3 text-xs text-[#f0c674]">
            {trendError}
          </p>
        ) : null}

        {!trendBusy && trends?.status === "DISABLED" ? (
          <p className="mt-4 rounded-lg border border-[#2a2e36] bg-[#0b0d10] p-3 text-xs text-[#9ca3af]">
            AI trend adaptation is off because no model provider is configured.
            The strategy still works from project evidence.
          </p>
        ) : null}

        {!trendBusy && trends?.status === "UNAVAILABLE" ? (
          <p className="mt-4 rounded-lg border border-[#4a3a1f] bg-[#1f1a10] p-3 text-xs text-[#f0c674]">
            {trends.summary}
          </p>
        ) : null}

        {!trendBusy && trends?.status === "READY" ? (
          <>
            <p className="mt-4 text-xs leading-5 text-[#b4b7bf]">
              {trends.summary}
            </p>
            {trends.items.length > 0 ? (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {trends.items.map((trend) => (
                  <article
                    key={trend.id}
                    className="rounded-xl border border-[#2a2e36] bg-[#0b0d10] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <a
                          href={trend.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-start gap-1.5 text-sm font-medium text-white hover:text-[#c7d2fe]"
                        >
                          {trend.title}
                          <ExternalLink size={12} className="mt-1 shrink-0" />
                        </a>
                        <p className="mt-1 text-[10px] uppercase tracking-wide text-[#62666f]">
                          {trend.source}
                          {trend.publishedAt
                            ? ` · ${new Date(trend.publishedAt).toLocaleDateString()}`
                            : ""}
                        </p>
                      </div>
                      <span className="rounded-full border border-[#30343c] px-2 py-0.5 text-[10px] text-[#9ca3af]">
                        {trend.platformName} · {trend.format}
                      </span>
                    </div>
                    <p className="mt-3 text-[11px] leading-5 text-[#9ca3af]">
                      <span className="text-[#62666f]">Why now: </span>
                      {trend.whyNow}
                    </p>
                    <p className="mt-2 text-[11px] leading-5 text-[#d4d6db]">
                      <span className="text-[#62666f]">Angle: </span>
                      {trend.contentAngle}
                    </p>
                    <p className="mt-2 border-l border-[#3a4050] pl-3 text-xs leading-5 text-[#e5e7eb]">
                      {trend.hook}
                    </p>
                    <p className="mt-2 text-[10px] leading-5 text-[#f0c674]">
                      Proof needed: {trend.proofNeeded}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed border-[#30343c] p-4 text-xs text-[#777b84]">
                No recent signal was relevant enough to adapt. That is a valid
                answer, not a gap to fill with invented news.
              </p>
            )}
          </>
        ) : null}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
            <ShieldAlert size={14} />
            Guardrails
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {strategy.guardrails.map((guardrail) => (
              <li
                key={guardrail.title}
                className="rounded-xl border border-[#24272e] bg-[#15171c] p-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={[
                      "rounded-full px-2 py-0.5 text-[10px]",
                      guardrail.severity === "STOP"
                        ? "bg-red-500/10 text-red-300"
                        : "bg-amber-500/10 text-amber-300",
                    ].join(" ")}
                  >
                    {guardrail.severity}
                  </span>
                  <p className="text-xs font-medium text-white">
                    {guardrail.title}
                  </p>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-[#9ca3af]">
                  {guardrail.detail}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
            <AlertTriangle size={14} />
            What is still missing
          </div>
          {strategy.missingInputs.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {strategy.missingInputs.map((item) => (
                <li
                  key={item}
                  className="rounded-lg border border-[#4a3a1f] bg-[#1f1a10] px-3 py-2 text-[11px] text-[#f0c674]"
                >
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
              The strategy has enough project evidence for a first sprint.
            </p>
          )}
          <div className="mt-4 rounded-xl border border-[#24272e] bg-[#15171c] p-3">
            <p className="text-[10px] uppercase tracking-wide text-[#62666f]">
              Source summary
            </p>
            <p className="mt-1 text-[11px] leading-5 text-[#9ca3af]">
              {strategy.sourceSummary.features} feature records (
              {strategy.sourceSummary.specificFeatures} specific) ·{" "}
              {strategy.sourceSummary.problems} problems ·{" "}
              {strategy.sourceSummary.benefits} benefits ·{" "}
              {strategy.sourceSummary.workflows} workflows ·{" "}
              {strategy.sourceSummary.supportedClaims} supported claims ·{" "}
              {strategy.sourceSummary.audienceSignals} audience signals
            </p>
          </div>
        </section>
      </div>
    </Card>
  );
}

async function requestTrends(
  projectId: string,
): Promise<StrategyTrendLayer> {
  const response = await fetch(`/api/projects/${projectId}/strategy/trends`, {
    credentials: "include",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | { trends?: StrategyTrendLayer; error?: string }
    | null;
  if (!response.ok || !payload?.trends) {
    throw new Error(payload?.error ?? "Recent signals could not be loaded.");
  }
  return payload.trends;
}

function TrendStatus({
  status,
  busy,
}: {
  status: StrategyTrendLayer["status"] | null;
  busy: boolean;
}) {
  const label = busy
    ? "Scanning"
    : status === "READY"
      ? "Live feeds + AI"
      : status === "DISABLED"
        ? "AI off"
        : "Unavailable";
  return (
    <span className="rounded-full border border-[#2f4a3a] bg-[#102019] px-2 py-1 text-[10px] text-[#8ee0b0]">
      {label}
    </span>
  );
}

function EvidenceBadge({ level }: { level: StrategyEvidenceLevel }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] ${EVIDENCE_STYLES[level]}`}
    >
      {strategyEvidenceLabel(level)}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[#2a2e36] bg-[#0b0d10] p-3">
      <p className="text-[10px] uppercase tracking-wide text-[#62666f]">{label}</p>
      <p className="mt-1 text-lg text-white">{value}</p>
    </div>
  );
}

function MissingList({ items }: { items: string[] }) {
  return (
    <div className="mt-4 rounded-lg border border-[#4a3a1f] bg-[#1f1a10] p-3">
      <p className="text-[10px] uppercase tracking-wide text-[#f0c674]">
        Still missing
      </p>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item} className="text-[11px] text-[#f0c674]">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
