import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BASE_URL =
  process.env["VISUAL_E2E_BASE_URL"] ?? "http://localhost:3000";
const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://contentos:contentos@localhost:5433/content_os";
const SESSION_COOKIE =
  process.env["SESSION_COOKIE_NAME"] ?? "content_os_session";

const repoRoot = process.cwd();
const buildSentinel = path.join(repoRoot, ".next", "e2e-build-ready");

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

/**
 * Builds the production bundle once for the whole browser run.
 *
 * Each spec still owns its server and workers, because specs inject their own
 * stub endpoints into the child environment (localization, publishing). The
 * expensive and racy part — rebuilding `.next` in every spec process while a
 * previous server may still be shutting down — is done here, before any
 * worker starts. The sentinel lets per-spec fallbacks reuse that build. An
 * operator-run server is left untouched and needs no build from us.
 */
export default async function setup(): Promise<() => Promise<void>> {
  if (
    (await serverReachable()) ||
    process.env["CONTENT_OS_E2E_NO_AUTOSTART"]
  ) {
    return async () => undefined;
  }

  process.env["DATABASE_URL"] = DATABASE_URL;

  await execFileAsync("npm", ["run", "build"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL, SESSION_COOKIE_NAME: SESSION_COOKIE },
  });
  await writeFile(buildSentinel, new Date().toISOString(), "utf8");

  return async () => undefined;
}
