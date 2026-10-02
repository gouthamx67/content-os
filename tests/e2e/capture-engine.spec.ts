import { readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright-core";

/**
 * Real browser E2E for the capture engine.
 *
 * This drives the actual UI in a real Chromium against a running Next server.
 * The camera and microphone are Chromium's fake devices, not a mocked
 * `MediaRecorder`: the bytes recorded here travel through the real upload route,
 * into Postgres and into storage, and are then read back after a page reload.
 *
 * It needs a server, so it skips (rather than fails) when none is reachable.
 * Start the app first, then run this file:
 *
 *   npm run dev
 *   npx vitest run tests/e2e/capture-engine.spec.ts
 *
 * The database it writes to is whatever the server is configured with, so this
 * test cleans up the user, project and stored bytes it created.
 */

const BASE_URL = process.env["CAPTURE_E2E_BASE_URL"] ?? "http://localhost:3000";
const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://contentos:contentos@localhost:5433/content_os";
const CAPTURE_ROOT = path.join(process.cwd(), ".content-os", "captures");
const SESSION_COOKIE =
  process.env["SESSION_COOKIE_NAME"] ?? "content_os_session";

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
let sessionId = "";

beforeAll(async () => {
  process.env["DATABASE_URL"] = DATABASE_URL;

  reachable = await serverReachable();
  if (!reachable) return;

  executablePath = await resolveChromium();
  if (!executablePath) {
    available = false;
    return;
  }

  services = await import("../../src/infrastructure/services");

  browser = await chromium.launch({
    executablePath,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--no-sandbox",
    ],
  });

  context = await browser.newContext();
  await context.grantPermissions(["camera", "microphone"], {
    origin: BASE_URL,
  });

  const suffix = Date.now();
  email = `cp13-e2e-${suffix}@test.local`;

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

  const project = await services.projectService.createForWorkspace(
    body.workspace.id,
    { name: "CP13 E2E" },
    body.user.id,
  );

  projectId = project.id;

  const session = await services.captureService.createSession({
    projectId,
    userId: body.user.id,
  });

  sessionId = session.id;
});

afterAll(async () => {
  if (browser) {
    await browser.close();
  }

  if (reachable && projectId && services) {
    const { db } = await import("../../src/prisma/db");
    const orm = db.orm.public;

    await orm.CaptureTake.where((row) => row.projectId.eq(projectId))
      .delete()
      .catch(() => undefined);
    await orm.CaptureSession.where((row) => row.projectId.eq(projectId))
      .delete()
      .catch(() => undefined);
    await rm(path.join(CAPTURE_ROOT, projectId), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
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
        const workspace = await orm.Workspace.where((row) =>
          row.name.eq("CP13 E2E"),
        ).all();
        for (const entry of workspace) {
          await orm.Workspace.where({ id: entry.id })
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

describe("capture engine end to end", () => {
  it("is runnable in this environment", (testContext) => {
    if (!reachable) {
      testContext.skip();
      return;
    }
    if (!available) {
      testContext.skip();
      return;
    }
    expect(executablePath).toBeTruthy();
  });

  it("records a real take in the browser, persists it, and survives a reload", async (testContext) => {
    if (!reachable || !available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto(`${BASE_URL}/projects/${projectId}/capture/${sessionId}`, {
      waitUntil: "domcontentloaded",
    });

    await page.getByText("Capture session").waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Start session" }).click();
    await page.getByText("Session active").waitFor({ state: "visible" });

    // Real getUserMedia + MediaRecorder in the page. The fake device produces a
    // live stream, so this fails if the controller cannot actually record.
    await page.getByRole("button", { name: "Start capture" }).click();
    await page.getByText("Recording").waitFor({ state: "visible" });

    await page.waitForTimeout(1600);

    await page.getByRole("button", { name: "Stop capture" }).click();
    await page.getByText("Take saved").waitFor({ state: "visible", timeout: 20_000 });

    await page.getByText("Takes (1)").waitFor({ state: "visible" });
    await page.getByText("READY", { exact: true }).waitFor({ state: "visible" });

    // A reload is a fresh server render from PostgreSQL, not a client cache.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Takes (1)").waitFor({ state: "visible" });
    await page.getByText("READY", { exact: true }).waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Accept" }).click();
    await page.getByText("Take accepted").waitFor({ state: "visible" });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("ACCEPTED", { exact: true }).waitFor({ state: "visible" });

    expect(consoleErrors).toEqual([]);

    await page.close();
  }, 90_000);
});
