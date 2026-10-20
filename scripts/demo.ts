import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";

/**
 * One-command local demo.
 *
 * The web process only enqueues work; writing, images, audio, rendering,
 * multiformat and publishing are consumed by separate worker processes that
 * poll Postgres. Running each in its own terminal is correct but unfriendly
 * for a first look, so this script owns them all: one process group per child,
 * prefixed output, and a single Ctrl+C that tears down every group.
 */

type Managed = {
  name: string;
  child: ChildProcess;
};

const WORKERS = [
  ["writing", "src/scripts/writing-worker.ts"],
  ["image", "src/scripts/image-generation-worker.ts"],
  ["audio", "src/scripts/audio-worker.ts"],
  ["render", "src/scripts/render-worker.ts"],
  ["multiformat", "src/scripts/multiformat-worker.ts"],
  ["publishing", "src/scripts/publishing-worker.ts"],
] as const;

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";
const npx = isWindows ? "npx.cmd" : "npx";
const port = process.env["PORT"] ?? "3000";
const managed: Managed[] = [];
let shuttingDown = false;

const env: NodeJS.ProcessEnv = {
  ...process.env,
  // A demo should exercise the real interpretation seams. An explicit value
  // from the operator (including "0") always wins.
  CONTENT_OS_AI_INTERPRETATION:
    process.env["CONTENT_OS_AI_INTERPRETATION"] ?? "1",
};

function prefixLines(
  stream: NodeJS.ReadableStream | null,
  name: string,
  toStderr: boolean,
): void {
  if (!stream) return;
  let buffered = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      const target = toStderr ? process.stderr : process.stdout;
      target.write(`[${name}] ${line}\n`);
    }
  });
}

function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (isWindows) child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
  });
}

async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write("\n[demo] stopping web and workers…\n");

  const exits = Promise.all(managed.map((entry) => waitForExit(entry.child)));
  for (const entry of managed) signalChild(entry.child, "SIGTERM");
  await Promise.race([exits, sleep(6_000)]);

  for (const entry of managed) {
    if (entry.child.exitCode === null && entry.child.signalCode === null) {
      signalChild(entry.child, "SIGKILL");
    }
  }
  await Promise.race([exits, sleep(2_000)]);
  process.exit(code);
}

function start(name: string, command: string, args: string[]): void {
  const child = spawn(command, args, {
    env,
    // Worker output is useful (honest failures, provider fallbacks), so pipe
    // it with a name prefix instead of hiding it.
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWindows,
  });

  managed.push({ name, child });
  prefixLines(child.stdout, name, false);
  prefixLines(child.stderr, name, true);

  child.on("error", (error) => {
    process.stderr.write(`[demo] ${name} could not start: ${error.message}\n`);
    void shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const how = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    process.stderr.write(
      `[demo] ${name} exited unexpectedly (${how}); stopping the rest\n`,
    );
    void shutdown(code && code > 0 ? code : 1);
  });
}

if (!process.env["DATABASE_URL"]) {
  process.stderr.write(
    "[demo] DATABASE_URL is not set. Copy .env.example to .env and start Postgres\n" +
      "[demo] (docker compose up -d postgres), then run `npm run demo` again.\n",
  );
  process.exit(1);
}

process.stdout.write(
  [
    "content-os demo",
    `  web:      http://localhost:${port}`,
    `  workers:  ${WORKERS.map(([name]) => name).join(", ")}`,
    `  AI seams: ${
      env["CONTENT_OS_AI_INTERPRETATION"] === "1" ? "enabled" : "disabled"
    } (CONTENT_OS_AI_INTERPRETATION=${env["CONTENT_OS_AI_INTERPRETATION"]})`,
    "  stop:     Ctrl+C",
    "",
  ].join("\n"),
);

start("web", npm, ["run", "dev"]);
for (const [name, script] of WORKERS) {
  start(name, npx, ["tsx", script]);
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
