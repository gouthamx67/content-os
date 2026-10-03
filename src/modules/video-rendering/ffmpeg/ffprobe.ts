import { spawn } from "node:child_process";
import { RenderExecutionError } from "../errors";

export type ProbedMedia = {
  formatName: string;
  durationMs: number;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  frameRate: number | null;
  videoStreams: number;
  audioStreams: number;
};

type StreamJson = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  duration?: string;
};

type ProbeJson = {
  format?: { format_name?: string; duration?: string };
  streams?: StreamJson[];
};

function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null;
  const [num, den] = value.split("/").map((part) => Number(part));
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  const rate = num / den;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export async function probeMedia(filePath: string): Promise<ProbedMedia> {
  const args = [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ];

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new RenderExecutionError(stderr.trim() || "ffprobe failed"));
    });
  });

  let parsed: ProbeJson;
  try {
    parsed = JSON.parse(output) as ProbeJson;
  } catch {
    throw new RenderExecutionError("ffprobe returned unreadable output");
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audioStreams = streams.filter(
    (stream) => stream.codec_type === "audio",
  ).length;

  const durationSeconds = Number(
    parsed.format?.duration ?? video?.duration ?? "0",
  );

  return {
    formatName: parsed.format?.format_name ?? "",
    durationMs: Number.isFinite(durationSeconds)
      ? Math.round(durationSeconds * 1000)
      : 0,
    width: typeof video?.width === "number" ? video.width : null,
    height: typeof video?.height === "number" ? video.height : null,
    videoCodec: video?.codec_name ?? null,
    frameRate: parseFrameRate(video?.avg_frame_rate),
    videoStreams: streams.filter((stream) => stream.codec_type === "video").length,
    audioStreams,
  };
}
