import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright-core";

/**
 * Real browser E2E for the visual / motion engine.
 *
 * It creates a composition and a text layer through the actual UI, applies a
 * motion preset, scrubs the timeline and reloads. The reload is the important
 * assertion: it re-renders the page from PostgreSQL, so a layer, keyframe or
 * effect only survives if it was really persisted.
 *
 * It needs a running server, so it skips (rather than fails) when none is
 * reachable:
 *
 *   npm run dev
 *   npx vitest run tests/e2e/visual-motion-engine.spec.ts
 */

const BASE_URL = process.env["VISUAL_E2E_BASE_URL"] ?? "http://localhost:3000";
const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://contentos:contentos@localhost:5433/content_os";
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
let workspaceId = "";

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
    args: ["--no-sandbox"],
  });

  context = await browser.newContext();

  const suffix = Date.now();
  email = `cp14-e2e-${suffix}@test.local`;

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
    { name: "CP14 E2E" },
    body.user.id,
  );

  projectId = project.id;
});

afterAll(async () => {
  if (browser) {
    await browser.close();
  }

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

describe("visual motion engine end to end", () => {
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

  it("builds a composition, applies motion and survives a reload", async (testContext) => {
    if (!reachable || !available) {
      testContext.skip();
      return;
    }

    const page = await context.newPage();

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto(`${BASE_URL}/projects/${projectId}/visual`, {
      waitUntil: "domcontentloaded",
    });

    await page
      .getByRole("heading", { name: "Compositions" })
      .waitFor({ state: "visible" });

    await page.getByTestId("composition-name").fill("E2E composition");
    await page.getByTestId("create-composition").click();

    // Creating navigates to the workspace.
    await page
      .getByTestId("visual-stage")
      .waitFor({ state: "visible", timeout: 20_000 });

    await page.getByTestId("text-input").fill("Hello world");
    await page.getByTestId("add-text-layer").click();

    await page
      .getByTestId("visual-layer")
      .filter({ hasText: "Hello world" })
      .waitFor({ state: "visible" });

    // Motion: a preset expands into real keyframes.
    await page.getByTestId("preset-FADE_IN").click();
    await page.getByTestId("keyframe-row").waitFor({ state: "visible" });

    // Effects: apply a blur and confirm it is listed.
    await page.getByTestId("add-effect").click();
    await page.getByTestId("effect-row").waitFor({ state: "visible" });

    // Scrub: the stage reports the evaluated time.
    await page.getByTestId("timeline-scrubber").fill("500");
    await expect
      .poll(async () =>
        page.getByTestId("visual-stage").getAttribute("data-time-ms"),
      )
      .toBe("500");

    // A reload is a fresh server render from PostgreSQL.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByTestId("visual-stage")
      .waitFor({ state: "visible", timeout: 20_000 });

    await page
      .getByTestId("visual-layer")
      .filter({ hasText: "Hello world" })
      .waitFor({ state: "visible" });
    await page.getByTestId("keyframe-row").waitFor({ state: "visible" });
    await page.getByTestId("effect-row").waitFor({ state: "visible" });

    expect(consoleErrors).toEqual([]);

    await page.close();
  }, 90_000);
});
