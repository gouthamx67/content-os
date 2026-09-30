"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Lock, Pencil, Sparkles } from "lucide-react";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import type { SerializedStoryboard } from "../../lib/storyboard-api";
import type { StoryboardCaptureTarget } from "../../core/domain/storyboard";

type Registry = ReturnType<
  typeof import("../../lib/storyboard-api").storyboardRegistry
> | null;

type Generation = {
  provider: string;
  model: string | null;
  fallbackFrom: string | null;
  fallbackReason: string | null;
};

type Scene = SerializedStoryboard["scenes"][number];

const SCENE_TYPE_LABELS: Readonly<Record<string, string>> = {
  HOOK: "Hook",
  PROBLEM: "Problem",
  CONTEXT: "Context",
  SOLUTION: "Solution",
  PRODUCT_DEMO: "Product demo",
  WORKFLOW: "How it works",
  FEATURE: "Feature",
  PROOF: "Proof",
  REVEAL: "Reveal",
  TRANSFORMATION: "Transformation",
  CTA: "Call to action",
  BRAND: "Brand",
  CUSTOM: "Custom",
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  DRAFT: "Draft",
  SELECTED: "Chosen",
  LOCKED: "Locked",
  ARCHIVED: "Archived",
};

function statusColor(status: string): string {
  if (status === "SELECTED") return "text-[#7ee2a8]";
  if (status === "LOCKED") return "text-[#9ec1ff]";
  return "text-[#8b8f98]";
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export type StoryboardPanelProps = {
  projectId: string;
  /**
   * A plan is written for an argument somebody chose, so the panel stays closed
   * until a direction is selected rather than offering to plan one nobody picked.
   */
  direction: { id: string; name: string; intentId: string } | null;
  initialStoryboards?: SerializedStoryboard[];
  initialRegistry?: Registry;
};

export function StoryboardPanel({
  projectId,
  direction,
  initialStoryboards = [],
  initialRegistry = null,
}: StoryboardPanelProps) {
  const router = useRouter();
  const [boards, setBoards] = useState<SerializedStoryboard[]>(initialStoryboards);
  const [registry, setRegistry] = useState<Registry>(initialRegistry);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [captureTargets, setCaptureTargets] = useState<StoryboardCaptureTarget[]>([]);
  const [openId, setOpenId] = useState<string | null>(
    initialStoryboards[0]?.id ?? null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; purpose: string }>({
    name: "",
    purpose: "",
  });

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
        const issues = Array.isArray(data.issues)
          ? (data.issues as { message?: string }[])
              .map((issue) => issue.message ?? "")
              .filter(Boolean)
              .join(", ")
          : "";
        setError(
          issues
            ? `${String(data.error ?? "Request failed")} (${issues})`
            : String(data.error ?? "Request failed"),
        );
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

  /**
   * Every mutation answers with the whole re-timed board. Spans are the domain's
   * to lay out, so the panel replaces state with the answer rather than moving
   * rows around itself and hoping the timeline followed.
   */
  function replaceBoard(board: SerializedStoryboard) {
    setBoards((current) => {
      const others = current.filter((entry) => entry.id !== board.id);
      // Keep the list ordered so the newest plan is where a person expects it.
      return [board, ...others].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    });
    setOpenId(board.id);
  }

  function generate() {
    if (!direction) return null;
    return call(
      "generate",
      `/api/projects/${projectId}/storyboards/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intentId: direction.intentId,
          directionId: direction.id,
        }),
      },
      (data) => {
        if (data.registry) setRegistry(data.registry as Registry);
        if (data.generation) setGeneration(data.generation as Generation);
        if (Array.isArray(data.captureTargets)) {
          setCaptureTargets(data.captureTargets as StoryboardCaptureTarget[]);
        }
        replaceBoard(data.storyboard as SerializedStoryboard);
      },
    );
  }

  function select(boardId: string) {
    return call(
      `select:${boardId}`,
      `/api/projects/${projectId}/storyboards/${boardId}/select`,
      { method: "POST" },
      (data) => {
        const chosen = data.storyboard as SerializedStoryboard;
        setBoards((current) =>
          current.map((board) => {
            if (board.id === chosen.id) return chosen;
            // Selection is per brief, not per direction: the server demotes every
            // other chosen plan for the same intent, so the panel mirrors that key
            // rather than waiting for a refresh to discover two chosen plans.
            if (board.status === "SELECTED" && board.intentId === chosen.intentId) {
              return { ...board, status: "DRAFT" };
            }
            return board;
          }),
        );
      },
    );
  }

  function lock(boardId: string) {
    return call(
      `lock:${boardId}`,
      `/api/projects/${projectId}/storyboards/${boardId}/lock`,
      { method: "POST" },
      (data) => {
        const locked = data.storyboard as SerializedStoryboard;
        setBoards((current) =>
          current.map((board) => {
            if (board.id === locked.id) return locked;
            // Locking archives whatever else was chosen for the same brief, so the
            // checkpoint downstream reads exactly one plan.
            if (board.status === "SELECTED" && board.intentId === locked.intentId) {
              return { ...board, status: "ARCHIVED" };
            }
            return board;
          }),
        );
      },
    );
  }

  function startEdit(scene: Scene) {
    setEditingSceneId(scene.id);
    setError(null);
    setDraft({ name: scene.name, purpose: scene.purpose });
  }

  function cancelEdit() {
    setEditingSceneId(null);
    setDraft({ name: "", purpose: "" });
  }

  function saveEdit(boardId: string, sceneId: string) {
    return call(
      `save:${sceneId}`,
      `/api/projects/${projectId}/storyboards/${boardId}/scenes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenes: [
            {
              sceneId,
              changes: { name: draft.name, purpose: draft.purpose },
            },
          ],
        }),
      },
      (data) => {
        replaceBoard(data.storyboard as SerializedStoryboard);
        cancelEdit();
      },
    );
  }

  function move(board: SerializedStoryboard, sceneId: string, toIndex: number) {
    return call(
      `move:${sceneId}`,
      `/api/projects/${projectId}/storyboards/${board.id}/reorder`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId, toIndex }),
      },
      (data) => {
        replaceBoard(data.storyboard as SerializedStoryboard);
      },
    );
  }

  if (!direction) {
    return (
      <Card title="Storyboard">
        <p className="text-sm text-[#8b8f98]">
          Choose a creative direction first. A storyboard lays out one argument,
          and an argument nobody chose is the wrong one to plan.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Storyboard">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[#8b8f98]">
          Scene plan for {direction.name}. Beats, timings and what each shot needs
          to be captured — not a script.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={generate} disabled={busy !== null}>
            <Sparkles size={14} />
            {busy === "generate" ? "Planning" : "Plan the storyboard"}
          </Button>
          {boards.length > 0 ? (
            <span className="text-xs text-[#5c6069]">
              {boards.length} {boards.length === 1 ? "plan" : "plans"} for this
              project
            </span>
          ) : null}
        </div>

        {generation?.fallbackFrom ? (
          <p className="text-[11px] text-[#8a7a45]">
            Fell back to the built-in planner
            {generation.fallbackReason ? ` (${generation.fallbackReason})` : ""}.
            These are grounded beats, not a model&apos;s reading.
          </p>
        ) : null}

        {error ? <p className="text-xs text-[#f0a8a8]">{error}</p> : null}

        {boards.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {boards.map((board) => {
              const open = openId === board.id;
              const locked = board.status === "LOCKED";
              return (
                <li key={board.id}>
                  <Card>
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h4 className="text-sm font-semibold text-white">
                          {board.name}
                        </h4>
                        <span
                          className={`text-[11px] ${statusColor(board.status)}`}
                        >
                          {STATUS_LABELS[board.status] ?? board.status}
                        </span>
                      </div>

                      <p className="text-[11px] text-[#5c6069]">
                        {seconds(board.actualDurationMs)} of{" "}
                        {seconds(board.targetDurationMs)}
                        {board.aspectRatio ? ` · ${board.aspectRatio}` : ""}
                        {board.platforms.length > 0
                          ? ` · ${board.platforms.join(", ")}`
                          : ""}
                        {" · "}v{board.version}
                      </p>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => setOpenId(open ? null : board.id)}
                          disabled={busy !== null}
                        >
                          {open ? "Hide the plan" : "Show the plan"}
                        </Button>
                        {board.status === "SELECTED" ? null : locked ? null : (
                          <Button
                            variant="ghost"
                            onClick={() => select(board.id)}
                            disabled={busy !== null}
                          >
                            <Check size={14} />
                            {busy === `select:${board.id}` ? "Choosing" : "Choose this"}
                          </Button>
                        )}
                        {board.status === "LOCKED" ? null : (
                          <Button
                            variant="ghost"
                            onClick={() => lock(board.id)}
                            disabled={busy !== null}
                          >
                            <Lock size={14} />
                            {busy === `lock:${board.id}` ? "Locking" : "Lock the plan"}
                          </Button>
                        )}
                      </div>

                      {locked ? (
                        <p className="text-[11px] text-[#5c6069]">
                          Locked. A locked plan is the one somebody will shoot
                          against, so it stops moving.
                        </p>
                      ) : null}

                      {open ? (
                        <ol className="flex flex-col gap-3">
                          {board.scenes.map((scene, index) => {
                            const editing = editingSceneId === scene.id;
                            const targets = captureTargets.filter(
                              (target) => target.sceneId === scene.id,
                            );
                            return (
                              <li
                                key={scene.id}
                                className="rounded-lg border border-[#24272e] p-3"
                              >
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                  <h5 className="text-sm font-semibold text-white">
                                    {index + 1}. {scene.name}
                                  </h5>
                                  <span className="text-[11px] text-[#8b8f98]">
                                    {SCENE_TYPE_LABELS[scene.type] ?? scene.type} ·{" "}
                                    {seconds(scene.startMs)}–{seconds(scene.endMs)}
                                  </span>
                                </div>

                                {editing ? (
                                  <div className="mt-3 grid gap-3">
                                    <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                                      Beat name
                                      <input
                                        value={draft.name}
                                        onChange={(event) =>
                                          setDraft((current) => ({
                                            ...current,
                                            name: event.target.value,
                                          }))
                                        }
                                        className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
                                      What this beat does
                                      <textarea
                                        value={draft.purpose}
                                        onChange={(event) =>
                                          setDraft((current) => ({
                                            ...current,
                                            purpose: event.target.value,
                                          }))
                                        }
                                        rows={2}
                                        className="rounded-lg border border-[#24272e] bg-[#15171c] px-2 py-1 text-sm text-white"
                                      />
                                    </label>
                                    <p className="text-[11px] text-[#5c6069]">
                                      An edit is held to the same rules as a proposal,
                                      and the whole plan is re-timed around it.
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        onClick={() =>
                                          saveEdit(board.id, scene.id)
                                        }
                                        disabled={busy !== null}
                                      >
                                        {busy === `save:${scene.id}`
                                          ? "Saving"
                                          : "Save"}
                                      </Button>
                                      <Button variant="ghost" onClick={cancelEdit}>
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <p className="mt-1 text-sm text-[#b8bcc4]">
                                      {scene.purpose}
                                    </p>

                                    <ul className="mt-2 flex flex-col gap-1">
                                      {scene.shots.map((shot) => (
                                        <li
                                          key={shot.id}
                                          className="text-xs text-[#8b8f98]"
                                        >
                                          <span className="text-[#5c6069]">
                                            {shot.visualType}
                                          </span>{" "}
                                          {shot.description}
                                          {shot.captureRequirement.mode !==
                                          "NONE" ? (
                                            <span className="text-[#7ee2a8]">
                                              {" "}
                                              · capture{" "}
                                              {shot.captureRequirement.target}
                                            </span>
                                          ) : null}
                                        </li>
                                      ))}
                                    </ul>

                                    {scene.textOverlays.length > 0 ? (
                                      <ul className="mt-2 flex flex-col gap-1">
                                        {scene.textOverlays.map((overlay) => (
                                          <li
                                            key={overlay.id}
                                            className="text-xs text-[#e6e6e6]"
                                          >
                                            “{overlay.text}”
                                          </li>
                                        ))}
                                      </ul>
                                    ) : null}

                                    {scene.voiceoverPlan?.text ? (
                                      <p className="mt-2 text-xs italic text-[#b8bcc4]">
                                        {scene.voiceoverPlan.text}
                                      </p>
                                    ) : null}

                                    {targets.length > 0 ? (
                                      <p className="mt-2 text-[11px] text-[#5c6069]">
                                        {targets.length}{" "}
                                        {targets.length === 1 ? "capture job" : "capture jobs"}{" "}
                                        pointed at this beat
                                      </p>
                                    ) : null}

                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      {locked ? null : (
                                        <>
                                          <Button
                                            variant="ghost"
                                            onClick={() => startEdit(scene)}
                                            disabled={busy !== null}
                                          >
                                            <Pencil size={14} />
                                            Edit
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            onClick={() =>
                                              move(board, scene.id, index - 1)
                                            }
                                            disabled={busy !== null || index === 0}
                                          >
                                            <ArrowUp size={14} />
                                            Earlier
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            onClick={() =>
                                              move(
                                                board,
                                                scene.id,
                                                index + 1,
                                              )
                                            }
                                            disabled={
                                              busy !== null ||
                                              index === board.scenes.length - 1
                                            }
                                          >
                                            <ArrowDown size={14} />
                                            Later
                                          </Button>
                                        </>
                                      )}
                                    </div>
                                  </>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      ) : null}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-[#5c6069]">
            No storyboard yet. Plan one to see the beats and what each shot needs.
          </p>
        )}

        {registry ? (
          <p className="text-[11px] text-[#5c6069]">
            Up to {registry.limits.maxScenesPerPlan} scenes,{" "}
            {registry.limits.maxShotsPerScene} shots per scene.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
