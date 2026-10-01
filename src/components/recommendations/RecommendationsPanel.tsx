"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Lightbulb, RefreshCw, Sparkles, X } from "lucide-react";
import type { SerializedOpportunity } from "../../lib/recommendation-api";
import { getPlatform } from "../../core/domain/platform";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

type Registry = {
  channels: string[];
  statuses: string[];
  contentTypes: Array<{
    id: string;
    name: string;
    channel: string;
    platforms: string[];
  }>;
} | null;

const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  VIDEO: "Video",
  IMAGE: "Image",
  TEXT: "Text",
  AUDIO: "Audio",
  CAMPAIGN: "Campaign",
};

const SUBJECT_LABELS: Readonly<Record<string, string>> = {
  PRODUCT: "product",
  FEATURE: "feature",
  WORKFLOW: "workflow",
  PROBLEM: "problem",
  BENEFIT: "benefit",
  CLAIM: "claim",
  ASSET: "asset",
};

/**
 * "Progress" is the honest reading of a second recommendation about something the
 * project already has one for. It is not a warning: covering the same feature
 * twice is legitimate, it just should not look like an oversight.
 */
function isProgressLabel(progress: boolean): string | null {
  return progress ? "You already have one of these" : null;
}

/**
 * Platform ids are storage keys ("product_hunt"). Users know the destination by
 * its name, so the label comes from the CP09 registry rather than the raw id.
 */
function platformName(platform: string): string {
  return getPlatform(platform)?.name ?? platform;
}

function channelTitleCase(channel: string): string {
  const explicit = CHANNEL_LABELS[channel];
  if (explicit) return explicit;
  return channel.charAt(0).toUpperCase() + channel.slice(1).toLowerCase();
}

/**
 * The content type's human name comes from the registry the server sent rather
 * than from a copy in this file. `image.carousel` means nothing to a user;
 * "Carousel" does. A hard-coded map would quietly stop matching the domain the
 * first time a content type is added, and the raw id is the fallback so a
 * response that arrived without a registry still says something true.
 */
function contentTypeName(contentTypeId: string, registry: Registry): string {
  const known = registry?.contentTypes.find((entry) => entry.id === contentTypeId);
  return known?.name ?? contentTypeId;
}

/**
 * The panel suggests; it does not decide.
 *
 * Three things follow from recommendations being advisory. The engine's ranking
 * score is never shown, because a score a user can read is a ranking they can
 * second-guess and a number that would look like a quality judgement on their
 * product. Every card shows its reasons instead. And the gaps are shown as
 * prominently as the reasons: a recommendation grounded on three sources and one
 * built on a guess look identical otherwise, and the difference is the thing the
 * user needs in order to decide.
 */
export function RecommendationsPanel({
  projectId,
  initialRecommendations,
  initialRegistry,
}: {
  projectId: string;
  initialRecommendations: SerializedOpportunity[];
  initialRegistry: Registry;
}) {
  const router = useRouter();
  const [recommendations, setRecommendations] =
    useState<SerializedOpportunity[]>(initialRecommendations);
  const [registry, setRegistry] = useState<Registry>(initialRegistry);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

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
        setError(String(data.error ?? "Request failed"));
        return;
      }
      onSuccess(data);
      router.refresh();
    } catch {
      setError("Request failed");
    } finally {
      setBusy(null);
    }
  }

  function adoptList(data: Record<string, unknown>) {
    const list = data.recommendations;
    if (Array.isArray(list)) {
      setRecommendations(list as SerializedOpportunity[]);
    }
    if (data.registry && typeof data.registry === "object") {
      setRegistry(data.registry as Registry);
    }
  }

  function adoptOne(data: Record<string, unknown>) {
    const updated = data.recommendation;
    if (!updated || typeof updated !== "object") return;
    const opportunity = updated as SerializedOpportunity;
    setRecommendations((current) =>
      current.map((entry) => (entry.id === opportunity.id ? opportunity : entry)),
    );
  }

  const base = `/api/projects/${projectId}/recommendations`;

  function generate() {
    return call("generate", `${base}/generate`, { method: "POST" }, adoptList);
  }

  function refresh() {
    return call("refresh", `${base}/refresh`, { method: "POST" }, adoptList);
  }

  function dismiss(id: string) {
    return call(`dismiss:${id}`, `${base}/${id}/dismiss`, { method: "POST" }, adoptOne);
  }

  function restore(id: string) {
    return call(`restore:${id}`, `${base}/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "ACTIVE" }),
    }, adoptOne);
  }

  /**
   * Taking an item up hands the work to the intent pipeline, so the panel's job
   * ends here: the recommendation becomes SELECTED and the user is sent to the
   * request that CP09 resolved from it. The panel does not navigate itself on
   * success, because the project page already carries the resolved intent and
   * moving the user away would hide whether anything was actually created.
   */
  function select(id: string) {
    return call(`select:${id}`, `${base}/${id}/select`, { method: "POST" }, adoptOne);
  }

  const active = recommendations.filter((entry) => entry.status === "ACTIVE");
  const dismissed = recommendations.filter((entry) => entry.status === "DISMISSED");
  const selected = recommendations.filter((entry) => entry.status === "SELECTED");

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#62666f]">
        <Lightbulb size={14} />
        Suggestions
      </div>
      <h2 className="mt-2 text-xl font-semibold text-white">What this project could make next</h2>
      <p className="mt-1 max-w-2xl text-sm text-[#777b84]">
        Derived from your product intelligence and what you already have. These are
        suggestions, not a queue - take one up as a content request, or dismiss it and it
        will not come back.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={generate}
          disabled={busy !== null}
        >
          <Sparkles size={14} />
          {busy === "generate" ? "Reading your project…" : "Suggest what to make"}
        </Button>
        <Button variant="secondary" onClick={refresh} disabled={busy !== null || active.length === 0}>
          <RefreshCw size={14} />
          {busy === "refresh" ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[#ff9a9a]">
          {error}
        </p>
      ) : null}

      {recommendations.length === 0 ? (
        <p className="mt-5 text-sm text-[#62666f]">
          {busy === "generate"
            ? "Reading your project…"
            : "No suggestions yet. Analyse your sources first - suggestions can only come from what the project actually knows."}
        </p>
      ) : null}

      {active.length > 0 ? (
        <ul className="mt-5 flex flex-col gap-4">
          {active.map((opportunity) => (
            <li key={opportunity.id}>
              <RecommendationCard
                opportunity={opportunity}
                registry={registry}
                busy={busy}
                onSelect={() => select(opportunity.id)}
                onDismiss={() => dismiss(opportunity.id)}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {selected.length > 0 ? (
        <section className="mt-6">
          <h3 className="text-xs uppercase tracking-wide text-[#62666f]">
            Taken up
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {selected.map((opportunity) => (
              <li
                key={opportunity.id}
                className="flex items-center gap-2 text-sm text-[#7ee2a8]"
              >
                <Check size={14} />
                {opportunity.title}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {dismissed.length > 0 ? (
        <section className="mt-6">
          <Button
            variant="ghost"
            onClick={() => setShowDismissed((current) => !current)}
            aria-expanded={showDismissed}
          >
            {showDismissed ? "Hide" : "Show"} {dismissed.length} dismissed
          </Button>
          {showDismissed ? (
            <ul className="mt-2 flex flex-col gap-2">
              {dismissed.map((opportunity) => (
                <li
                  key={opportunity.id}
                  className="flex items-center justify-between gap-3 text-sm text-[#62666f]"
                >
                  <span className="line-through">{opportunity.title}</span>
                  <Button
                    variant="ghost"
                    onClick={() => restore(opportunity.id)}
                    disabled={busy !== null}
                  >
                    <RefreshCw size={14} />
                    {busy === `restore:${opportunity.id}` ? "Restoring…" : "Restore"}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </Card>
  );
}

function RecommendationCard({
  opportunity,
  registry,
  busy,
  onSelect,
  onDismiss,
}: {
  opportunity: SerializedOpportunity;
  registry: Registry;
  busy: string | null;
  onSelect: () => void;
  onDismiss: () => void;
}) {
  const progress = isProgressLabel(opportunity.isProgress);

  return (
    <div className="rounded-xl border border-[#24272e] bg-[#15171c] p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[#62666f]">
        <span className="rounded-full border border-[#24272e] px-2 py-0.5">
          {channelTitleCase(opportunity.channel)}
        </span>
        <span>{contentTypeName(opportunity.contentTypeId, registry)}</span>
        <span>
          {platformName(opportunity.platform)} ·{" "}
          {SUBJECT_LABELS[opportunity.subjectType] ?? opportunity.subjectType}{" "}
          {opportunity.subjectLabel}
        </span>
      </div>

      <h3 className="mt-2 text-sm font-medium text-white">{opportunity.title}</h3>
      <p className="mt-1 text-sm text-[#9a9ea7]">{opportunity.rationale}</p>

      {opportunity.reasons.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {opportunity.reasons.map((reason) => (
            <li
              key={reason}
              className="rounded-full border border-[#24272e] px-2 py-0.5 text-xs text-[#9a9ea7]"
            >
              {reason}
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        The gaps are shown as loudly as the reasons. A suggestion grounded on the
        product graph and one built on a thin inference would otherwise look
        identical, and the user has no other way to tell them apart.
      */}
      {opportunity.missingInputs.length > 0 ? (
        <div className="mt-3 rounded-lg border border-[#4a3a1f] bg-[#1f1a10] px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-[#f0c674]">
            What this is missing
          </p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {opportunity.missingInputs.map((gap) => (
              <li key={gap} className="text-xs text-[#f0c674]">
                {gap}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {progress ? <p className="mt-3 text-xs text-[#62666f]">{progress}</p> : null}

      <div className="mt-4 flex gap-2">
        <Button onClick={onSelect} disabled={busy !== null}>
          <ArrowRight size={14} />
          {busy === `select:${opportunity.id}` ? "Creating…" : "Take this up"}
        </Button>
        <Button variant="ghost" onClick={onDismiss} disabled={busy !== null}>
          <X size={14} />
          {busy === `dismiss:${opportunity.id}` ? "Dismissing…" : "Not for me"}
        </Button>
      </div>
    </div>
  );
}
