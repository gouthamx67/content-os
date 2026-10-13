"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Download,
  Eye,
  EyeOff,
  History,
  Sparkles,
  Undo2,
  Redo2,
} from "lucide-react";
import { Button } from "../../../../../components/ui/Button";
import { AppShell } from "../../../../../components/layout/AppShell";
import type {
  EditorDocumentRecord,
  EditorOperation,
  EditorSnapshot,
} from "../../../../../modules/editor-engine/domain/types";

export type EditorHeadRevision = {
  id: string;
  number: number;
};

type EditorWorkspaceProps = {
  projectId: string;
  document: EditorDocumentRecord;
  headRevision: EditorHeadRevision;
  snapshot: EditorSnapshot;
};

type WireRevision = {
  id: string;
  revisionNumber: number;
  operationType: string;
  sourceType: string;
  sourceId: string | null;
  createdAt: string;
};

const SaveState = {
  IDLE: "idle",
  SAVING: "saving",
  SAVED: "saved",
  CONFLICT: "conflict",
  ERROR: "error",
} as const;
type SaveStateValue = (typeof SaveState)[keyof typeof SaveState];

function assetUrl(projectId: string, ref: string): string {
  return `/api/projects/${projectId}/editor/assets/${encodeURIComponent(ref)}`;
}

function localApply(snapshot: EditorSnapshot, op: EditorOperation): EditorSnapshot {
  const nodes = snapshot.nodes.map((node) => ({ ...node }));
  const mutate = (id: string, patch: Partial<(typeof nodes)[number]>) => {
    const index = nodes.findIndex((node) => node.id === id);
    if (index >= 0) nodes[index] = { ...nodes[index]!, ...patch };
  };

  switch (op.type) {
    case "SET_TEXT":
      mutate(op.nodeId, { text: { value: op.value } });
      break;
    case "MOVE":
      mutate(op.nodeId, { transform: { ...nodes.find((n) => n.id === op.nodeId)!.transform, x: op.x, y: op.y } });
      break;
    case "RESIZE":
      mutate(op.nodeId, { transform: { ...nodes.find((n) => n.id === op.nodeId)!.transform, width: op.width, height: op.height } });
      break;
    case "ROTATE":
      mutate(op.nodeId, { transform: { ...nodes.find((n) => n.id === op.nodeId)!.transform, rotation: op.rotation } });
      break;
    case "SET_OPACITY":
      mutate(op.nodeId, { transform: { ...nodes.find((n) => n.id === op.nodeId)!.transform, opacity: op.opacity } });
      break;
    case "SET_STYLE": {
      const node = nodes.find((n) => n.id === op.nodeId);
      if (node) mutate(op.nodeId, { style: { ...node.style, ...op.style } });
      break;
    }
    case "SET_GAIN": {
      const node = nodes.find((n) => n.id === op.nodeId);
      if (node?.audio) mutate(op.nodeId, { audio: { ...node.audio, gainDb: op.gainDb } });
      break;
    }
    case "SET_MUTE": {
      const node = nodes.find((n) => n.id === op.nodeId);
      if (node?.audio) mutate(op.nodeId, { audio: { ...node.audio, muted: op.muted } });
      break;
    }
    case "SET_VISIBILITY":
      mutate(op.nodeId, { visible: op.visible });
      break;
    case "TRIM":
      mutate(op.nodeId, { trim: { startMs: op.startMs, endMs: op.endMs } });
      break;
    case "REORDER":
      mutate(op.nodeId, { zIndex: op.zIndex, parentId: op.parentId ?? null });
      break;
    case "DUPLICATE": {
      const source = nodes.find((n) => n.id === op.nodeId);
      if (source) {
        const maxZ = Math.max(...nodes.map((n) => n.zIndex), 0);
        nodes.push({ ...cloneNode(source), id: op.newNodeId, zIndex: maxZ + 1 });
      }
      break;
    }
    case "DELETE": {
      const doomed = new Set<string>();
      const collect = (id: string) => {
        if (doomed.has(id)) return;
        doomed.add(id);
        for (const node of nodes) {
          if (node.parentId === id) collect(node.id);
        }
      };
      collect(op.nodeId);
      const kept = nodes.filter((node) => !doomed.has(node.id));
      return { ...snapshot, nodes: kept };
    }
    default:
      break;
  }

  return { ...snapshot, nodes };
}

function cloneNode<T extends object>(node: T): T {
  return {
    ...node,
    transform: { ...(node as { transform?: object }).transform },
    text:
      (node as { text?: object }).text === null
        ? null
        : { ...(node as { text?: { value: string } }).text },
    style: { ...(node as { style?: object }).style },
    trim:
      (node as { trim?: object }).trim === null
        ? null
        : { ...(node as { trim?: object }).trim },
    audio:
      (node as { audio?: object }).audio === null
        ? null
        : { ...(node as { audio?: object }).audio },
    shape:
      (node as { shape?: object }).shape === null
        ? null
        : { ...(node as { shape?: object }).shape },
    motion:
      (node as { motion?: object }).motion === null
        ? null
        : { ...(node as { motion?: object }).motion },
    effects: [...(node as { effects?: unknown[] }).effects ?? []],
    automation: [...(node as { automation?: unknown[] }).automation ?? []],
    provenance:
      (node as { provenance?: object }).provenance === null
        ? null
        : { ...(node as { provenance?: object }).provenance },
  } as unknown as T;
}

export function EditorWorkspace({
  projectId,
  document,
  headRevision: initialHead,
  snapshot: initialSnapshot,
}: EditorWorkspaceProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [headRevision, setHeadRevision] = useState(initialHead);
  const [pendingOps, setPendingOps] = useState<EditorOperation[]>([]);
  const [saveState, setSaveState] = useState<SaveStateValue>(SaveState.SAVED);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [lastError, setLastError] = useState("");
  const [tab, setTab] = useState<"inspector" | "timeline" | "history" | "ai">("inspector");
  const [finalized, setFinalized] = useState(document.status === "READY");
  const [currentMs, setCurrentMs] = useState(0);
  const [preview, setPreview] = useState<{
    revisionId: string;
    revisionNumber: number;
    snapshot: EditorSnapshot;
  } | null>(null);

  const pendingRef = useRef<EditorOperation[]>([]);
  const headRef = useRef(initialHead);
  const snapshotRef = useRef(initialSnapshot);
  const flushingRef = useRef<Promise<boolean> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  pendingRef.current = pendingOps;
  headRef.current = headRevision;
  snapshotRef.current = snapshot;

  const onKeyDownRef = useRef(onKeyDown);
  onKeyDownRef.current = onKeyDown;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      onKeyDownRef.current(event);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function queueOp(op: EditorOperation) {
    if (preview) return;
    setSnapshot((current) => localApply(current, op));
    setPendingOps((current) => [...current, op]);
    setSaveState(SaveState.SAVING);
    scheduleFlush();
  }

  function scheduleFlush() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flushPending();
    }, 700);
  }

  async function flushPending(): Promise<boolean> {
    if (flushingRef.current) {
      await flushingRef.current;
      return pendingRef.current.length === 0;
    }

    const run = async (): Promise<boolean> => {
      // Consecutive operations must chain on the last server response, not on
      // headRef (which only refreshes on render). A rapid second edit otherwise
      // pages with the OLD base revision and trips a 409.
      let baseRevisionId = headRef.current.id;
      while (pendingRef.current.length > 0) {
        const op = pendingRef.current[0]!;
        const response = await fetch(
          `/api/projects/${projectId}/editor/${document.id}/operations`,
          {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              baseRevision: baseRevisionId,
              operation: op,
            }),
          },
        );

        if (response.status === 409) {
          pendingRef.current = [];
          setPendingOps([]);
          setSaveState(SaveState.CONFLICT);
          return false;
        }

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          pendingRef.current = [];
          setPendingOps([]);
          setLastError(payload.error ?? "The edit could not be saved");
          setSaveState(SaveState.ERROR);
          return false;
        }

        pendingRef.current = pendingRef.current.slice(1);
        setPendingOps([...pendingRef.current]);

        const payload = (await response.json()) as {
          revision: { id: string; revisionNumber: number };
          snapshot: EditorSnapshot;
        };
        baseRevisionId = payload.revision.id;
        headRef.current = {
          id: payload.revision.id,
          number: payload.revision.revisionNumber,
        };
        setHeadRevision({ id: payload.revision.id, number: payload.revision.revisionNumber });
        setSnapshot(payload.snapshot);
      }

      setSaveState(SaveState.SAVED);
      return true;
    };

    flushingRef.current = run().finally(() => {
      flushingRef.current = null;
    });
    return flushingRef.current;
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    const mod = event.metaKey || event.ctrlKey;

    // Ctrl/Cmd+Z (and Shift) are the app-level undo/redo even while an input
    // is focused; without intercepting here the browser would run its own
    // native input undo and emit a stray onChange that corrupts history.
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) void doRedo();
      else void doUndo();
      return;
    }

    const target = event.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return;
    }

    if (mod && event.key.toLowerCase() === "d") {
      event.preventDefault();
      if (selectedNodeId) queueOp({ type: "DUPLICATE", nodeId: selectedNodeId, newNodeId: pendingId() });
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedNodeId) {
      event.preventDefault();
      queueOp({ type: "DELETE", nodeId: selectedNodeId });
      setSelectedNodeId(null);
      return;
    }
    if (event.key === "Escape") {
      setSelectedNodeId(null);
    }
  }

  function pendingId(): string {
    return `enode-${Math.random().toString(36).slice(2, 10)}`;
  }

  async function doUndo() {
    if (!(await flushPending())) return;
    const payload = await mutation("undo", { baseRevision: headRef.current.id });
    if (!payload) return;
    applyRestore(payload);
  }

  async function doRedo() {
    if (!(await flushPending())) return;
    const payload = await mutation("redo", { baseRevision: headRef.current.id });
    if (!payload) return;
    applyRestore(payload);
  }

  async function mutation(
    route: "undo" | "redo" | "restore" | "finalize",
    body: Record<string, unknown>,
  ) {
    const response = await fetch(
      `/api/projects/${projectId}/editor/${document.id}/${route}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (response.status === 409) {
      setSaveState(SaveState.CONFLICT);
      return null;
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setLastError(payload.error ?? `${route} failed`);
      setSaveState(SaveState.ERROR);
      return null;
    }
    return (await response.json()) as {
      revision: { id: string; revisionNumber: number };
      snapshot: EditorSnapshot;
      document?: { status?: string };
    };
  }

  function applyRestore(payload: {
    revision: { id: string; revisionNumber: number };
    snapshot: EditorSnapshot;
    document?: { status?: string };
  }) {
    headRef.current = {
      id: payload.revision.id,
      number: payload.revision.revisionNumber,
    };
    setHeadRevision({ id: payload.revision.id, number: payload.revision.revisionNumber });
    setSnapshot(payload.snapshot);
    setSaveState(SaveState.SAVED);
    if (payload.document?.status) setFinalized(payload.document.status === "READY");
  }

  async function doRestore(revisionId: string) {
    if (!(await flushPending())) return;
    const payload = await mutation("restore", {
      baseRevision: headRef.current.id,
      revisionId,
    });
    if (payload) applyRestore(payload);
  }

  // Previewing a revision reads its bytes for the stage only. The head, the
  // save state and the working snapshot are never touched, so looking at the
  // past can't rewrite the present.
  async function doPreview(revisionId: string) {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/editor/${document.id}/revisions/${revisionId}`,
        { credentials: "include" },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        revision: { revisionNumber: number };
        snapshot: EditorSnapshot;
      };
      setPreview({
        revisionId,
        revisionNumber: payload.revision.revisionNumber,
        snapshot: payload.snapshot,
      });
    } catch {
      // A preview that cannot load simply leaves the working state on screen.
    }
  }

  async function doFinalize() {
    if (!(await flushPending())) return;
    const payload = await mutation("finalize", {
      baseRevision: headRef.current.id,
    });
    // The route answers 200 only when the document became READY; it does not
    // return a revision (finalizing changes no snapshot), so the button state
    // is derived from the outcome rather than a fresh revision.
    if (payload) {
      setFinalized(true);
      setSaveState(SaveState.SAVED);
    }
  }

  const selected = snapshot.nodes.find((node) => node.id === selectedNodeId) ?? null;

  return (
    <AppShell>
      <div className="flex h-screen flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-[#202329] px-4 py-2">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium text-white">{document.name}</h1>
            <p className="text-[10px] uppercase tracking-wide text-[#62666f]">
              {document.id} · {snapshot.width}×{snapshot.height} ·{" "}
              {(snapshot.durationMs / 1000).toFixed(1)}s · {snapshot.frameRate} fps
            </p>
          </div>

          <div className="flex items-center gap-4">
            <SaveIndicator state={saveState} />
            <div className="hidden items-center gap-2 text-[10px] text-[#62666f] lg:flex">
              <kbd className="rounded border border-[#30343c] px-1">⌘Z</kbd>
              <kbd className="rounded border border-[#30343c] px-1">⇧⌘Z</kbd>
              <kbd className="rounded border border-[#30343c] px-1">⌘D</kbd>
              <kbd className="rounded border border-[#30343c] px-1">⌫</kbd>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                data-testid="editor-undo"
                onClick={() => void doUndo()}
              >
                <Undo2 size={14} /> Undo
              </Button>
              <Button
                variant="secondary"
                data-testid="editor-redo"
                onClick={() => void doRedo()}
              >
                <Redo2 size={14} /> Redo
              </Button>
              <Button
                variant="secondary"
                data-testid="editor-finalize-button"
                disabled={finalized}
                onClick={() => void doFinalize()}
              >
                <Download size={14} /> {finalized ? "Finalised" : "Finalise"}
              </Button>
            </div>
          </div>
        </header>

        {saveState === SaveState.CONFLICT && (
          <div
            data-testid="editor-conflict-banner"
            className="flex items-center justify-between bg-amber-950/40 px-4 py-2 text-xs text-amber-200"
          >
            <span>This document changed on another tab. Your unsaved edits were not applied.</span>
            <button
              className="rounded bg-amber-200 px-3 py-1 font-medium text-amber-950"
              onClick={() => { void flushPending(); location.reload(); }}
            >
              Reload
            </button>
          </div>
        )}

        {saveState === SaveState.ERROR && (
          <div
            data-testid="editor-error-banner"
            className="flex items-center justify-between bg-red-950/40 px-4 py-2 text-xs text-red-200"
          >
            <span>{lastError || "Something went wrong saving this edit."}</span>
            <button
              className="rounded bg-red-200 px-3 py-1 font-medium text-red-950"
              onClick={() => { setPendingOps([]); pendingRef.current = []; setSaveState(SaveState.SAVED); }}
            >
              Dismiss
            </button>
          </div>
        )}

        {preview && (
          <div
            data-testid="editor-preview-banner"
            className="flex items-center justify-between bg-sky-950/40 px-4 py-2 text-xs text-sky-200"
          >
            <span>
              Previewing revision {preview.revisionNumber} — the head is
              unchanged.
            </span>
            <button
              data-testid="editor-preview-exit"
              className="rounded bg-sky-200 px-3 py-1 font-medium text-sky-950"
              onClick={() => setPreview(null)}
            >
              Exit preview
            </button>
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr_320px]">
          <LayerTree
            nodes={(preview?.snapshot ?? snapshot).nodes}
            selectedNodeId={selectedNodeId}
            onSelect={setSelectedNodeId}
            onOp={queueOp}
          />

          <Stage
            projectId={projectId}
            snapshot={preview?.snapshot ?? snapshot}
            selectedNodeId={selectedNodeId}
            onSelect={setSelectedNodeId}
          />

          <aside className="flex min-h-0 flex-col border-l border-[#202329]">
            <div className="flex border-b border-[#202329]">
              {(
                [
                  ["inspector", "Inspector"],
                  ["timeline", "Timeline"],
                  ["history", "History"],
                  ["ai", "AI edit"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  data-testid={`editor-tab-${key}`}
                  onClick={() => setTab(key)}
                  className={[
                    "flex-1 px-2 py-2 text-[10px] uppercase tracking-wide",
                    tab === key ? "bg-[#15171c] text-white" : "text-[#62666f] hover:text-white",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === "inspector" && preview && (
                <div
                  data-testid="editor-preview-note"
                  className="p-4 text-xs text-[#b4b7bf]"
                >
                  Previewing revision {preview.revisionNumber}. This is a
                  read-only view of the past — exit the preview to edit the
                  current revision.
                </div>
              )}
              {tab === "inspector" && !preview && (
                <Inspector
                  node={selected}
                  snapshot={snapshot}
                  onOp={queueOp}
                  onSelect={setSelectedNodeId}
                />
              )}
              {tab === "timeline" && (
                <Timeline
                  snapshot={snapshot}
                  currentMs={currentMs}
                  onTimeChange={setCurrentMs}
                />
              )}
              {tab === "history" && (
                <HistoryPanel
                  projectId={projectId}
                  documentId={document.id}
                  headRevisionId={headRevision.id}
                  onRestore={(revisionId) => void doRestore(revisionId)}
                  onPreview={(revisionId) => void doPreview(revisionId)}
                />
              )}
              {tab === "ai" && (
                <AIPanel
                  projectId={projectId}
                  documentId={document.id}
                  nodeId={selectedNodeId}
                  headRevision={() => headRef.current.id}
                  onApply={(snapshotPayload) => {
                    applyRestore(snapshotPayload);
                  }}
                />
              )}
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function SaveIndicator({ state }: { state: SaveStateValue }) {
  const map: Record<SaveStateValue, { text: string; className: string }> = {
    [SaveState.IDLE]: { text: "", className: "" },
    [SaveState.SAVING]: { text: "Saving…", className: "text-[#9aa0aa]" },
    [SaveState.SAVED]: { text: "Saved", className: "text-[#4ade80]" },
    [SaveState.CONFLICT]: { text: "Conflict", className: "text-amber-300" },
    [SaveState.ERROR]: { text: "Error", className: "text-red-300" },
  };
  const entry = map[state];
  return (
    <span
      data-testid="editor-save-state"
      className={`text-xs ${entry.className}`}
    >
      {entry.text}
    </span>
  );
}

function LayerTree(props: {
  nodes: EditorSnapshot["nodes"];
  selectedNodeId: string | null;
  onSelect: (id: string | null) => void;
  onOp: (op: EditorOperation) => void;
}) {
  const { nodes, selectedNodeId, onSelect, onOp } = props;

  // The tree is parents before their children, siblings in paint order, so a
  // group and the layers it contains read as one block. A node whose parent is
  // missing still renders, at the root, rather than disappearing from the list.
  const childrenByParent = new Map<string | null, EditorSnapshot["nodes"]>();
  for (const node of nodes) {
    const key = node.parentId ?? null;
    const bucket = childrenByParent.get(key);
    if (bucket) bucket.push(node);
    else childrenByParent.set(key, [node]);
  }
  for (const bucket of childrenByParent.values()) {
    bucket.sort((a, b) => a.zIndex - b.zIndex);
  }

  const ordered: { node: EditorSnapshot["nodes"][number]; depth: number }[] = [];
  const visited = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const node of childrenByParent.get(parent) ?? []) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      ordered.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const node of nodes) {
    if (!visited.has(node.id)) ordered.push({ node, depth: 0 });
  }

  return (
    <div className="min-h-0 overflow-y-auto border-r border-[#202329] p-2">
      <p className="px-1 pb-2 text-[10px] uppercase tracking-wide text-[#62666f]">
        Layers · {ordered.length}
      </p>
      {ordered.length === 0 && (
        <p className="px-1 text-xs text-[#777b84]">No layers.</p>
      )}
      <ul className="space-y-1">
        {ordered.map(({ node, depth }, index) => {
          const prev = ordered[index - 1]?.node;
          const next = ordered[index + 1]?.node;
          return (
            <li key={node.id} style={{ marginLeft: depth * 12 }}>
              <div
                data-testid="editor-layer"
                data-node-id={node.id}
                data-depth={depth}
                onClick={() => onSelect(node.id === selectedNodeId ? null : node.id)}
                className={[
                  "flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5",
                  node.id === selectedNodeId
                    ? "border-[#62666f] bg-[#15171c]"
                    : "border-transparent hover:bg-[#15171c]",
                ].join(" ")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-white">{node.name}</span>
                  <span className="text-[10px] text-[#62666f]">{node.type} · z{node.zIndex}</span>
                </span>
                <button
                  data-testid={`editor-layer-${node.type.toLowerCase()}`}
                  className="rounded p-1 text-[#62666f] hover:text-white"
                  onClick={() => onOp({ type: "SET_VISIBILITY", nodeId: node.id, visible: !node.visible })}
                  aria-label={node.visible ? "Hide" : "Show"}
                >
                  {node.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
              </div>
              <div className="flex gap-1 px-1 pb-1">
                <button
                  data-testid="editor-layer-up"
                  className="text-[10px] text-[#62666f] hover:text-white disabled:opacity-30"
                  disabled={!prev}
                  onClick={() => {
                    if (prev) onOp({ type: "REORDER", nodeId: node.id, zIndex: prev.zIndex });
                  }}
                >
                  up
                </button>
                <button
                  data-testid="editor-layer-down"
                  className="text-[10px] text-[#62666f] hover:text-white disabled:opacity-30"
                  disabled={!next}
                  onClick={() => {
                    if (next) onOp({ type: "REORDER", nodeId: node.id, zIndex: next.zIndex });
                  }}
                >
                  down
                </button>
                <button
                  data-testid="editor-layer-duplicate"
                  className="text-[10px] text-[#62666f] hover:text-white"
                  onClick={() =>
                    onOp({ type: "DUPLICATE", nodeId: node.id, newNodeId: `enode-${Math.random().toString(36).slice(2, 10)}` })
                  }
                >
                  duplicate
                </button>
                <button
                  data-testid="editor-layer-delete"
                  className="text-[10px] text-red-400 hover:text-red-200"
                  onClick={() => onOp({ type: "DELETE", nodeId: node.id })}
                >
                  delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Stage(props: {
  projectId: string;
  snapshot: EditorSnapshot;
  selectedNodeId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { projectId, snapshot, selectedNodeId, onSelect } = props;
  const ordered = [...snapshot.nodes].sort((a, b) => a.zIndex - b.zIndex);

  // A hidden node is hidden on the canvas too, and hiding a group hides its
  // children with it, so the stage is drawn from the same `visible` truth the
  // layer tree shows rather than a second copy of it.
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const hidden = new Set<string>();
  for (const node of snapshot.nodes) {
    let cursor: EditorSnapshot["nodes"][number] | undefined = node;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      if (!cursor.visible) {
        hidden.add(node.id);
        break;
      }
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
  }
  const painted = ordered.filter((node) => !hidden.has(node.id));

  return (
    <main
      data-testid="editor-stage"
      className="relative flex min-h-0 items-center justify-center overflow-auto bg-[#0b0c0f] p-6"
      onClick={() => onSelect(null)}
    >
      <div
        className="relative bg-black"
        style={{
          width: snapshot.width,
          height: snapshot.height,
          maxWidth: "100%",
          maxHeight: "100%",
          aspectRatio: `${snapshot.width} / ${snapshot.height}`,
        }}
      >
        {painted.map((node) => (
          <StageNode
            key={node.id}
            projectId={projectId}
            snapshot={snapshot}
            node={node}
            selected={node.id === selectedNodeId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </main>
  );
}

function StageNode(props: {
  projectId: string;
  snapshot: EditorSnapshot;
  node: EditorSnapshot["nodes"][number];
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { projectId, snapshot, node, selected, onSelect } = props;
  const style: React.CSSProperties = {
    position: "absolute",
    left: node.transform.x,
    top: node.transform.y,
    width: node.transform.width,
    height: node.transform.height,
    opacity: node.transform.opacity,
    transform: `rotate(${node.transform.rotation}deg)`,
    pointerEvents: "auto",
    outline: selected ? "2px solid #38bdf8" : "1px dotted rgba(255,255,255,0.08)",
  };

  let content: React.ReactNode = null;
  switch (node.type) {
    case "IMAGE":
      if (node.asset) {
        content = (
          <div
            style={{
              width: "100%",
              height: "100%",
              backgroundImage: `url("${assetUrl(projectId, node.asset.ref)}")`,
              backgroundSize: "contain",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center",
            }}
          />
        );
      }
      break;
    case "VIDEO":
      if (node.asset) {
        content = (
          <video
            src={assetUrl(projectId, node.asset.ref)}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            muted
            loop
            autoPlay
          />
        );
      }
      break;
    case "TEXT":
      content = (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: node.style.fontSize ?? 32,
            fontFamily: node.style.fontFamily ?? undefined,
            fontWeight: node.style.fontWeight ?? undefined,
            color: node.style.color ?? "#ffffff",
            backgroundColor: node.style.backgroundColor ?? "transparent",
            textAlign: (node.style.align as React.CSSProperties["textAlign"]) ?? "center",
            borderRadius: node.style.radius ?? 0,
          }}
        >
          {node.text?.value ?? ""}
        </div>
      );
      break;
    case "AUDIO":
      content = (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-[#9aa0aa]">
          {node.name} · {(node.asset?.durationMs ?? node.trim?.endMs ?? snapshot.durationMs) / 1000}s
        </div>
      );
      break;
    case "SHAPE":
      content = (
        <div
          className="h-full w-full border border-[#30343c]"
          style={{ borderRadius: node.shape?.shapeType === "ELLIPSE" ? 9999 : 0 }}
        />
      );
      break;
    case "GROUP":
      content = (
        <div className="flex h-full w-full items-start justify-start border border-dashed border-[#4a4f59] bg-white/[0.02]">
          <span className="bg-[#15171c] px-1 text-[9px] text-[#9aa0aa]">
            {node.name}
          </span>
        </div>
      );
      break;
  }

  return (
    <div
      data-testid="editor-node"
      data-node-id={node.id}
      data-node-type={node.type}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}
    >
      {content}
    </div>
  );
}

function Field(props: {
  label: string;
  testid: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-[10px] text-[#777b84]">
      {props.label}
      <input
        data-testid={props.testid}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1 text-xs text-white"
      />
    </label>
  );
}

function Inspector(props: {
  node: EditorSnapshot["nodes"][number] | null;
  snapshot: EditorSnapshot;
  onOp: (op: EditorOperation) => void;
  onSelect: (id: string | null) => void;
}) {
  const { node, snapshot, onOp, onSelect } = props;

  if (!node) {
    return (
      <div className="p-4 text-xs text-[#777b84]">
        Select a layer on the canvas or in the tree to edit it.
      </div>
    );
  }

  const style = node.style;
  const trim = node.trim;

  return (
    <div className="space-y-4 p-4" data-testid="editor-inspector" data-node-id={node.id}>
      <div>
        <span className="block truncate text-sm font-medium text-white">{node.name}</span>
        <span className="text-[10px] text-[#62666f]">{node.type}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field
          label="X"
          testid="editor-inspector-x"
          value={String(node.transform.x)}
          onChange={(value) => {
            const x = Number(value);
            if (Number.isFinite(x)) onOp({ type: "MOVE", nodeId: node.id, x, y: node.transform.y });
          }}
        />
        <Field
          label="Y"
          testid="editor-inspector-y"
          value={String(node.transform.y)}
          onChange={(value) => {
            const y = Number(value);
            if (Number.isFinite(y)) onOp({ type: "MOVE", nodeId: node.id, x: node.transform.x, y });
          }}
        />
        <Field
          label="Width"
          testid="editor-inspector-width"
          value={String(node.transform.width)}
          onChange={(value) => {
            const width = Number(value);
            if (Number.isFinite(width)) onOp({ type: "RESIZE", nodeId: node.id, width, height: node.transform.height });
          }}
        />
        <Field
          label="Height"
          testid="editor-inspector-height"
          value={String(node.transform.height)}
          onChange={(value) => {
            const height = Number(value);
            if (Number.isFinite(height)) onOp({ type: "RESIZE", nodeId: node.id, width: node.transform.width, height });
          }}
        />
        <Field
          label="Rotation °"
          testid="editor-inspector-rotation"
          value={String(node.transform.rotation)}
          onChange={(value) => {
            const rotation = Number(value);
            if (Number.isFinite(rotation)) onOp({ type: "ROTATE", nodeId: node.id, rotation });
          }}
        />
        <Field
          label="Opacity"
          testid="editor-inspector-opacity"
          value={String(node.transform.opacity)}
          onChange={(value) => {
            const opacity = Number(value);
            if (Number.isFinite(opacity)) onOp({ type: "SET_OPACITY", nodeId: node.id, opacity });
          }}
        />
      </div>

      {node.type === "TEXT" && (
        <>
          <Field
            label="Text"
            testid="editor-inspector-text"
            value={node.text?.value ?? ""}
            onChange={(value) => onOp({ type: "SET_TEXT", nodeId: node.id, value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="Font size"
              testid="editor-inspector-font-size"
              value={style.fontSize ? String(style.fontSize) : ""}
              onChange={(value) => {
                const size = Number(value);
                if (Number.isFinite(size)) onOp({ type: "SET_STYLE", nodeId: node.id, style: { fontSize: size } });
              }}
            />
            <Field
              label="Font family"
              testid="editor-inspector-font-family"
              value={style.fontFamily ?? ""}
              onChange={(value) => onOp({ type: "SET_STYLE", nodeId: node.id, style: { fontFamily: value || null } })}
            />
            <Field
              label="Color"
              testid="editor-inspector-color"
              value={style.color ?? ""}
              onChange={(value) => onOp({ type: "SET_STYLE", nodeId: node.id, style: { color: value || null } })}
            />
            <Field
              label="Background"
              testid="editor-inspector-background"
              value={style.backgroundColor ?? ""}
              onChange={(value) => onOp({ type: "SET_STYLE", nodeId: node.id, style: { backgroundColor: value || null } })}
            />
          </div>
        </>
      )}

      {node.type === "AUDIO" && node.audio && (
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Gain (dB)"
            testid="editor-inspector-gain"
            value={String(node.audio.gainDb)}
            onChange={(value) => {
              const gainDb = Number(value);
              if (Number.isFinite(gainDb)) onOp({ type: "SET_GAIN", nodeId: node.id, gainDb });
            }}
          />
          <label className="flex items-center gap-2 text-[10px] text-[#777b84]">
            <input
              data-testid="editor-inspector-mute"
              type="checkbox"
              checked={node.audio.muted}
              onChange={(event) => onOp({ type: "SET_MUTE", nodeId: node.id, muted: event.target.checked })}
            />
            Muted
          </label>
        </div>
      )}

      {(node.type === "VIDEO" || node.type === "AUDIO") && (
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Trim start (ms)"
            testid="editor-inspector-trim-start"
            value={String(trim?.startMs ?? 0)}
            onChange={(value) => {
              const startMs = Number(value);
              if (Number.isFinite(startMs)) onOp({ type: "TRIM", nodeId: node.id, startMs, endMs: trim?.endMs ?? node.asset?.durationMs ?? snapshot.durationMs });
            }}
          />
          <Field
            label="Trim end (ms)"
            testid="editor-inspector-trim-end"
            value={String(trim?.endMs ?? node.asset?.durationMs ?? snapshot.durationMs)}
            onChange={(value) => {
              const endMs = Number(value);
              if (Number.isFinite(endMs)) onOp({ type: "TRIM", nodeId: node.id, startMs: trim?.startMs ?? 0, endMs });
            }}
          />
        </div>
      )}

      <DetailsBlocks node={node} />

      {node.provenance && (
        <div className="rounded-md border border-[#202329] bg-[#101216] p-2 text-[10px] text-[#62666f]">
          <p className="uppercase tracking-wide text-[#62666f]">Provenance</p>
          <p>{node.provenance.origin} {node.provenance.sourceType}</p>
          {node.provenance.sourceIds.length > 0 && (
            <p className="truncate">sources: {node.provenance.sourceIds.join(", ")}</p>
          )}
        </div>
      )}

      {node.parentId !== null && (
        <button
          className="text-xs text-sky-300 hover:text-sky-200"
          onClick={() => onSelect(node.parentId)}
          data-testid="editor-inspector-parent"
        >
          Edit parent {node.parentId}
        </button>
      )}
    </div>
  );
}

function DetailsBlocks({ node }: { node: EditorSnapshot["nodes"][number] }) {
  const hasEffects = node.effects && node.effects.length > 0;
  const hasAutomation = node.automation && node.automation.length > 0;

  if (!hasEffects && !hasAutomation && !node.motion) return null;

  return (
    <div className="space-y-2">
      {node.motion && node.motion.keyframes.length > 0 && (
        <div className="rounded-md border border-[#202329] bg-[#101216] p-2 text-[10px] text-[#62666f]">
          <p className="uppercase tracking-wide">Motion</p>
          <p>{node.motion.keyframes.length} keyframes retained</p>
        </div>
      )}
      {hasEffects && (
        <div className="rounded-md border border-[#202329] bg-[#101216] p-2 text-[10px] text-[#62666f]">
          <p className="uppercase tracking-wide">Effects</p>
          {node.effects!.map((effect) => (
            <p key={effect.id}>
              {effect.type} {Math.round(effect.amount * 100)}%{effect.enabled ? "" : " · off"}
            </p>
          ))}
        </div>
      )}
      {hasAutomation && (
        <div className="rounded-md border border-[#202329] bg-[#101216] p-2 text-[10px] text-[#62666f]">
          <p className="uppercase tracking-wide">Audio automation</p>
          {node.automation!.map((point) => (
            <p key={point.id}>
              {point.type} @{point.timeMs}ms → {point.value}dB
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Timeline({
  snapshot,
  currentMs,
  onTimeChange,
}: {
  snapshot: EditorSnapshot;
  currentMs: number;
  onTimeChange: (timeMs: number) => void;
}) {
  const ordered = [...snapshot.nodes].sort((a, b) => a.zIndex - b.zIndex);
  const duration = Math.max(snapshot.durationMs, 1);
  const boundedMs = Math.max(0, Math.min(currentMs, snapshot.durationMs));
  const playheadPct = (boundedMs / duration) * 100;

  return (
    <div className="p-4" data-testid="editor-timeline">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-[#62666f]">
        <span>Timeline · {snapshot.durationMs} ms</span>
        <span data-testid="editor-timeline-time">{boundedMs} ms</span>
      </div>
      <input
        type="range"
        data-testid="editor-timeline-scrubber"
        min={0}
        max={snapshot.durationMs}
        step={1}
        value={boundedMs}
        onChange={(event) => onTimeChange(Number(event.target.value))}
        className="mt-3 w-full accent-sky-400"
      />
      {ordered.length === 0 && <p className="mt-2 text-xs text-[#777b84]">No layers.</p>}
      <div className="relative mt-3 space-y-1.5">
        <div
          data-testid="editor-playhead"
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 z-10 w-px bg-sky-400"
          style={{ left: `${playheadPct}%` }}
        />
        {ordered.map((node) => {
          const end = node.trim?.endMs ?? node.asset?.durationMs ?? snapshot.durationMs;
          const start = node.trim?.startMs ?? 0;
          const active = boundedMs >= start && boundedMs < Math.max(end, start + 1);
          const widthPct = Math.max(2, Math.min(100, ((Math.max(end - start, 1)) / duration) * 100));
          const offsetPct = Math.min(98, (start / duration) * 100);
          return (
            <div key={node.id} className="relative h-4 rounded bg-[#15171c]">
              <div
                data-testid="editor-timeline-clip"
                data-active={active ? "true" : "false"}
                className={`absolute inset-y-0 rounded bg-[#2b2f38] ${
                  active ? "ring-1 ring-sky-400" : ""
                }`}
                style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
              >
                <span className="px-1 text-[8px] leading-4 text-[#9aa0aa]">{node.name}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type HistoryEntry = WireRevision & { current: boolean };

function HistoryPanel(props: {
  projectId: string;
  documentId: string;
  headRevisionId: string;
  onRestore: (revisionId: string) => void;
  onPreview: (revisionId: string) => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${props.projectId}/editor/${props.documentId}/history`, {
      credentials: "include",
    })
      .then((response) => response.json())
      .then((payload: { revisions: WireRevision[] }) => {
        if (!alive) return;
        setEntries(payload.revisions.map((revision) => ({
          ...revision,
          current: revision.id === props.headRevisionId,
        })));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [props.projectId, props.documentId, props.headRevisionId]);

  return (
    <div className="p-4" data-testid="editor-history">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#62666f]">
        <History size={12} /> Revisions
      </div>
      {entries === null && <p className="mt-2 text-xs text-[#777b84]">Loading…</p>}
      {entries !== null && entries.length === 0 && (
        <p className="mt-2 text-xs text-[#777b84]">No revisions yet.</p>
      )}
      {entries && entries.length > 0 && (
      <ul className="mt-3 space-y-1">
        {entries.map((entry) => (
          <li
            key={entry.id}
            data-testid="editor-history-item"
            data-revision-id={entry.id}
            className={[
              "rounded-md border px-2 py-1.5 text-xs",
              entry.current ? "border-[#62666f] bg-[#15171c]" : "border-[#202329] bg-[#101216]",
            ].join(" ")}
          >
            <span className="font-medium text-white">#{entry.revisionNumber} · {entry.operationType}</span>
            <span className="ml-2 text-[#62666f]">{entry.sourceType}</span>
            {entry.current && <span className="ml-2 text-[#4ade80]">head</span>}
            <button
              data-testid="editor-history-preview"
              className="ml-2 text-[#9aa0aa] hover:text-white"
              onClick={() => props.onPreview(entry.id)}
            >
              preview
            </button>
            {!entry.current && (
              <button
                data-testid="editor-history-restore"
                className="ml-2 text-sky-300 hover:text-sky-200"
                onClick={() => props.onRestore(entry.id)}
              >
                restore
              </button>
            )}
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}

type AIProposal = {
  proposalId: string;
  baseRevision: string;
  summary: string;
  provider: "LOCAL" | "REMOTE";
  grounding: { status: "SUPPORTED" | "NO_CONTEXT"; reason: string | null; claims: string[] };
  operation: EditorOperation;
};

function AIPanel(props: {
  projectId: string;
  documentId: string;
  nodeId: string | null;
  headRevision: () => string;
  onApply: (
    payload: { revision: { id: string; revisionNumber: number }; snapshot: EditorSnapshot },
  ) => void;
}) {
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<AIProposal | null>(null);
  const [error, setError] = useState("");

  async function propose() {
    setBusy(true);
    setError("");
    setProposal(null);
    try {
      const response = await fetch(
        `/api/projects/${props.projectId}/editor/${props.documentId}/ai/propose`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            baseRevision: props.headRevision(),
            instructions: instructions.trim(),
            nodeId: props.nodeId,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "Could not build a proposal");
        return;
      }
      setProposal((payload as { proposal: AIProposal }).proposal);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!proposal) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/projects/${props.projectId}/editor/${props.documentId}/ai/apply`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            baseRevision: proposal.baseRevision,
            proposalId: proposal.proposalId,
            operation: proposal.operation,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409) {
        setError("Conflict on apply — reload to take the latest document.");
        return;
      }
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "Could not apply the proposal");
        return;
      }
      const data = payload as {
        revision: { id: string; revisionNumber: number };
        snapshot: EditorSnapshot;
      };
      props.onApply(data);
      setProposal(null);
      setInstructions("");
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 p-4" data-testid="editor-ai-panel">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#62666f]">
        <Sparkles size={12} /> AI edit
      </div>
      <p className="text-xs text-[#777b84]">
        {props.nodeId
          ? "Targeting the selected layer. Proposals are previewed here and only land when you apply them."
          : "Select a layer to target it. Without one, text requests can still be made."}
      </p>
      {props.nodeId === null && (
        <p className="text-[10px] text-[#62666f]">No selected layer — some instructions need a target.</p>
      )}
      <textarea
        data-testid="editor-propose-input"
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        placeholder='e.g. "move right by 50px", "set opacity to 40%", "mute", "reword to …"'
        rows={3}
        className="w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
      />
      {error && (
        <p className="text-xs text-red-300" data-testid="editor-ai-error">{error}</p>
      )}
      <Button
        variant="secondary"
        className="w-full"
        disabled={busy || instructions.trim().length === 0}
        data-testid="editor-propose-button"
        onClick={() => void propose()}
      >
        Propose
      </Button>

      {proposal && (
        <div className="space-y-2 rounded-md border border-[#202329] bg-[#101216] p-3">
          <p data-testid="editor-proposal-summary" className="text-xs font-medium text-white">
            {proposal.summary} <span className="text-[#62666f]">({proposal.provider})</span>
          </p>
          <p className="flex items-center gap-2 text-[10px] text-[#62666f]">
            <span
              data-testid="editor-proposal-grounding"
              className={
                proposal.grounding.status === "SUPPORTED"
                  ? "text-[#4ade80]"
                  : "text-[#9aa0aa]"
              }
            >
              {proposal.grounding.status === "SUPPORTED"
                ? `Supported by ${proposal.grounding.claims.length} grounded claim(s)`
                : "No grounded copy context — nothing verified"}
            </span>
          </p>
          {proposal.grounding.status === "NO_CONTEXT" && proposal.grounding.reason && (
            <p className="text-[10px] text-[#62666f]">{proposal.grounding.reason}</p>
          )}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={busy}
              data-testid="editor-apply-button"
              onClick={() => void apply()}
            >
              Apply proposal
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              disabled={busy}
              data-testid="editor-discard-button"
              onClick={() => {
                setProposal(null);
                setError("");
              }}
            >
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}