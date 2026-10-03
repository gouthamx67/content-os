import { spawn } from "node:child_process";
import { RenderCancelledError, RenderExecutionError } from "../errors";

export type FfmpegProgress = {
  percent: number;
  outTimeMs: number;
  frame: number;
};

export type RunFfmpegOptions = {
  totalDurationMs?: number;
  onProgress?: (progress: FfmpegProgress) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Keeps the tail of stderr for diagnostics without unbounded growth. */
  stderrLimit?: number;
};

export type RunFfmpegResult = {
  stderr: string;
};

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_STDERR_LIMIT = 64 * 1024;
const KILL_GRACE_MS = 2_000;

/**
 * Runs FFmpeg with an explicit argument array.
 *
 * The executable is always the literal `ffmpeg` and the arguments are never
 * joined into a shell string: user-controlled text (a layer name, a storage
 * path) reaches FFmpeg as a single argv element, so there is no shell to
 * interpret it. Progress arrives on stdout via `-progress pipe:1`, which means
 * stderr stays a clean diagnostic channel.
 */
export function runFfmpeg(
  args: readonly string[],
  options: RunFfmpegOptions = {},
): Promise<RunFfmpegResult> {
  const {
    totalDurationMs = 0,
    onProgress,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    stderrLimit = DEFAULT_STDERR_LIMIT,
  } = options;

  return new Promise<RunFfmpegResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RenderCancelledError());
      return;
    }

    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-progress",
        "pipe:1",
        "-nostats",
        ...args,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stderr = "";
    let stdoutBuffer = "";
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve({ stderr });
    };

    const onAbort = () => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, KILL_GRACE_MS).unref();
      finish(new RenderCancelledError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new RenderExecutionError("ffmpeg timed out"));
    }, timeoutMs);
    timeout.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      let frame = 0;
      let outTimeMs = 0;
      let sawProgress = false;

      for (const line of lines) {
        const [rawKey, rawValue] = line.split("=");
        if (!rawKey || rawValue === undefined) continue;
        if (rawKey === "frame") frame = Number(rawValue) || 0;
        else if (rawKey === "out_time_ms") {
          const micros = Number(rawValue);
          if (Number.isFinite(micros)) outTimeMs = micros / 1000;
        } else if (rawKey === "out_time_us") {
          const micros = Number(rawValue);
          if (Number.isFinite(micros)) outTimeMs = micros / 1000;
        } else if (rawKey === "progress") {
          sawProgress = true;
        }
      }

      if (sawProgress && onProgress) {
        const percent =
          totalDurationMs > 0
            ? Math.max(0, Math.min(100, (outTimeMs / totalDurationMs) * 100))
            : 0;
        onProgress({ percent, outTimeMs, frame });
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > stderrLimit) {
        stderr = stderr.slice(stderr.length - stderrLimit);
      }
    });

    child.on("error", (error) => {
      finish(new RenderExecutionError(error.message));
    });

    child.on("close", (code) => {
      if (settled) return;
      if (code === 0) {
        finish();
        return;
      }
      const detail = stderr.trim().split("\n").slice(-4).join(" ").trim();
      finish(
        new RenderExecutionError(
          detail.length > 0 ? detail : `ffmpeg exited with code ${code ?? 1}`,
        ),
      );
    });
  });
}
