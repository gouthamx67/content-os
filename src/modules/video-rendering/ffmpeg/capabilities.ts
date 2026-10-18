import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { RenderExecutionError } from "../errors";

/**
 * The filters the compiler emits. If one is missing, the render is refused up
 * front with a capability error instead of failing halfway through a job with
 * an opaque FFmpeg exit code.
 */
export const REQUIRED_FFMPEG_FILTERS = [
  "overlay",
  "scale",
  "crop",
  "pad",
  "rotate",
  "drawtext",
  "geq",
  "colorchannelmixer",
  "eq",
  "gblur",
  "hue",
  "format",
  "trim",
  "setpts",
  "fps",
] as const;

export type FfmpegCapabilities = {
  version: string;
  filters: Record<string, boolean>;
};

const FONT_CANDIDATES = [
  "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/adwaita-sans-fonts/AdwaitaSans-Regular.ttf",
];

/** The first font the compiler can hand to `drawtext`, or null if none exists. */
export function defaultFontFile(): string | null {
  return FONT_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

const CAPABILITY_PROBE_TIMEOUT_MS = 10_000;

function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    // A hung binary must not hang readiness or a render worker's startup
    // capability check; the timeout is generous for `-filters` on slow hosts.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${CAPABILITY_PROBE_TIMEOUT_MS}ms`));
    }, CAPABILITY_PROBE_TIMEOUT_MS);
    timer.unref?.();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

export async function getFfmpegVersion(): Promise<string> {
  try {
    const { stdout } = await run("ffmpeg", ["-version"]);
    const first = stdout.split("\n")[0] ?? "";
    return first.trim();
  } catch {
    throw new RenderExecutionError("ffmpeg is not available");
  }
}

export async function getFfprobeVersion(): Promise<string> {
  try {
    const { stdout } = await run("ffprobe", ["-version"]);
    return (stdout.split("\n")[0] ?? "").trim();
  } catch {
    throw new RenderExecutionError("ffprobe is not available");
  }
}

export async function verifyFfmpegCapabilities(
  required: readonly string[] = REQUIRED_FFMPEG_FILTERS,
): Promise<FfmpegCapabilities> {
  const version = await getFfmpegVersion();

  let stdout: string;
  try {
    ({ stdout } = await run("ffmpeg", ["-hide_banner", "-filters"]));
  } catch {
    throw new RenderExecutionError("ffmpeg filter list could not be read");
  }

  const available = new Set<string>();
  for (const line of stdout.split("\n")) {
    const match = line.match(/^\s*[A-Z.]{3}\s+(\S+)/);
    if (match?.[1]) available.add(match[1]);
  }

  const filters: Record<string, boolean> = {};
  const missing: string[] = [];

  for (const filter of required) {
    filters[filter] = available.has(filter);
    if (!available.has(filter)) missing.push(filter);
  }

  if (missing.length > 0) {
    throw new RenderExecutionError(
      `ffmpeg is missing required filters: ${missing.join(", ")}`,
    );
  }

  return { version, filters };
}
