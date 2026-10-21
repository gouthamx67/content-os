"use client";

import { useState } from "react";
import { Download, Film, Loader2 } from "lucide-react";
import { Button } from "../ui/Button";
import {
  buildStoryboardVideoPlan,
  STORYBOARD_VIDEO_FORMATS,
  type StoryboardVideoFormat,
  type StoryboardVideoStoryboard,
} from "../../modules/visual-motion-engine/storyboard-video";
import {
  generateStoryboardVideo,
  StoryboardVideoRequestError,
} from "../../lib/storyboard-video-client";

const FORMAT_LABELS: Record<StoryboardVideoFormat, string> = {
  VERTICAL: "Vertical · 9:16",
  LANDSCAPE: "Landscape · 16:9",
  SQUARE: "Square · 1:1",
};

function clock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The project-page video action.
 *
 * It renders the latest storyboard into a real MP4 without leaving the page:
 * scenes are laid out as timed text over the uploaded product screenshot, then
 * the existing render worker produces the file. It is deliberately silent —
 * narration needs an audio source this panel does not have.
 */
export function StoryboardVideoPanel({
  projectId,
  storyboard,
  backgroundAssetId,
}: {
  projectId: string;
  storyboard: StoryboardVideoStoryboard;
  backgroundAssetId: string | null;
}) {
  const [format, setFormat] = useState<StoryboardVideoFormat>("VERTICAL");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [compositionId, setCompositionId] = useState("");

  async function generate() {
    setBusy(true);
    setError("");
    setVideoUrl("");
    setProgressPct(null);
    setMessage("Preparing the video");

    const plan = buildStoryboardVideoPlan({
      storyboard,
      format,
      backgroundAssetId,
    });

    try {
      const result = await generateStoryboardVideo({
        projectId,
        plan,
        onProgress: (progress) => {
          setMessage(progress.message);
          setProgressPct(progress.progressPct ?? null);
        },
      });
      setVideoUrl(result.downloadUrl);
      setCompositionId(result.compositionId);
      setMessage("Video ready");
      setProgressPct(100);
    } catch (caught) {
      setError(
        caught instanceof StoryboardVideoRequestError
          ? caught.message
          : "The video could not be rendered",
      );
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="video"
      className="scroll-mt-6 rounded-2xl border border-[#2b3038] bg-[#101216] p-5 sm:p-6"
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[#7f8795]">
        <Film size={14} />
        Make the video
      </div>

      <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-white">
            Turn this script into a video
          </h2>
          <p className="mt-1 max-w-xl text-sm text-[#878d99]">
            {storyboard.scenes.length} scenes · {clock(storyboard.durationMs)} ·
            silent MP4. It uses the uploaded screenshot as the background and
            the storyboard text as timed titles.
          </p>
        </div>

        <label className="flex flex-col gap-1 text-xs text-[#8b8f98]">
          Format
          <select
            aria-label="Video format"
            value={format}
            disabled={busy}
            onChange={(event) => {
              setFormat(event.target.value as StoryboardVideoFormat);
              setVideoUrl("");
              setMessage("");
              setError("");
            }}
            className="min-h-10 rounded-lg border border-[#24272e] bg-[#15171c] px-2 text-sm text-white"
          >
            {STORYBOARD_VIDEO_FORMATS.map((value) => (
              <option key={value} value={value}>
                {FORMAT_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void generate()} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
          {busy ? "Making the video…" : videoUrl ? "Make another video" : "Generate video"}
        </Button>

        {message ? (
          <span className="text-xs text-[#8b8f98]">
            {message}
            {progressPct !== null && busy ? ` · ${progressPct}%` : ""}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-[#3a2222] bg-[#1d1111] p-3 text-xs text-red-300">
          {error}
        </p>
      ) : null}

      {videoUrl ? (
        <div className="mt-4 space-y-3">
          <video
            controls
            src={videoUrl}
            className="max-h-[420px] w-full rounded-lg border border-[#24272e] bg-black"
          />
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <a
              href={videoUrl}
              download
              className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300"
            >
              <Download size={13} />
              Download MP4
            </a>
            <a
              href={`/projects/${projectId}/visual/${compositionId}`}
              className="text-[#8b8f98] hover:text-white"
            >
              Open in the editor
            </a>
          </div>
        </div>
      ) : null}
    </section>
  );
}
