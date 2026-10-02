"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  Circle,
  FileVideo,
  Loader2,
  MonitorUp,
  Mic,
  RotateCcw,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "../../../../../components/ui/Button";
import {
  beginCapture,
  isCaptureSupported,
  stopTracks,
  type ActiveCapture,
  type BrowserCaptureMode,
} from "../../../../../modules/capture-engine/browser/capture-controller";
import {
  probeImportedFile,
  validateImportedFile,
} from "../../../../../modules/capture-engine/browser/file-import";
import {
  CAPTURE_MODE_LABELS,
  formatBytes,
  formatDuration,
  type SerializedCapturePlanItem,
  type SerializedCaptureSession,
  type SerializedCaptureTake,
} from "../../../../../lib/capture-api";

type WorkspaceMode = BrowserCaptureMode | "FILE";

interface Props {
  projectId: string;
  session: SerializedCaptureSession;
  initialTakes: SerializedCaptureTake[];
  capturePlan: SerializedCapturePlanItem[];
  initialShotId?: string | null;
}

const MODE_ICONS: Record<WorkspaceMode, typeof Camera> = {
  CAMERA: Camera,
  MICROPHONE: Mic,
  SCREEN: MonitorUp,
  FILE: Upload,
};

export function CaptureWorkspace({
  projectId,
  session,
  initialTakes,
  capturePlan,
  initialShotId,
}: Props) {
  const [currentSession, setCurrentSession] = useState(session);
  const [takes, setTakes] = useState(initialTakes);
  const [shotId, setShotId] = useState<string | null>(
    initialShotId ?? capturePlan[0]?.shotId ?? null,
  );
  const [mode, setMode] = useState<WorkspaceMode>("CAMERA");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const activeRef = useRef<ActiveCapture | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedShot = capturePlan.find((item) => item.shotId === shotId) ?? null;
  const availableModes: WorkspaceMode[] = selectedShot
    ? selectedShot.availableModes
    : (["CAMERA", "MICROPHONE", "SCREEN", "FILE"] as WorkspaceMode[]);

  const isLocked =
    currentSession.status === "COMPLETED" || currentSession.status === "CANCELLED";

  /**
   * Re-reads the session from PostgreSQL. Every mutation is followed by this,
   * so what the screen shows after an action is what a refresh would show — the
   * UI never asserts a state the database has not confirmed.
   */
  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/projects/${projectId}/capture/sessions/${currentSession.id}`,
      { credentials: "include" },
    );

    if (!response.ok) {
      return;
    }

    const body = (await response.json()) as {
      session: SerializedCaptureSession;
      takes: SerializedCaptureTake[];
    };

    setCurrentSession(body.session);
    setTakes(body.takes);
  }, [projectId, currentSession.id]);

  useEffect(() => {
    return () => {
      activeRef.current?.stop();
      if (activeRef.current) {
        stopTracks(activeRef.current.stream);
      }
    };
  }, []);

  async function startSession() {
    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/capture/sessions/${currentSession.id}/start`,
        { method: "POST", credentials: "include" },
      );

      if (!response.ok) {
        throw new Error(await readError(response, "Unable to start session"));
      }

      setMessage("Session active");
      await refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function begin() {
    setError("");
    setMessage("");

    if (mode === "FILE") {
      fileInputRef.current?.click();
      return;
    }

    if (!isCaptureSupported()) {
      setError("This browser cannot capture media.");
      return;
    }

    try {
      const active = await beginCapture(mode);
      activeRef.current = active;
      setRecording(true);

      if (previewRef.current && mode !== "MICROPHONE") {
        previewRef.current.srcObject = active.stream;
        await previewRef.current.play().catch(() => undefined);
      }

      const captured = await active.capture;
      await uploadTake(captured.blob, mode, captured.durationMs, {
        width: captured.width,
        height: captured.height,
      });
    } catch (caught) {
      // A denied permission is the common case and deserves its own wording:
      // "NotAllowedError" tells the user nothing they can act on.
      setError(describeCaptureError(caught));
    } finally {
      stopPreview();
      activeRef.current = null;
      setRecording(false);
    }
  }

  function stop() {
    activeRef.current?.stop();
    setRecording(false);
    stopPreview();
  }

  function stopPreview() {
    if (previewRef.current) {
      previewRef.current.srcObject = null;
    }
  }

  async function uploadTake(
    blob: Blob,
    uploadMode: WorkspaceMode,
    durationMs?: number,
    dimensions?: { width?: number; height?: number },
    retakeOf?: string,
  ) {
    setBusy(true);

    try {
      const form = new FormData();
      const extension = uploadMode === "MICROPHONE" ? "weba" : "webm";

      form.append("file", blob, `${uploadMode.toLowerCase()}-${Date.now()}.${extension}`);
      form.append("mode", uploadMode === "FILE" ? "FILE" : uploadMode);

      if (shotId) form.append("shotId", shotId);
      if (retakeOf) form.append("retakeOf", retakeOf);

      const metadata: Record<string, number> = {};
      if (durationMs && durationMs > 0) metadata.durationMs = Math.round(durationMs);
      if (dimensions?.width) metadata.width = dimensions.width;
      if (dimensions?.height) metadata.height = dimensions.height;

      if (Object.keys(metadata).length > 0) {
        form.append("metadata", JSON.stringify(metadata));
      }

      const response = await fetch(
        `/api/projects/${projectId}/capture/sessions/${currentSession.id}/takes`,
        { method: "POST", body: form, credentials: "include" },
      );

      if (!response.ok) {
        throw new Error(await readError(response, "Unable to save take"));
      }

      setMessage(retakeOf ? "Retake saved" : "Take saved");
      await refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onFileChosen(file: File | undefined) {
    if (!file) return;

    setError("");
    setMessage("");

    try {
      validateImportedFile(file);
    } catch (caught) {
      setError(describeError(caught));
      return;
    }

    const probed = await probeImportedFile(file);
    await uploadTake(file, "FILE", probed.durationMs, {
      width: probed.width,
      height: probed.height,
    });
  }

  async function takeAction(
    takeId: string,
    action: "accept" | "reject" | "delete",
  ) {
    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/capture/sessions/${currentSession.id}/takes/${takeId}/${action}`,
        { method: "POST", credentials: "include" },
      );

      if (!response.ok) {
        throw new Error(await readError(response, `Unable to ${action} take`));
      }

      setMessage(`Take ${action}ed`);
      await refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function retake(take: SerializedCaptureTake) {
    // A retake clones the shot but never touches the prior take's bytes: the new
    // recording becomes its own row, and the accepted one stays accepted until
    // the user accepts the replacement.
    setShotId(take.shotId ?? shotId);
    setMode((take.mode as WorkspaceMode) ?? mode);
    setMessage("Retake ready — start a new capture for this shot");
    await refresh();
  }

  async function complete() {
    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/capture/sessions/${currentSession.id}/complete`,
        { method: "POST", credentials: "include" },
      );

      if (!response.ok) {
        throw new Error(await readError(response, "Unable to complete session"));
      }

      setMessage("Session completed");
      await refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const acceptedCount = takes.filter((take) => take.status === "ACCEPTED").length;
  const visibleTakes = takes.filter((take) => take.status !== "DELETED");

  return (
    <div className="space-y-6">
      <section aria-label="Capture workspace" className="space-y-4">
        {capturePlan.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {capturePlan.map((item, index) => (
              <button
                key={item.shotId}
                type="button"
                onClick={() => setShotId(item.shotId)}
                disabled={recording || busy}
                className={[
                  "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                  item.shotId === shotId
                    ? "border-white bg-white text-black"
                    : "border-[#30343c] bg-[#15171c] text-[#b4b7bf] hover:text-white",
                ].join(" ")}
              >
                Shot {String(index + 1).padStart(2, "0")} — {item.shotTitle}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#777b84]">
            No storyboard is attached, so there are no shot requirements. Capture
            is still available for a general take.
          </p>
        )}

        {selectedShot ? (
          <div className="rounded-xl border border-[#24272e] bg-[#15171c] p-4">
            <p className="text-xs uppercase tracking-wide text-[#62666f]">
              {selectedShot.required ? "Required capture" : "Capture guidance"}
            </p>
            <h2 className="mt-1 text-sm font-medium text-white">
              {selectedShot.shotTitle}
            </h2>
            <p className="mt-2 text-xs text-[#9a9ea7]">
              Required:{" "}
              {selectedShot.requiredModes.length > 0
                ? selectedShot.requiredModes
                    .map((m) => CAPTURE_MODE_LABELS[m] ?? m)
                    .join(", ")
                : "any mode"}
            </p>
            {selectedShot.instructions.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[#9a9ea7]">
                {selectedShot.instructions.map((instruction, index) => (
                  <li key={index}>{instruction}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {availableModes.map((candidate) => {
            const Icon = MODE_ICONS[candidate];
            const active = mode === candidate;

            return (
              <Button
                key={candidate}
                type="button"
                variant={active ? "primary" : "secondary"}
                onClick={() => setMode(candidate)}
                disabled={recording || busy || isLocked}
              >
                <Icon size={14} />
                {CAPTURE_MODE_LABELS[candidate]}
              </Button>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-xl border border-[#24272e] bg-black">
          {mode === "MICROPHONE" ? (
            <div className="flex h-56 items-center justify-center text-[#62666f]">
              <Mic size={36} />
            </div>
          ) : (
            <video
              ref={previewRef}
              playsInline
              muted
              className="h-56 w-full object-contain"
            />
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/webm,audio/wav"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void onFileChosen(file);
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          {currentSession.status === "DRAFT" ? (
            <Button type="button" onClick={startSession} disabled={busy}>
              Start session
            </Button>
          ) : !recording ? (
            <Button
              type="button"
              onClick={begin}
              disabled={busy || isLocked}
            >
              {mode === "FILE" ? (
                <>
                  <Upload size={14} /> Import file
                </>
              ) : (
                <>
                  <Circle size={12} /> Start capture
                </>
              )}
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={stop}>
              <Square size={12} /> Stop capture
            </Button>
          )}

          {recording ? (
            <span className="inline-flex items-center gap-2 text-xs text-red-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              Recording
            </span>
          ) : null}

          {busy ? (
            <span className="inline-flex items-center gap-2 text-xs text-[#9a9ea7]">
              <Loader2 size={14} className="animate-spin" /> Working
            </span>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="text-xs text-red-400">
            {error}
          </p>
        ) : null}
        {message ? (
          <p role="status" className="text-xs text-emerald-400">
            {message}
          </p>
        ) : null}
      </section>

      <section aria-label="Takes" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-white">
            Takes ({visibleTakes.length})
          </h2>
          <span className="text-xs text-[#62666f]">
            {acceptedCount} accepted
          </span>
        </div>

        {visibleTakes.length === 0 ? (
          <p className="text-xs text-[#777b84]">
            No takes yet. Every capture becomes its own take.
          </p>
        ) : (
          <ul className="space-y-2">
            {visibleTakes.map((take, index) => (
              <li
                key={take.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-[#24272e] bg-[#15171c] p-3"
              >
                <span className="text-xs text-[#62666f]">
                  Take {index + 1}
                </span>
                <span className="text-xs text-[#b4b7bf]">
                  {formatDuration(take.durationMs)}
                </span>
                <span className="text-xs text-[#62666f]">
                  {formatBytes(take.byteSize)} · {take.mimeType}
                </span>
                <span
                  className={[
                    "rounded-full border px-2 py-0.5 text-xs",
                    take.status === "ACCEPTED"
                      ? "border-emerald-700 text-emerald-400"
                      : take.status === "REJECTED"
                        ? "border-red-800 text-red-400"
                        : "border-[#30343c] text-[#b4b7bf]",
                  ].join(" ")}
                >
                  {take.status}
                </span>
                <span className="text-xs text-[#62666f]">
                  {CAPTURE_MODE_LABELS[take.mode] ?? take.mode}
                </span>

                <span className="ml-auto flex flex-wrap gap-2">
                  <a
                    href={`/api/projects/${projectId}/capture/takes/${take.id}/stream`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[#30343c] px-3 text-xs text-[#b4b7bf] hover:text-white"
                  >
                    <FileVideo size={12} /> View
                  </a>

                  {take.status !== "ACCEPTED" && currentSession.status === "ACTIVE" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-8 px-3 text-xs"
                      disabled={busy || isLocked}
                      onClick={() => takeAction(take.id, "accept")}
                    >
                      <Check size={12} /> Accept
                    </Button>
                  ) : null}

                  {take.status === "READY" && currentSession.status === "ACTIVE" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-8 px-3 text-xs"
                      disabled={busy || isLocked}
                      onClick={() => takeAction(take.id, "reject")}
                    >
                      <X size={12} /> Reject
                    </Button>
                  ) : null}

                  {take.status === "ACCEPTED" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-8 px-3 text-xs"
                      disabled={busy || isLocked}
                      onClick={() => retake(take)}
                    >
                      <RotateCcw size={12} /> Retake
                    </Button>
                  ) : null}

                  {!isLocked ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-8 px-3 text-xs"
                      disabled={busy}
                      onClick={() => takeAction(take.id, "delete")}
                    >
                      <Trash2 size={12} /> Delete
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}

        {currentSession.status === "ACTIVE" || currentSession.status === "REVIEW" ? (
          <div className="pt-2">
            <Button type="button" onClick={complete} disabled={busy || acceptedCount === 0}>
              <Check size={14} /> Complete session
            </Button>
            {acceptedCount === 0 ? (
              <p className="mt-2 text-xs text-[#777b84]">
                A session completes once at least one take is accepted.
              </p>
            ) : null}
          </div>
        ) : null}

        {currentSession.status === "COMPLETED" ? (
          <p className="text-xs text-emerald-400">
            Session completed
            {currentSession.completedAt
              ? ` on ${new Date(currentSession.completedAt).toLocaleString()}`
              : ""}
            .
          </p>
        ) : null}
      </section>
    </div>
  );
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function describeCaptureError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Permission was denied. Allow this site to use the camera, microphone or screen and try again.";
    }
    if (error.name === "NotFoundError") {
      return "No camera or microphone was found on this device.";
    }
  }

  return describeError(error);
}
