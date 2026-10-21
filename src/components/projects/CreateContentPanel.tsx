"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, Sparkles, Wand2 } from "lucide-react";
import { Button } from "../ui/Button";
import { getContentType } from "../../core/domain/content-type";

/**
 * The one action a project page owes a user: turn a sentence into content.
 *
 * The panel runs the existing pipeline in order - source, understanding,
 * intent, concepts, choice, scene plan - so the user does not have to learn
 * which panel comes after which. Every step is a real API call; nothing here
 * fabricates a result. The advanced sections below keep the editable versions
 * of the same work.
 */

export type CreateDirection = {
  id: string;
  name: string;
  thesis: string;
  narrativeSummary?: string;
  hook?: { statement?: string; mechanism?: string };
  visualStrategy?: { approach?: string; productMoments?: string[] };
  proofStrategy?: { proofPoints?: string[] };
  voiceDirection?: string;
  cta?: string | null;
};

export type CreateStoryboard = {
  id: string;
  name: string;
  targetDurationMs: number;
  actualDurationMs?: number;
  scenes: Array<{
    id: string;
    order: number;
    name: string;
    startMs: number;
    endMs: number;
    purpose?: string;
    textOverlays?: Array<{ id: string; text: string }>;
    voiceoverPlan?: { text: string } | null;
    shots?: Array<{ id: string; description: string }>;
  }>;
};

export type CreateResult = {
  direction: CreateDirection;
  storyboard: CreateStoryboard | null;
};

type IntentResponse = {
  intent: { id: string; status: string; contentTypeId: string };
  clarifications?: Array<{ question: string }>;
};

const STEPS: Record<string, string> = {
  source: "Reading your link",
  analyze: "Understanding your product",
  intent: "Shaping your request",
  directions: "Writing concepts",
  choose: "Choosing a concept",
  storyboard: "Writing the scene plan",
};

const MODES = [
  { id: "BALANCED", label: "Balanced", hint: "Grounded and polished" },
  { id: "GUIDED", label: "Guided", hint: "Built around real screenshots" },
  { id: "WILD", label: "Wild", hint: "More experimental" },
] as const;

function inputDescriptor(value: string) {
  const url = value.trim();
  if (/^https?:\/\/(www\.)?github\.com\//i.test(url)) {
    return { type: "repository", provider: "github", value: url };
  }
  if (/^https?:\/\/(www\.)?gitlab\.com\//i.test(url)) {
    return { type: "repository", provider: "gitlab", value: url };
  }
  if (/^https?:\/\/(www\.)?figma\.com\//i.test(url)) {
    return { type: "url", kind: "figma", value: url };
  }
  return { type: "url", kind: "website", value: url };
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(data.message ?? data.error ?? "Something went wrong.");
  }
  return data as T;
}

function openSection(id: string) {
  const section = document.getElementById(id);
  if (section instanceof HTMLDetailsElement) section.open = true;
  section?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function CreateContentPanel({
  projectId,
  hasSources,
  hasIntelligence,
  hasProductUi,
  initial = null,
}: {
  projectId: string;
  hasSources: boolean;
  hasIntelligence: boolean;
  hasProductUi: boolean;
  initial?: CreateResult | null;
}) {
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("BALANCED");
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(initial);
  const [showForm, setShowForm] = useState(initial === null);

  async function generate() {
    const request = brief.trim();
    if (!request) {
      setError("Tell me what you want to make.");
      return;
    }

    if (!hasSources && !sourceUrl.trim()) {
      setError("Add a link to your product first, so the content is grounded.");
      return;
    }

    setError(null);
    setStep("source");

    try {
      if (!hasSources) {
        setStep("source");
        const ingested = await postJson<{
          inputs?: Array<{
            status?: string;
            error?: { message?: string } | null;
          }>;
        }>(`/api/projects/${projectId}/inputs`, {
          inputs: [inputDescriptor(sourceUrl)],
        });
        const failed = ingested.inputs?.find(
          (input) => input.status === "failed",
        );
        if (failed) {
          throw new Error(
            failed.error?.message ?? "That link could not be read.",
          );
        }
      }

      if (!hasIntelligence) {
        setStep("analyze");
        await postJson(`/api/projects/${projectId}/intelligence/analyze`, {});
      }

      setStep("intent");
      const resolved = await postJson<IntentResponse>(
        `/api/projects/${projectId}/intent`,
        { request },
      );

      if (resolved.intent.status !== "RESOLVED") {
        const questions = (resolved.clarifications ?? [])
          .map((item) => item.question)
          .filter(Boolean);
        throw new Error(
          questions.length > 0
            ? `A little more detail: ${questions.join(" ")}`
            : "That request needs more detail before it can be made.",
        );
      }

      setStep("directions");
      const creative = await postJson<{ directions: CreateDirection[] }>(
        `/api/projects/${projectId}/creative-directions/generate`,
        { intentId: resolved.intent.id, mode, count: 3 },
      );
      const chosen = creative.directions[0];
      if (!chosen) {
        throw new Error(
          "No concept could be built from what the project knows yet. Add a source or a screenshot and try again.",
        );
      }

      setStep("choose");
      await postJson(
        `/api/projects/${projectId}/creative-directions/${chosen.id}/select`,
      );

      const contentType = getContentType(resolved.intent.contentTypeId);
      let storyboard: CreateStoryboard | null = null;

      if (contentType?.supportsDuration) {
        setStep("storyboard");
        const planned = await postJson<{ storyboard: CreateStoryboard }>(
          `/api/projects/${projectId}/storyboards/generate`,
          { intentId: resolved.intent.id, directionId: chosen.id },
        );
        storyboard = planned.storyboard;
      }

      setResult({ direction: chosen, storyboard });
      setShowForm(false);
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Content generation failed.",
      );
    } finally {
      setStep(null);
    }
  }

  if (!showForm && result) {
    const { direction, storyboard } = result;

    return (
      <section className="rounded-2xl border border-[#2b3038] bg-gradient-to-b from-[#14171d] to-[#101216] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#7f8795]">
              Your content
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              {direction.name}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => openSection("plan")}
            >
              Edit the plan
            </Button>
            <Button type="button" onClick={() => setShowForm(true)}>
              <Sparkles size={14} />
              Make another
            </Button>
          </div>
        </div>

        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-[#c6cad2]">
          {direction.thesis}
        </p>
        {direction.narrativeSummary ? (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#878d99]">
            {direction.narrativeSummary}
          </p>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {direction.visualStrategy?.approach ? (
            <div className="rounded-lg border border-[#24272e] bg-[#15171c] p-3">
              <p className="text-[11px] uppercase tracking-wide text-[#62666f]">
                Look
              </p>
              <p className="mt-1 text-sm text-[#c6cad2]">
                {direction.visualStrategy.approach}
              </p>
            </div>
          ) : null}
          {direction.proofStrategy?.proofPoints &&
          direction.proofStrategy.proofPoints.length > 0 ? (
            <div className="rounded-lg border border-[#24272e] bg-[#15171c] p-3">
              <p className="text-[11px] uppercase tracking-wide text-[#62666f]">
                Proof
              </p>
              <p className="mt-1 text-sm text-[#c6cad2]">
                {direction.proofStrategy.proofPoints.join(" ")}
              </p>
            </div>
          ) : null}
          {direction.voiceDirection ? (
            <div className="rounded-lg border border-[#24272e] bg-[#15171c] p-3">
              <p className="text-[11px] uppercase tracking-wide text-[#62666f]">
                Voice
              </p>
              <p className="mt-1 text-sm text-[#c6cad2]">
                {direction.voiceDirection}
              </p>
            </div>
          ) : null}
        </div>

        {storyboard ? (
          <div className="mt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium text-white">
                {storyboard.name}
              </h3>
              <p className="text-xs text-[#62666f]">
                {storyboard.scenes.length} scenes ·{" "}
                {clock(storyboard.actualDurationMs ?? storyboard.targetDurationMs)}
              </p>
            </div>

            <ol className="mt-3 space-y-2">
              {storyboard.scenes.map((scene) => {
                const overlays = (scene.textOverlays ?? [])
                  .map((overlay) => overlay.text)
                  .filter(Boolean);
                const shots = (scene.shots ?? [])
                  .map((shot) => shot.description)
                  .filter(Boolean);

                return (
                  <li
                    key={scene.id}
                    className="rounded-lg border border-[#24272e] bg-[#15171c] p-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-white">
                        {scene.order + 1}. {scene.name}
                      </p>
                      <p className="text-[11px] tabular-nums text-[#62666f]">
                        {clock(scene.startMs)}–{clock(scene.endMs)}
                      </p>
                    </div>
                    {overlays.length > 0 ? (
                      <p className="mt-1 text-sm text-[#c6cad2]">
                        On screen: {overlays.join(" / ")}
                      </p>
                    ) : null}
                    {scene.voiceoverPlan?.text ? (
                      <p className="mt-1 text-sm text-[#9aa0ab]">
                        Voiceover: {scene.voiceoverPlan.text}
                      </p>
                    ) : null}
                    {shots.length > 0 ? (
                      <p className="mt-1 text-xs text-[#777b84]">
                        {shots.join(" ")}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>

            <p className="mt-3 text-xs text-[#777b84]">
              This is the working script and shot plan. Capture or render it
              under{" "}
              <button
                type="button"
                onClick={() => openSection("production")}
                className="text-white underline decoration-[#4a4f59] underline-offset-2"
              >
                Production tools
              </button>
              .
            </p>
          </div>
        ) : (
          <p className="mt-6 text-sm text-[#8b8f98]">
            This format has no timeline to plan. The concept is ready; make the
            final copy or image under{" "}
            <button
              type="button"
              onClick={() => openSection("production")}
              className="text-white underline decoration-[#4a4f59] underline-offset-2"
            >
              Production tools
            </button>
            .
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#2b3038] bg-gradient-to-b from-[#14171d] to-[#101216] p-5 sm:p-6">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#7f8795]">
        <Wand2 size={14} />
        Make content
      </div>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
        What do you want to make?
      </h2>
      <p className="mt-1 text-sm text-[#878d99]">
        Say it in one line. I&apos;ll read your product, choose a concept, and
        write the scene plan.
      </p>

      <div className="mt-5 space-y-3">
        <label className="block">
          <span className="sr-only">What do you want to make?</span>
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            rows={3}
            placeholder="Make a 30 second launch video for LinkedIn"
            className="w-full resize-none rounded-lg border border-[#30343c] bg-[#15171c] px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#62666f] focus:border-white/40"
          />
        </label>

        {!hasSources ? (
          <label className="block">
            <span className="mb-1 block text-xs text-[#8b8f98]">
              First, where should I learn about your product?
            </span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="url"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://your-product.com or a GitHub repo"
                className="w-full rounded-lg border border-[#30343c] bg-[#15171c] px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#62666f] focus:border-white/40"
              />
            </div>
            <span className="mt-1 block text-[11px] text-[#62666f]">
              I&apos;ll read it once. You can add screenshots later for Guided
              mode.
            </span>
          </label>
        ) : null}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
            Style
            <select
              aria-label="Style"
              value={mode}
              onChange={(event) =>
                setMode(event.target.value as (typeof MODES)[number]["id"])
              }
              className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
            >
              {MODES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} — {option.hint}
                </option>
              ))}
            </select>
          </label>

          <Button
            type="button"
            onClick={() => void generate()}
            disabled={step !== null || (mode === "GUIDED" && !hasProductUi)}
          >
            <Sparkles size={14} />
            {step !== null ? "Working…" : "Generate content"}
          </Button>
        </div>

        {mode === "GUIDED" && !hasProductUi ? (
          <p className="rounded-lg border border-[#3a3320] bg-[#1d1911] p-3 text-xs text-[#c9b06a]">
            Guided mode works from a real screenshot.{" "}
            <button
              type="button"
              onClick={() => openSection("sources")}
              className="underline decoration-[#6d5c2c] underline-offset-2"
            >
              Add one under Sources
            </button>{" "}
            or choose Balanced.
          </p>
        ) : null}

        {step !== null ? (
          <div
            aria-live="polite"
            className="flex items-center gap-2 rounded-lg border border-[#24272e] bg-[#15171c] p-3 text-sm text-[#c6cad2]"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            {STEPS[step] ?? "Working"}…
            <span className="text-xs text-[#62666f]">
              This can take a minute.
            </span>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">
            {error}
            {mode === "GUIDED" &&
            error.toLowerCase().includes("guided") ? (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => openSection("sources")}
                  className="underline decoration-red-400/40 underline-offset-2"
                >
                  Add a screenshot
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {hasSources && !hasIntelligence ? (
          <p className="text-xs text-[#62666f]">
            <FileText size={12} className="mr-1 inline" />
            I&apos;ll analyze your sources first; you can edit the result in the
            advanced section afterwards.
          </p>
        ) : null}

        {initial ? (
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="inline-flex items-center gap-1 text-xs text-[#878d99] hover:text-white"
          >
            Back to the latest content
            <ArrowRight size={12} />
          </button>
        ) : null}
      </div>
    </section>
  );
}
