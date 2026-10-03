import { spawn, type ChildProcess } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright-core";

/**
 * Real browser E2E for the video rendering engine.
 *
 * This is the only test that proves the whole CP15 path at once: a real
 * Chromium asks for a render, a real render worker claims the job, a real
 * FFmpeg writes an MP4, and the artifact is streamed back over HTTP. The web
 * server and the render worker are started here if they are not already up, so
 * `npm run test:e2e` is sufficient on its own.
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

let services: Services;
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

let devServer: ChildProcess | undefined;
let worker: ChildProcess | undefined;
let startedDevServer = false;

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

  worker = spawn("npx", ["tsx", "src/scripts/render-worker.ts"], {
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

  browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  context = await browser.newContext();

  const suffix = Date.now();
  email = `cp15-e2e-${suffix}@test.local`;

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
    { name: "CP15 E2E" },
    body.user.id,
  );
  projectId = project.id;

  const composition = await services.visualCompositionService.createComposition({
    projectId,
    userId: body.user.id,
    name: "CP15 render",
    width: 320,
    height: 240,
    frameRate: 12,
    durationMs: 600,
  });
  compositionId = composition.id;

  await services.visualLayerService.addLayer({
    projectId,
    compositionId,
    userId: body.user.id,
    type: "TEXT",
    textContent: "Render me",
  });
});

afterAll(async () => {
  if (browser) await browser.close();

  if (worker) worker.kill("SIGTERM");
  if (startedDevServer && devServer) devServer.kill("SIGTERM");

  if (reachable && projectId && services) {
    const { db } = await import("../../src/prisma/db");
    const orm = db.orm.public;

    await orm.VisualComposition.where((row) => row.projectId.eq(projectId))
      .delete()
      .catch(() => undefined);
    await orm.Project.where({ id: projectId })
      .delete()
      .catch(() => undefined);

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

describe("video rendering end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!reachable || !available) {
      testContext.skip();
      return;
    }
    expect(executablePath).toBeTruthy();
  });

  it("renders a composition and streams the MP4 back to the browser", async (testContext) => {
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

    await page.getByTestId("render-video").click();

    await expect
      .poll(
        async () => page.getByTestId("render-status").textContent(),
        { timeout: 90_000, interval: 1_000 },
      )
      .toContain("SUCCEEDED");

    const download = page.getByTestId("render-download");
    await download.waitFor({ state: "visible", timeout: 10_000 });
    const href = await download.getAttribute("href");
    expect(href).toBeTruthy();

    const artifactResponse = await context.request.get(`${BASE_URL}${href}`);
    expect(artifactResponse.status()).toBe(200);
    expect(artifactResponse.headers()["content-type"]).toContain("video/mp4");

    const bytes = await artifactResponse.body();
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes.subarray(4, 8).toString("ascii")).toBe("ftyp");

    expect(consoleErrors).toEqual([]);

    await page.close();
  }, 120_000);
});
