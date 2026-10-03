"use client";

import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { AudioTimeline } from "./AudioTimeline";
import {
  AudioTrackInspector,
  type AudioTrackChanges,
  type AutomationInput,
} from "./AudioTrackInspector";
import { AudioPreview } from "./AudioPreview";
import type {
  AudioArtifactView,
  AudioCompositionView,
  AudioKind,
  AudioRenderJobView,
  MuxedArtifactView,
} from "./types";

interface Props {
  projectId: string;
  compositionId: string;
  initialComposition: AudioCompositionView;
}

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

/**
 * The audio side of the composition editor.
 *
 * It owns one audio composition per visual composition: add tracks, shape the
 * mix, render a WAV, and once the video master exists render the muxed MP4.
 * The job is polled because rendering is done by a separate worker process.
 */
export function AudioWorkspace({
  projectId,
  compositionId,
  initialComposition,
}: Props) {
  const base = `/api/projects/${projectId}/audio/compositions/${compositionId}`;

  const [composition, setComposition] =
    useState<AudioCompositionView>(initialComposition);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(
    initialComposition.tracks[0]?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [kind, setKind] = useState<AudioKind>("VOICEOVER");
  const [sourceRef, setSourceRef] = useState("");
  const [durationMs, setDurationMs] = useState("1000");

  const [job, setJob] = useState<AudioRenderJobView | null>(null);
  const [audioArtifact, setAudioArtifact] =
    useState<AudioArtifactView | null>(null);
  const [muxedArtifact, setMuxedArtifact] =
    useState<MuxedArtifactView | null>(null);

  const selectedTrack =
    composition.tracks.find((track) => track.id === selectedTrackId) ?? null;

  async function load() {
    const response = await fetch(base, { credentials: "include" });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(payload.error ?? `Failed to load audio (${response.status})`);
      return;
    }

    const payload = (await response.json()) as {
      audioComposition: AudioCompositionView;
    };
    setComposition(payload.audioComposition);
    setSelectedTrackId(
      (current) => current ?? payload.audioComposition.tracks[0]?.id ?? null,
    );
  }

  async function send(
    url: string,
    method: string,
    body?: unknown,
  ): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(url, {
        method,
        credentials: "include",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(payload.error ?? `Request failed (${response.status})`);
        return null;
      }

      if (response.status === 204) return {};

      return (await response.json()) as Record<string, unknown>;
    } catch {
      setError("Network error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function addTrack() {
    if (sourceRef.trim().length === 0) {
      setError("Enter a capture: or asset: reference first");
      return;
    }

    const result = await send(`${base}/tracks`, "POST", {
      kind,
      name: `${kind.charAt(0)}${kind.slice(1).toLowerCase()}`,
      sourceRef: sourceRef.trim(),
      durationMs: Number(durationMs),
    });

    if (result) {
      setSourceRef("");
      await load();
      setNotice("Track added");
    }
  }

  async function saveTrack(changes: AudioTrackChanges) {
    if (!selectedTrack) return;
    const result = await send(
      `${base}/tracks/${selectedTrack.id}`,
      "PATCH",
      changes,
    );
    if (result) {
      await load();
      setNotice("Track updated");
    }
  }

  async function deleteTrack() {
    if (!selectedTrack) return;
    const result = await send(`${base}/tracks/${selectedTrack.id}`, "DELETE");
    if (result) {
      setSelectedTrackId(null);
      await load();
      setNotice("Track removed");
    }
  }

  async function addAutomation(input: AutomationInput) {
    if (!selectedTrack) return;
    const result = await send(
      `${base}/tracks/${selectedTrack.id}/automation`,
      "POST",
      { ...input, property: "VOLUME_DB" },
    );
    if (result) {
      await load();
      setNotice("Automation saved");
    }
  }

  async function poll(jobId: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await fetch(
        `/api/projects/${projectId}/audio/renders/${jobId}`,
        { credentials: "include" },
      );

      if (!response.ok) {
        setError(`Render status failed (${response.status})`);
        return;
      }

      const payload = (await response.json()) as {
        audioRenderJob: AudioRenderJobView;
        audioArtifact: AudioArtifactView | null;
        muxedArtifact: MuxedArtifactView | null;
      };

      setJob(payload.audioRenderJob);
      setAudioArtifact(payload.audioArtifact);
      setMuxedArtifact(payload.muxedArtifact);

      if (TERMINAL.has(payload.audioRenderJob.status)) {
        if (payload.audioRenderJob.status === "SUCCEEDED") {
          setNotice(payload.muxedArtifact ? "Final video ready" : "Audio ready");
        } else {
          setError(
            payload.audioRenderJob.errorMessage ?? "Audio render failed",
          );
        }
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    setError("Timed out waiting for the audio render");
  }

  async function renderAudio() {
    const result = await send(`${base}/render`, "POST", {});
    const created = result?.["audioRenderJob"] as AudioRenderJobView | undefined;
    if (created) await poll(created.id);
  }

  async function renderFinalVideo() {
    const listResponse = await fetch(
      `/api/projects/${projectId}/visual/compositions/${compositionId}/render`,
      { credentials: "include" },
    );

    if (!listResponse.ok) {
      setError("Could not list video renders");
      return;
    }

    const list = (await listResponse.json()) as {
      renderJobs: Array<{ id: string; status: string }>;
    };
    const ready = [...list.renderJobs]
      .reverse()
      .find((entry) => entry.status === "SUCCEEDED");

    if (!ready) {
      setError("Render the video first, then render the final video");
      return;
    }

    const result = await send(`${base}/render`, "POST", {
      videoRenderJobId: ready.id,
    });
    const created = result?.["audioRenderJob"] as AudioRenderJobView | undefined;
    if (created) await poll(created.id);
  }

  return (
    <section
      data-testid="audio-workspace"
      className="space-y-4 rounded-2xl border border-[#202329] bg-[#0b0c0f] p-5"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Audio</h2>
        <span className="text-[10px] text-[#62666f]">
          {composition
            ? `${composition.sampleRate} Hz · ${composition.channels}ch · ${composition.durationMs}ms`
            : "loading…"}
        </span>
      </div>

      {(error || notice) && (
        <p
          data-testid="audio-status"
          className={[
            "rounded-md border px-3 py-2 text-xs",
            error
              ? "border-red-500/40 bg-red-500/10 text-red-300"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
          ].join(" ")}
        >
          {error || notice}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-[10px] text-[#62666f]">
          Kind
          <select
            data-testid="audio-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as AudioKind)}
            className="block rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          >
            <option value="VOICEOVER">VOICEOVER</option>
            <option value="MUSIC">MUSIC</option>
            <option value="SFX">SFX</option>
            <option value="AMBIENCE">AMBIENCE</option>
          </select>
        </label>

        <label className="flex-1 space-y-1 text-[10px] text-[#62666f]">
          Source reference
          <input
            data-testid="audio-source"
            value={sourceRef}
            onChange={(event) => setSourceRef(event.target.value)}
            placeholder="capture:takeId or asset:id"
            className="block w-full rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          />
        </label>

        <label className="space-y-1 text-[10px] text-[#62666f]">
          Duration ms
          <input
            data-testid="audio-duration"
            value={durationMs}
            onChange={(event) => setDurationMs(event.target.value)}
            inputMode="numeric"
            className="block w-24 rounded-md border border-[#30343c] bg-[#15171c] px-2 py-1.5 text-xs text-white"
          />
        </label>

        <Button
          variant="secondary"
          data-testid="audio-add-track"
          disabled={busy}
          onClick={() => void addTrack()}
        >
          Add track
        </Button>
      </div>

      {composition && (
        <AudioTimeline
          tracks={composition.tracks}
          durationMs={composition.durationMs}
          selectedTrackId={selectedTrackId}
          onSelect={setSelectedTrackId}
        />
      )}

      {selectedTrack && (
        <AudioTrackInspector
          key={selectedTrack.id}
          track={selectedTrack}
          busy={busy}
          onSave={saveTrack}
          onDelete={deleteTrack}
          onAddAutomation={addAutomation}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          data-testid="audio-render"
          disabled={busy}
          onClick={() => void renderAudio()}
        >
          Render audio
        </Button>
        <Button
          variant="secondary"
          data-testid="audio-render-final"
          disabled={busy}
          onClick={() => void renderFinalVideo()}
        >
          Render final video
        </Button>
        {job && (
          <span data-testid="audio-render-status" className="text-xs text-[#b4b7bf]">
            {job.status} · {job.progressPct}%
          </span>
        )}
      </div>

      <AudioPreview
        audioUrl={audioArtifact?.streamUrl ?? null}
        videoUrl={muxedArtifact?.streamUrl ?? null}
      />
    </section>
  );
}
