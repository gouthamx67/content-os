import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright-core";

/**
 * Real browser E2E for the audio engine and the final mux.
 *
 * This is the only test that proves the whole CP16 path at once: a real
 * Chromium adds a track against a real stored WAV, a real video render runs,
 * a real audio worker mixes and muxes with FFmpeg, and both artifacts are
 * streamed back over HTTP. Both workers and the web server are started here if
 * they are not already up.
 */

const BASE_URL = process.env["VISUAL_E2E_BASE_URL"] ?? "http://localhost:3000";
const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://contentos:contentos@localhost:5433/content_os";
const SESSION_COOKIE =
  process.env["SESSION_COOKIE_NAME"] ?? "content_os_session";

const repoRoot = process.cwd();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveChromium(): Promise<string | undefined> {
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
      try {
        await stat(candidate);
        return candidate;
      } catch {
        continue;
      }
    }
  }

  for (const fallback of ["/usr/bin/google-chrome", "/usr/bin/chromium"]) {
    try {
      await stat(fallback);
      return fallback;
    } catch {
      continue;
    }
  }

  return undefined;
}

async function serverReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/login`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await serverReachable()) return true;
    await sleep(1000);
  }
  return false;
}

type Services = typeof import("../../src/infrastructure/services");
type Container = typeof import("../../src/infrastructure/container");

let services: Services;
let container: Container;

let executablePath: string | undefined;
let browser: Browser;
let context: BrowserContext;
let reachable = false;
let available = true;

let email = "";
const password = "test-password-1";
let projectId = "";
let compositionId = "";
let workspaceId = "";
let assetSourceRef = "";

let devServer: ChildProcess | undefined;
let videoWorker: ChildProcess | undefined;
let audioWorker: ChildProcess | undefined;
let startedDevServer = false;

let sourceTempDir = "";

beforeAll(async () => {
  process.env["DATABASE_URL"] = DATABASE_URL;

  reachable = await serverReachable();
  if (!reachable && !process.env["CONTENT_OS_E2E_NO_AUTOSTART"]) {
    devServer = spawn("npm", ["run", "dev"], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL, SESSION_COOKIE_NAME: SESSION_COOKIE },
      stdio: "ignore",
    });
    startedDevServer = true;
    reachable = await waitForServer(90_000);
  }

  if (!reachable) return;

  videoWorker = spawn("npx", ["tsx", "src/scripts/render-worker.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL, SESSION_COOKIE_NAME: SESSION_COOKIE },
    stdio: "ignore",
  });
  audioWorker = spawn("npx", ["tsx", "src/scripts/audio-worker.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL, SESSION_COOKIE_NAME: SESSION_COOKIE },
    stdio: "ignore",
  });

  executablePath = await resolveChromium();
  if (!executablePath) {
    available = false;
    return;
  }

  services = await import("../../src/infrastructure/services");
  container = await import("../../src/infrastructure/container");

  browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  context = await browser.newContext();

  const suffix = Date.now();
  email = `cp16-e2e-${suffix}@test.local`;

  const registered = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (registered.status !== 201) {
    throw new Error(`E2E registration failed: ${registered.status}`);
  }

  const setCookie = registered.headers.get("set-cookie") ?? "";
  const value = setCookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

  if (!value) {
    throw new Error("E2E registration did not return a session cookie");
  }

  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: decodeURIComponent(value),
      url: BASE_URL,
    },
  ]);

  const body = (await registered.json()) as {
    workspace: { id: string };
    user: { id: string };
  };

  workspaceId = body.workspace.id;

  const project = await services.projectService.createForWorkspace(
    body.workspace.id,
    { name: "CP16 E2E" },
    body.user.id,
  );
  projectId = project.id;

  const composition = await services.visualCompositionService.createComposition({
    projectId,
    userId: body.user.id,
    name: "CP16 mux",
    width: 320,
    height: 240,
    frameRate: 12,
    durationMs: 1000,
  });
  compositionId = composition.id;

  await services.visualLayerService.addLayer({
    projectId,
    compositionId,
    userId: body.user.id,
    type: "TEXT",
    textContent: "Final",
  });

  sourceTempDir = await mkdtemp(path.join(tmpdir(), "cp16-e2e-"));
  const wavPath = path.join(sourceTempDir, "narration.wav");
  execFileSync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=200:duration=1",
    "-ar",
    "48000",
    "-ac",
    "2",
    wavPath,
  ]);

  const key = `e2e/cp16-${suffix}.wav`;
  await container.container.providers.storage.put(
    key,
    await readFile(wavPath),
    "audio/wav",
  );

  const asset = await services.assetService.create(
    projectId,
    {
      type: "AUDIO",
      name: "narration.wav",
      uri: `content-os-storage://local/${key}`,
    },
    body.user.id,
  );

  assetSourceRef = `asset:${asset.id}`;
});

afterAll(async () => {
  if (browser) await browser.close();

  if (audioWorker) audioWorker.kill("SIGTERM");
  if (videoWorker) videoWorker.kill("SIGTERM");
  if (startedDevServer && devServer) devServer.kill("SIGTERM");

  if (sourceTempDir) {
    await rm(sourceTempDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  if (reachable && projectId && services) {
    const { db } = await import("../../src/prisma/db");
    const orm = db.orm.public;

    await orm.AudioComposition.where((row) => row.projectId.eq(projectId))
      .delete()
      .catch(() => undefined);
    await orm.VisualComposition.where((row) => row.projectId.eq(projectId))
      .delete()
      .catch(() => undefined);
    await orm.Asset.where((row) => row.projectId.eq(projectId))
      .delete()
      .catch(() => undefined);
    await orm.Project.where({ id: projectId }).delete().catch(() => undefined);

    if (email) {
      const user = await orm.User.first({ email });
      if (user) {
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
        await orm.User.where({ id: user.id })
          .delete()
          .catch(() => undefined);
      }
    }
  }
});

describe("audio engine end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!reachable || !available) {
      testContext.skip();
      return;
    }
    expect(executablePath).toBeTruthy();
  });

  it("renders audio, muxes it with the video, and streams the final MP4", async (testContext) => {
    if (!reachable || !available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto(
      `${BASE_URL}/projects/${projectId}/visual/${compositionId}`,
      { waitUntil: "domcontentloaded" },
    );

    await page
      .getByTestId("visual-stage")
      .waitFor({ state: "visible", timeout: 20_000 });

    await page.getByTestId("audio-workspace").waitFor({ state: "visible" });
    await page.getByTestId("audio-source").fill(assetSourceRef);
    await page.getByTestId("audio-duration").fill("1000");
    await page.getByTestId("audio-add-track").click();
    await page
      .getByTestId("audio-track-item")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });

    await page.getByTestId("render-video").click();
    await expect
      .poll(
        async () => page.getByTestId("render-status").textContent(),
        { timeout: 90_000, interval: 1_000 },
      )
      .toContain("SUCCEEDED");

    await page.getByTestId("audio-render-final").click();
    await expect
      .poll(
        async () => page.getByTestId("audio-render-status").textContent(),
        { timeout: 90_000, interval: 1_000 },
      )
      .toContain("SUCCEEDED");

    const finalVideo = page.getByTestId("final-video");
    await finalVideo.waitFor({ state: "visible", timeout: 10_000 });

    await expect
      .poll(
        async () =>
          finalVideo.evaluate(
            (element) => (element as HTMLVideoElement).readyState,
          ),
        { timeout: 20_000, interval: 500 },
      )
      .toBeGreaterThan(0);

    const src = await finalVideo.getAttribute("src");
    expect(src).toBeTruthy();

    const streamed = await context.request.get(`${BASE_URL}${src}`);
    expect(streamed.status()).toBe(200);
    expect(streamed.headers()["content-type"]).toContain("video/mp4");
    const bytes = await streamed.body();
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes.subarray(4, 8).toString("ascii")).toBe("ftyp");

    expect(consoleErrors).toEqual([]);

    await page.close();
  }, 150_000);
});
