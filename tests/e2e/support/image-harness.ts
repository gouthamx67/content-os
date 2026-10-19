import { emptyStyle } from "../../../src/modules/editor-engine/domain/types";
import type { EditorNode } from "../../../src/modules/editor-engine/domain/types";
import {
  ensureMastodonStub,
  type MastodonStubController,
} from "./mastodon-stub";
import { spawn, type ChildProcess } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/**
 * Shared plumbing for the CP17 browser end-to-end specs.
 *
 * Each spec owns a real Chromium, a real database, and real workers. Nothing is
 * mocked: if the image worker is not running the specs would hang on a queued
 * job, which is the point — a generated image that never rasterised must fail
 * the suite rather than pass on a placeholder.
 */

/**
 * The autostarted server runs the production build rather than `next dev`.
 *
 * Next.js compiles route handlers lazily in development, so the first request a
 * fresh dev server ever sees pays a one-time compile. Batch work finishes faster
 * than that compile was measured to take, which made cancellation tests a race
 * nobody consciously wrote. A production server has every route compiled at build
 * time, so the first request behaves like every later one.
 */
let buildPromise: Promise<void> | undefined;

async function ensureProductionBuild(): Promise<void> {
  if (!buildPromise) {
    buildPromise = execFile("npm", ["run", "build"], {
      cwd: repoRoot,
    }).then(() => undefined);
  }
  await buildPromise;
}

export const BASE_URL =
  process.env["VISUAL_E2E_BASE_URL"] ?? "http://localhost:3000";
export const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://contentos:contentos@localhost:5433/content_os";
export const SESSION_COOKIE =
  process.env["SESSION_COOKIE_NAME"] ?? "content_os_session";
export const repoRoot = process.cwd();

/**
 * Every stack is started with a clearly-labeled stub Mastodon as the publishing
 * provider, so the CP23 browser specs exercise the real OAuth and status
 * protocol over HTTP without vendor credentials. Deployments without these
 * variables (including the production smoke) get the honest
 * "provider unavailable" path instead.
 */
const E2E_PUBLISHING_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveChromium(): Promise<string | undefined> {
  const explicit = process.env["CONTENT_OS_BROWSER_EXECUTABLE"];
  if (explicit && explicit.trim().length > 0) return explicit.trim();

  const cacheRoot =
    process.env["PLAYWRIGHT_BROWSERS_PATH"] ??
    path.join(homedir(), ".cache", "ms-playwright");

  let entries: string[];
  try {
    entries = await readdir(cacheRoot);
  } catch {
    return undefined;
  }

  const candidates = entries
    .filter(
      (entry) =>
        entry.startsWith("chromium-") ||
        entry.startsWith("chromium_headless_shell-"),
    )
    .sort()
    .reverse();

  for (const entry of candidates) {
    for (const relative of [
      "chrome-linux64/chrome",
      "chrome-linux/chrome",
      "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    ]) {
      const candidate = path.join(cacheRoot, entry, relative);
      if (await exists(candidate)) return candidate;
    }
  }

  for (const fallback of ["/usr/bin/google-chrome", "/usr/bin/chromium"]) {
    if (await exists(fallback)) return fallback;
  }

  return undefined;
}

export async function serverReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/login`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

export async function waitForServer(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await serverReachable()) return true;
    await sleep(1000);
  }
  return false;
}

export type E2EStack = {
  reachable: boolean;
  available: boolean;
  executablePath?: string;
  devServer?: ChildProcess;
  imageWorker?: ChildProcess;
  videoWorker?: ChildProcess;
  writingWorker?: ChildProcess;
  multiformatWorker?: ChildProcess;
  publishingWorker?: ChildProcess;
  mastodonStub?: MastodonStubController;
  startedDevServer: boolean;
};

/**
 * Starts whatever is missing for a real generation run: the Next.js server (a
 * one-time production build that it then serves — see `ensureProductionBuild`),
 * the CP17 image worker, and (when requested) the CP15 render worker.
 */
function publishingEnvironment(): Record<string, string> {
  const stub = process.env["PUBLISHING_MASTODON_BASE_URL"];
  return {
    ...(stub ? { PUBLISHING_MASTODON_BASE_URL: stub } : {}),
    PUBLISHING_MASTODON_CLIENT_ID:
      process.env["PUBLISHING_MASTODON_CLIENT_ID"] ?? "e2e-client",
    PUBLISHING_MASTODON_CLIENT_SECRET:
      process.env["PUBLISHING_MASTODON_CLIENT_SECRET"] ?? "e2e-secret",
    PUBLISHING_SECRET_KEY:
      process.env["PUBLISHING_SECRET_KEY"] ?? E2E_PUBLISHING_SECRET_KEY,
  };
}

export function spawnPublishingWorker(): ChildProcess {
  return spawn("npx", ["tsx", "src/scripts/publishing-worker.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL, SESSION_COOKIE_NAME: SESSION_COOKIE },
    stdio: "ignore",
  });
}

export async function startStack(options?: {
  withRenderWorker?: boolean;
  withMultiformatWorker?: boolean;
  withPublishingWorker?: boolean;
  /**
   * The production smoke needs the honest "no provider configured" path, so it
   * asks for a stack where no publishing variables are set at all. Every other
   * spec runs against the stub provider.
   */
  withoutPublishingConfig?: boolean;
}): Promise<E2EStack> {
  process.env["DATABASE_URL"] = DATABASE_URL;

  const mastodonStub = await ensureMastodonStub();
  if (options?.withoutPublishingConfig) {
    delete process.env["PUBLISHING_MASTODON_BASE_URL"];
    delete process.env["PUBLISHING_MASTODON_CLIENT_ID"];
    delete process.env["PUBLISHING_MASTODON_CLIENT_SECRET"];
    delete process.env["PUBLISHING_SECRET_KEY"];
  } else {
    process.env["PUBLISHING_MASTODON_BASE_URL"] = mastodonStub.baseUrl;
    Object.assign(process.env, publishingEnvironment());
  }

  const stack: E2EStack = {
    reachable: await serverReachable(),
    available: true,
    startedDevServer: false,
    mastodonStub,
  };

  if (!stack.reachable && !process.env["CONTENT_OS_E2E_NO_AUTOSTART"]) {
    await ensureProductionBuild();
    stack.devServer = spawn("npm", ["run", "start"], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL, SESSION_COOKIE_NAME: SESSION_COOKIE },
      stdio: "ignore",
    });
    stack.startedDevServer = true;
    stack.reachable = await waitForServer(90_000);
  }

  if (!stack.reachable) return stack;

  stack.imageWorker = spawn(
    "npx",
    ["tsx", "src/scripts/image-generation-worker.ts"],
    {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL, SESSION_COOKIE_NAME: SESSION_COOKIE },
      stdio: "ignore",
    },
  );

  stack.writingWorker = spawn(
    "npx",
    ["tsx", "src/scripts/writing-worker.ts"],
    {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL, SESSION_COOKIE_NAME: SESSION_COOKIE },
      stdio: "ignore",
    },
  );

  if (options?.withRenderWorker) {
    stack.videoWorker = spawn("npx", ["tsx", "src/scripts/render-worker.ts"], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL, SESSION_COOKIE_NAME: SESSION_COOKIE },
      stdio: "ignore",
    });
  }

  if (options?.withMultiformatWorker) {
    stack.multiformatWorker = spawn(
      "npx",
      ["tsx", "src/scripts/multiformat-worker.ts"],
      {
        cwd: repoRoot,
        env: { ...process.env, DATABASE_URL, SESSION_COOKIE_NAME: SESSION_COOKIE },
        stdio: "ignore",
      },
    );
  }

  if (options?.withPublishingWorker) {
    stack.publishingWorker = spawnPublishingWorker();
  }

  stack.executablePath = await resolveChromium();
  if (!stack.executablePath) {
    stack.available = false;
    return stack;
  }

  return stack;
}

export function stopStack(stack: E2EStack): void {
  if (stack.publishingWorker) stack.publishingWorker.kill("SIGTERM");
  if (stack.multiformatWorker) stack.multiformatWorker.kill("SIGTERM");
  if (stack.videoWorker) stack.videoWorker.kill("SIGTERM");
  if (stack.writingWorker) stack.writingWorker.kill("SIGTERM");
  if (stack.imageWorker) stack.imageWorker.kill("SIGTERM");
  if (stack.startedDevServer && stack.devServer) {
    stack.devServer.kill("SIGTERM");
  }
}

/**
 * Restarts the auto-started web server and waits for it to serve again. Only
 * meaningful when the harness started the server itself; if the operator ran
 * the server by hand this is a no-op that reports the current reachability, so
 * a smoke run never kills a process it does not own.
 */
export async function restartServer(stack: E2EStack): Promise<boolean> {
  if (!stack.startedDevServer || !stack.devServer) return stack.reachable;

  const previous = stack.devServer;
  previous.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => previous.once("exit", () => resolve())),
    sleep(10_000),
  ]);

  stack.reachable = false;
  stack.devServer = spawn("npm", ["run", "start"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL, SESSION_COOKIE_NAME: SESSION_COOKIE },
    stdio: "ignore",
  });
  stack.reachable = await waitForServer(90_000);
  return stack.reachable;
}

/**
 * Stops the publishing worker and waits for the process to exit, so a spec can
 * hold work in a queue without a race while it mutates the source.
 */
export async function stopPublishingWorker(stack: E2EStack): Promise<void> {
  const worker = stack.publishingWorker;
  if (!worker) return;
  worker.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => worker.once("exit", () => resolve())),
    sleep(5_000),
  ]);
  stack.publishingWorker = undefined;
}

/** A brief the deterministic analyzers turn into real product facts and voice. */
export const WRITING_BRIEF = [
  "# Northwind Analytics",
  "",
  "Northwind Analytics is a scheduling tool for engineering teams.",
  "",
  "## What it does",
  "",
  "Scheduled exports send a status report on a fixed schedule.",
  "",
  "## Proof",
  "",
  "The product dashboard shows a next run time for every export.",
  "",
  "## Voice",
  "",
  "Plain and direct. Say single source of truth rather than revolutionary.",
].join("\n");

/**
 * Creates a project whose brief has been analyzed, so the writing worker has
 * real facts to ground copy against instead of an empty graph.
 */
export async function createAnalyzedE2EProject(
  workspaceId: string,
  userId: string,
  name: string,
  brief = WRITING_BRIEF,
): Promise<string> {
  const services = await import("../../../src/infrastructure/services");
  const project = await services.projectService.createForWorkspace(
    workspaceId,
    { name },
    userId,
  );
  await services.inputService.createBatch(project.id, userId, [
    { type: "text", name: "Writing brief", value: brief },
  ]);
  await services.intelligenceService.analyze(project.id, userId, {});
  await services.brandService.analyze(project.id, userId);
  return project.id;
}

export type RegisteredBrowserUser = {
  userId: string;
  workspaceId: string;
  cookieValue: string;
};

export async function registerBrowserUser(
  email: string,
  password = "test-password-1",
): Promise<RegisteredBrowserUser> {
  const response = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (response.status !== 201) {
    throw new Error(`E2E registration failed: ${response.status}`);
  }

  const setCookie = response.headers.get("set-cookie") ?? "";
  const value = setCookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

  if (!value) {
    throw new Error("E2E registration did not return a session cookie");
  }

  const body = (await response.json()) as {
    workspace: { id: string };
    user: { id: string };
  };

  return {
    userId: body.user.id,
    workspaceId: body.workspace.id,
    cookieValue: decodeURIComponent(value),
  };
}

export async function cleanupE2EUser(
  email: string,
  workspaceId: string,
  projectIds: string[],
): Promise<void> {
  const { db } = await import("../../../src/prisma/db");
  const orm = db.orm.public;

  for (const projectId of projectIds) {
    await orm.Project.where({ id: projectId }).delete().catch(() => undefined);
  }

  if (!email) return;
  const user = await orm.User.first({ email });
  if (!user) return;

  await orm.WorkspaceMember.where((row) => row.userId.eq(user.id))
    .delete()
    .catch(() => undefined);
  await orm.Session.where((row) => row.userId.eq(user.id))
    .delete()
    .catch(() => undefined);
  if (workspaceId) {
    await orm.Workspace.where({ id: workspaceId })
      .delete()
      .catch(() => undefined);
  }
  await orm.User.where({ id: user.id }).delete().catch(() => undefined);
}

/**
 * A minimal, valid TEXT node to draw into an editor document for a browser
 * spec. The stage renders it, the layer tree lists it, and the inspector
 * reports it — so a whole editing flow can run against real server state.
 */
export function editorTextNode(
  overrides: Partial<EditorNode> & { id?: string } = {},
): EditorNode {
  return {
    id: overrides.id ?? `enode-${Date.now()}`,
    parentId: null,
    type: "TEXT",
    name: "Headline",
    zIndex: 0,
    transform: { x: 40, y: 80, width: 900, height: 200, rotation: 0, opacity: 1 },
    visible: true,
    asset: null,
    text: { value: "Draft headline" },
    style: emptyStyle(),
    trim: null,
    audio: null,
    shape: null,
    motion: null,
    effects: [],
    automation: [],
    provenance: null,
    ...overrides,
  } satisfies EditorNode;
}

/**
 * Creates an editor document in-process. The document lands in the same
 * database the browser talks to, so navigating to its page loads real state
 * rather than something staged in memory.
 */
export async function createE2EEditorDocument(
  projectId: string,
  userId: string,
  name: string,
  nodes: EditorNode[] = [],
): Promise<{ documentId: string; revisionId: string }> {
  const services = await import("../../../src/infrastructure/services");
  const detail = await services.editorService.createDocument({
    projectId,
    userId,
    name,
    nodes,
  });
  return { documentId: detail.document.id, revisionId: detail.revision.id };
}
