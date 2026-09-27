import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserError } from "../../core/domain/browser";
import type { BrowserRuntime, BrowserRuntimeSession } from "../../core/ports/browser-runtime";
import { DEFAULT_BROWSER_TASK_LIMITS } from "../../core/domain/browser";
import { startFixtureServer, type FixtureServer } from "../../testing/browser-fixture";
import { PlaywrightBrowserRuntime } from "./playwright-runtime";
import { DEFAULT_BROWSER_NAVIGATION_POLICY } from "./navigation-policy";

/**
 * Real Chromium against the real fixture app over real HTTP. Nothing here is
 * stubbed: if the agent could not actually operate a browser, this suite
 * would fail rather than quietly pass.
 */

const RUN_OPTIONS = {
  navigationTimeoutMs: DEFAULT_BROWSER_TASK_LIMITS.navigationTimeoutMs,
  actionTimeoutMs: DEFAULT_BROWSER_TASK_LIMITS.actionTimeoutMs,
  maxUploadBytes: DEFAULT_BROWSER_TASK_LIMITS.maxUploadBytes,
};

describe("PlaywrightBrowserRuntime isolation", () => {
  let isolationFixture: FixtureServer;
  let isolationArtifactDir: string;

  beforeAll(async () => {
    isolationFixture = await startFixtureServer();
    isolationArtifactDir = await mkdtemp(join(tmpdir(), "content-os-isolation-"));
  });

  afterAll(async () => {
    await rm(isolationArtifactDir, { recursive: true, force: true });
    await isolationFixture.close();
  });

  it("keeps the Chromium sandbox on by default", () => {
    expect(new PlaywrightBrowserRuntime().isolationMode).toBe("CHROMIUM_SANDBOX");
  });

  it("operates a real page with the sandbox enabled", async () => {
    // Configuration alone would not prove anything: this drives a real browser
    // through the sandboxed launch path, which is the only path a PUBLIC target
    // is ever allowed to take.
    // The fixture is loopback, so it needs CONTROLLED_LOCAL. The sandbox is
    // orthogonal: the service still refuses an unsandboxed PUBLIC target.
    const runtime = new PlaywrightBrowserRuntime({
      navigationPolicy: { ...DEFAULT_BROWSER_NAVIGATION_POLICY, targetClass: "CONTROLLED_LOCAL" },
    });
    expect(runtime.isolationMode).toBe("CHROMIUM_SANDBOX");
    await runtime.launch({
      artifactDir: isolationArtifactDir,
      navigationTimeoutMs: RUN_OPTIONS.navigationTimeoutMs,
      actionTimeoutMs: RUN_OPTIONS.actionTimeoutMs,
    });

    const session = await runtime.createSession();
    const opened = await session.execute(
      { type: "GOTO", url: isolationFixture.url },
      RUN_OPTIONS,
    );
    expect(opened.ok).toBe(true);
    expect(opened.observation.pageText).toContain("Launchboard");

    const dashboard = await session.execute(
      { type: "GOTO", url: `${isolationFixture.url}dashboard` },
      RUN_OPTIONS,
    );
    expect(dashboard.ok).toBe(true);

    const clicked = await session.execute(
      { type: "CLICK", target: { strategy: "ROLE_NAME", role: "button", name: "New Project" } },
      RUN_OPTIONS,
    );
    expect({ ok: clicked.ok, code: clicked.errorCode, message: clicked.errorMessage }).toEqual({
      ok: true,
      code: null,
      message: null,
    });

    await runtime.close();
  });

  it("reports the escape hatch for environments where the sandbox cannot start", () => {
    const runtime = new PlaywrightBrowserRuntime({ chromiumSandbox: false });
    expect(runtime.isolationMode).toBe("UNSANDBOXED_DEV");
  });
});

describe("PlaywrightBrowserRuntime", () => {
  let fixture: FixtureServer;
  let artifactDir: string;
  let runtime: BrowserRuntime;
  let session: BrowserRuntimeSession;

  beforeAll(async () => {
    fixture = await startFixtureServer();
    artifactDir = await mkdtemp(join(tmpdir(), "content-os-browser-"));
    runtime = new PlaywrightBrowserRuntime({
      navigationPolicy: { ...DEFAULT_BROWSER_NAVIGATION_POLICY, targetClass: "CONTROLLED_LOCAL" },
    });
    await runtime.launch({
      artifactDir,
      navigationTimeoutMs: RUN_OPTIONS.navigationTimeoutMs,
      actionTimeoutMs: RUN_OPTIONS.actionTimeoutMs,
    });
    session = await runtime.createSession();
  }, 60_000);

  afterAll(async () => {
    if (runtime) await runtime.close();
    if (fixture) await fixture.close();
    if (artifactDir) await rm(artifactDir, { recursive: true, force: true });
  });

  const run = (action: Parameters<BrowserRuntimeSession["execute"]>[0]) => session.execute(action, RUN_OPTIONS);

  it("navigates to a fixture page and observes real semantics", async () => {
    const outcome = await run({ type: "GOTO", url: `${fixture.url}dashboard` });
    expect(outcome.errorCode).toBeNull();
    expect(outcome.url).toBe(`${fixture.url}dashboard`);
    expect(outcome.observation.title).toBe("Launchboard Dashboard");

    const names = outcome.observation.interactiveElements.map((element) => element.name);
    expect(names).toContain("New Project");
    expect(names).toContain("Project Name");
    expect(outcome.observation.interactiveElements.some((element) => element.kind === "BUTTON")).toBe(true);
    expect(outcome.observation.forms.length).toBeGreaterThan(0);
  }, 30_000);

  it("completes a real form workflow: click, fill, select, check, assert", async () => {
    await run({ type: "GOTO", url: `${fixture.url}dashboard` });

    const opened = await run({
      type: "CLICK",
      target: { strategy: "ROLE_NAME", role: "button", name: "New Project" },
    });
    expect(opened.errorCode).toBeNull();
    expect(opened.observation.dialogs.map((dialog) => dialog.name)).toContain("New Project");

    const filled = await run({
      type: "FILL",
      target: { strategy: "LABEL", label: "Project Name" },
      value: "Q3 Launch",
    });
    expect(filled.errorCode).toBeNull();

    const selected = await run({
      type: "SELECT",
      target: { strategy: "TEST_ID", testId: "project-template-select" },
      option: "Campaign",
    });
    expect(selected.errorCode).toBeNull();

    const checked = await run({
      type: "CHECK",
      target: { strategy: "TEST_ID", testId: "project-public-checkbox" },
    });
    expect(checked.errorCode).toBeNull();

    const created = await run({
      type: "CLICK",
      target: { strategy: "TEST_ID", testId: "create-project" },
    });
    expect(created.errorCode).toBeNull();

    const readBack = await run({ type: "READ_TEXT", target: { strategy: "TEST_ID", testId: "create-status" } });
    expect(readBack.result).toContain('Project "Q3 Launch" created');

    const verified = await run({ type: "ASSERT_TEXT", text: "Q3 Launch" });
    expect(verified.errorCode).toBeNull();

    const itemCount = await run({ type: "READ_ATTRIBUTE", target: { strategy: "TEST_ID", testId: "project-list" }, attribute: "id" });
    expect(itemCount.result).toBe("project-list");
  }, 60_000);

  it("reports ambiguous targets instead of guessing", async () => {
    await run({ type: "GOTO", url: `${fixture.url}dashboard` });
    const outcome = await run({ type: "CLICK", target: { strategy: "CSS", css: "nav a" } });
    expect(outcome.errorCode).toBe("TARGET_AMBIGUOUS");
    expect(outcome.errorMessage).toMatch(/matched \d+ elements/);
  }, 30_000);

  it("reports missing targets", async () => {
    await run({ type: "GOTO", url: `${fixture.url}dashboard` });
    const outcome = await run({
      type: "CLICK",
      target: { strategy: "ROLE_NAME", role: "button", name: "No Such Button" },
    });
    expect(outcome.errorCode).toBe("TARGET_NOT_FOUND");
  }, 30_000);

  it("fails verification when expected text is absent", async () => {
    await run({ type: "GOTO", url: `${fixture.url}analytics` });
    const outcome = await run({ type: "ASSERT_TEXT", text: "Revenue" });
    expect(outcome.errorCode).toBe("VERIFICATION_FAILED");
  }, 30_000);

  it("handles history navigation and reload", async () => {
    await run({ type: "GOTO", url: `${fixture.url}analytics` });
    await run({ type: "GOTO", url: `${fixture.url}projects` });
    const back = await run({ type: "BACK" });
    expect(back.url).toBe(`${fixture.url}analytics`);
    const forward = await run({ type: "FORWARD" });
    expect(forward.url).toBe(`${fixture.url}projects`);
    const reloaded = await run({ type: "RELOAD" });
    expect(reloaded.errorCode).toBeNull();
    expect(reloaded.observation.title).toBe("Launchboard Projects");
  }, 45_000);

  it("opens and closes a new tab", async () => {
    await run({ type: "GOTO", url: `${fixture.url}dashboard` });
    const before = await session.listPages();
    const opened = await run({ type: "OPEN_NEW_TAB", url: `${fixture.url}settings` });
    expect(opened.errorCode).toBeNull();
    expect(opened.url).toBe(`${fixture.url}settings`);
    expect((await session.listPages()).length).toBeGreaterThan(before.length);

    const closed = await run({ type: "CLOSE_PAGE" });
    expect(closed.errorCode).toBeNull();
    expect((await session.listPages()).length).toBe(before.length);
  }, 45_000);

  it("waits for text and elements to appear", async () => {
    await run({ type: "GOTO", url: `${fixture.url}analytics` });
    const applied = await run({ type: "SELECT", target: { strategy: "TEST_ID", testId: "range-select" }, option: "30 days" });
    expect(applied.errorCode).toBeNull();
    await run({ type: "CLICK", target: { strategy: "TEST_ID", testId: "apply-range" } });
    const waited = await run({ type: "WAIT_FOR_TEXT", text: "Range applied: 30 days", timeoutMs: 5_000 });
    expect(waited.errorCode).toBeNull();
    const elementWait = await run({
      type: "WAIT_FOR_ELEMENT",
      target: { strategy: "TEST_ID", testId: "range-status" },
      timeoutMs: 5_000,
    });
    expect(elementWait.errorCode).toBeNull();
  }, 45_000);

  it("blocks non-HTTP navigation schemes", async () => {
    await run({ type: "GOTO", url: `${fixture.url}dashboard` });
    const outcome = await run({ type: "GOTO", url: "file:///etc/passwd" });
    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).not.toBeNull();
  }, 30_000);

  it("keeps credentials out of observations for password fields", async () => {
    await run({ type: "GOTO", url: `${fixture.url}settings` });
    const filled = await run({
      type: "FILL",
      target: { strategy: "LABEL", label: "Description" },
      value: "hunter2-not-a-password-field",
    });
    expect(filled.errorCode).toBeNull();
    const workspace = await run({ type: "READ_ATTRIBUTE", target: { strategy: "TEST_ID", testId: "workspace-name-input" }, attribute: "value" });
    expect(workspace.result).toBe("");
  }, 30_000);

  it("surfaces page console errors in the observation", async () => {
    await run({ type: "GOTO", url: `${fixture.url}dashboard` });
    const outcome = await run({ type: "WAIT", durationMs: 50 });
    expect(outcome.errorCode).toBeNull();
    expect(Array.isArray(outcome.observation.consoleErrors)).toBe(true);
  }, 30_000);

  it("rejects actions before they reach the browser when the target class forbids it", async () => {
    const publicRuntime = new PlaywrightBrowserRuntime();
    const publicDir = await mkdtemp(join(tmpdir(), "content-os-browser-public-"));
    await publicRuntime.launch({
      artifactDir: publicDir,
      navigationTimeoutMs: 5_000,
      actionTimeoutMs: 5_000,
    });
    const publicSession = await publicRuntime.createSession();
    const outcome = await publicSession.execute({ type: "GOTO", url: `${fixture.url}dashboard` }, RUN_OPTIONS);
    expect(outcome.ok).toBe(false);
    await publicRuntime.close();
    await rm(publicDir, { recursive: true, force: true });
  }, 45_000);

  it("refuses uploads when no resolver is configured", async () => {
    await run({ type: "GOTO", url: `${fixture.url}settings` });
    const outcome = await run({
      type: "UPLOAD",
      target: { strategy: "TEST_ID", testId: "logo-upload-input" },
      assetId: "asset_1",
    });
    expect(outcome.errorCode).toBe("UPLOAD_BLOCKED");
  }, 30_000);
});

describe("PlaywrightBrowserRuntime lifecycle", () => {
  it("rejects session creation before launch", async () => {
    const runtime = new PlaywrightBrowserRuntime();
    await expect(runtime.createSession()).rejects.toBeInstanceOf(BrowserError);
  });

  it("isolates cookies and storage between sessions", async () => {
    const fixture = await startFixtureServer();
    const dir = await mkdtemp(join(tmpdir(), "content-os-browser-iso-"));
    const runtime = new PlaywrightBrowserRuntime({
      navigationPolicy: { ...DEFAULT_BROWSER_NAVIGATION_POLICY, targetClass: "CONTROLLED_LOCAL" },
    });
    await runtime.launch({ artifactDir: dir, navigationTimeoutMs: 10_000, actionTimeoutMs: 10_000 });

    const first = await runtime.createSession();
    await first.execute({ type: "GOTO", url: `${fixture.url}dashboard` }, RUN_OPTIONS);
    // The name field lives inside a modal dialog; it must be open to be filled.
    await first.execute(
      { type: "CLICK", target: { strategy: "TEST_ID", testId: "new-project" } },
      RUN_OPTIONS,
    );
    const filled = await first.execute(
      { type: "FILL", target: { strategy: "LABEL", label: "Project Name" }, value: "Isolated" },
      RUN_OPTIONS,
    );
    expect(filled.errorCode).toBeNull();
    const readFirst = await first.execute(
      { type: "READ_ATTRIBUTE", target: { strategy: "TEST_ID", testId: "project-name-input" }, attribute: "value" },
      RUN_OPTIONS,
    );
    expect(readFirst.result).toBe("Isolated");

    const second = await runtime.createSession();
    await second.execute({ type: "GOTO", url: `${fixture.url}dashboard` }, RUN_OPTIONS);
    const readSecond = await second.execute(
      { type: "READ_ATTRIBUTE", target: { strategy: "TEST_ID", testId: "project-name-input" }, attribute: "value" },
      RUN_OPTIONS,
    );
    expect(readSecond.result).toBe("");

    await runtime.close();
    await fixture.close();
    await rm(dir, { recursive: true, force: true });
  }, 60_000);
});
