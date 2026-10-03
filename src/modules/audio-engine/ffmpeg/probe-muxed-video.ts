import { spawn } from "node:child_process";
import { AudioExecutionError } from "../errors";

export type ProbedMuxedVideo = {
  formatName: string;
  durationMs: number;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
  videoStreams: number;
  audioStreams: number;
};

type StreamJson = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
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

async function runFfprobe(filePath: string): Promise<string> {
  const args = [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ];

  return new Promise<string>((resolve, reject) => {
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
      else reject(new AudioExecutionError(stderr.trim() || "ffprobe failed"));
    });
  });
}

export async function probeMuxedVideo(
  filePath: string,
): Promise<ProbedMuxedVideo> {
  let parsed: ProbeJson;
  try {
    parsed = JSON.parse(await runFfprobe(filePath)) as ProbeJson;
  } catch (error) {
    if (error instanceof AudioExecutionError) throw error;
    throw new AudioExecutionError("ffprobe returned unreadable output");
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");

  const durationSeconds = Number(
    parsed.format?.duration ?? video?.duration ?? audio?.duration ?? "0",
  );
  const sampleRate = Number(audio?.sample_rate ?? "0");

  return {
    formatName: parsed.format?.format_name ?? "",
    durationMs: Number.isFinite(durationSeconds)
      ? Math.round(durationSeconds * 1000)
      : 0,
    width: typeof video?.width === "number" ? video.width : null,
    height: typeof video?.height === "number" ? video.height : null,
    frameRate: parseFrameRate(video?.avg_frame_rate),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : null,
    channels: typeof audio?.channels === "number" ? audio.channels : null,
    videoStreams: streams.filter((stream) => stream.codec_type === "video").length,
    audioStreams: streams.filter((stream) => stream.codec_type === "audio").length,
  };
}
