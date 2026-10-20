import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

/**
 * Process plumbing for the browser suite.
 *
 * Every helper is spawned in its own process group. `npm`/`npx` are wrappers:
 * signalling the wrapper alone leaves the real `next start` or `tsx` worker
 * running, which is how a stale server ends up answering the next spec. The
 * group signal reaches the wrapper and everything it started.
 */
export function spawnDetached(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): ChildProcess {
  return spawn(command, args, {
    ...options,
    detached: true,
    stdio: "ignore",
  });
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (hasExited(child)) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process is already gone.
    }
  }
}

/** Stops a detached child and everything in its process group. */
export async function stopDetached(
  child: ChildProcess | undefined,
  timeoutMs = 5_000,
): Promise<void> {
  if (!child || !child.pid) return;
  signalGroup(child, "SIGTERM");
  await waitForExit(child, timeoutMs);
  if (!hasExited(child)) {
    signalGroup(child, "SIGKILL");
    await waitForExit(child, 2_000);
  }
}
