import { chmod, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Dialog, type Download, type Locator, type Page } from "playwright-core";
import {
  BrowserError,
  computePageStateHash,
  type BrowserAction,
  type BrowserErrorCode,
  type BrowserObservation,
  type BrowserTarget,
} from "../../core/domain/browser";
import type {
  BrowserActionOutcome,
  BrowserIsolationMode,
  BrowserRunOptions,
  BrowserRuntime,
  BrowserRuntimeOptions,
  BrowserRuntimeSession,
} from "../../core/ports/browser-runtime";
import type { BrowserUploadSource } from "../../core/ports/browser-planner";
import { extractObservation } from "./page-observation";
import {
  DEFAULT_BROWSER_NAVIGATION_POLICY,
  assertPublicResolution,
  checkBrowserUrl,
  hasAllowedUploadExtension,
  isAllowedUpload,
  type BrowserNavigationPolicy,
} from "./navigation-policy";

const MAX_OBSERVATION_TEXT = 4_000;
const MAX_INTERACTIVE_ELEMENTS = 200;
const MAX_CONSOLE_ERRORS = 20;
const MAX_RESULT_CHARS = 2_000;
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
const OBSERVE_TIMEOUT_MS = 5_000;
const MAX_DOWNLOADS = 20;

function isPlaywrightTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /Timeout|timed out|exceeded/i.test(error.message) || error.name === "TimeoutError";
}

function messageOf(error: unknown): string {
  if (error instanceof BrowserError) return error.message;
  if (error instanceof Error) return error.message.slice(0, 500);
  return "Unknown browser failure";
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Locates a usable Chromium without downloading one at runtime. Respects
 * CONTENT_OS_BROWSER_EXECUTABLE, then the standard Playwright cache, then
 * PATH. Returns undefined to let Playwright resolve its own default.
 *
 * The cache scan is deliberate and cannot move out of this module: Playwright's
 * own resolution only accepts the exact revision it installed (here it looks for
 * `chromium_headless_shell-1194` while the machine has `chromium-1208`), so
 * without this scan the runtime finds no browser at all. Turbopack reports the
 * resulting dynamic filesystem access as three "traces the whole project"
 * build warnings; that is the accepted cost of locating an externally installed
 * browser, and the build succeeds.
 */
/**
 * The sandbox is on unless the operator explicitly turns it off. Content OS
 * runs agent-driven browsing of sites it does not control, so the safe default
 * has to be the one that survives a malicious page.
 */
function chromiumSandboxFromEnvironment(): boolean {
  const setting = process.env["CONTENT_OS_BROWSER_SANDBOX"]?.trim().toLowerCase();
  return setting !== "off" && setting !== "0" && setting !== "false";
}

async function resolveExecutablePath(): Promise<string | undefined> {
  const explicit = process.env["CONTENT_OS_BROWSER_EXECUTABLE"];
  if (explicit && explicit.trim().length > 0) return explicit.trim();

  const cacheRoot = process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? join(homedir(), ".cache", "ms-playwright");
  const { readdir } = await import("node:fs/promises");
  let entries: string[];
  try {
    entries = await readdir(cacheRoot);
  } catch {
    return undefined;
  }
  const candidates = entries
    .filter((entry) => entry.startsWith("chromium-") || entry.startsWith("chromium_headless_shell-"))
    .sort()
    .reverse();
  for (const entry of candidates) {
    for (const relative of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
      const path = join(cacheRoot, entry, relative);
      try {
        await stat(path);
        return path;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

/** Turns a validated target into a locator, refusing 0 or many matches. */
async function resolveLocator(
  page: Page,
  target: BrowserTarget,
  timeoutMs: number,
): Promise<Locator> {
  let locator: Locator;
  switch (target.strategy) {
    case "ROLE_NAME":
      locator = page.getByRole(target.role as Parameters<Page["getByRole"]>[0], {
        name: target.name,
        exact: false,
      });
      break;
    case "LABEL":
      locator = page.getByLabel(target.label, { exact: false });
      break;
    case "PLACEHOLDER":
      locator = page.getByPlaceholder(target.placeholder, { exact: false });
      break;
    case "TEST_ID":
      locator = page.getByTestId(target.testId);
      break;
    case "CSS":
      locator = page.locator(target.css);
      break;
    case "XPATH":
      locator = page.locator(`xpath=${target.xpath}`);
      break;
  }

  const matches = await locator.count();
  if (matches === 0) {
    throw new BrowserError("TARGET_NOT_FOUND", "No element matched the target");
  }
  if (matches > 1) {
    throw new BrowserError(
      "TARGET_AMBIGUOUS",
      `Target matched ${matches} elements; refine the target instead of guessing`,
    );
  }
  const first = locator.first();
  await first.waitFor({ state: "attached", timeout: timeoutMs });
  return first;
}

function isPasswordTarget(target: BrowserTarget): boolean {
  return /pass(word)?|secret|token|api[- _]?key|credential|pin|cvv/i.test(
    target.strategy === "ROLE_NAME" ? `${target.role} ${target.name}` : JSON.stringify(target),
  );
}

export interface PlaywrightRuntimeConfig {
  navigationPolicy?: BrowserNavigationPolicy;
  maxObservationText?: number;
  maxInteractiveElements?: number;
  headless?: boolean;
  /**
   * Defaults to Chromium's own OS-level sandbox. Only set this to false for
   * local development in an environment where the sandbox cannot start; a
   * browser without it must not be pointed at an untrusted target.
   */
  chromiumSandbox?: boolean;
}

export class PlaywrightBrowserSession implements BrowserRuntimeSession {
  private pageCounter = 0;
  private readonly pages = new Map<string, Page>();
  private activePageId = "";
  private consoleErrors: string[] = [];
  private networkFailures: string[] = [];
  private downloadCount = 0;
  private closed = false;
  private uploadResolver:
    | ((assetId: string, projectId: string | null) => Promise<BrowserUploadSource | null>)
    | undefined;

  constructor(
    private readonly context: BrowserContext,
    private readonly options: Required<Pick<PlaywrightRuntimeConfig, "maxObservationText" | "maxInteractiveElements">>,
    private readonly artifactDir: string,
    initialPage: Page,
    readonly projectId: string | null = null,
    uploadResolver?: (assetId: string, projectId: string | null) => Promise<BrowserUploadSource | null>,
  ) {
    this.uploadResolver = uploadResolver;
    this.registerPage(initialPage);
    // Popups and window.open targets are adopted as they appear.
    context.on("page", (page) => this.registerPage(page));
  }

  get pageId(): string {
    return this.activePageId;
  }

  private registerPage(page: Page): string {
    for (const [id, known] of this.pages) {
      if (known === page) return id;
    }
    this.pageCounter += 1;
    const id = `p${this.pageCounter}`;
    this.pages.set(id, page);
    if (this.activePageId === "") this.activePageId = id;
    page.on("console", (message) => {
      if (message.type() !== "error" && message.type() !== "warning") return;
      if (this.consoleErrors.length >= MAX_CONSOLE_ERRORS) return;
      this.consoleErrors.push(`${message.type()}: ${message.text().slice(0, 300)}`);
    });
    page.on("pageerror", (error) => {
      if (this.consoleErrors.length >= MAX_CONSOLE_ERRORS) return;
      this.consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`);
    });
    page.on("requestfailed", (request) => {
      if (this.networkFailures.length >= MAX_CONSOLE_ERRORS) return;
      this.networkFailures.push(
        `${request.method()} ${request.url().slice(0, 200)} (${request.failure()?.errorText ?? "failed"})`,
      );
    });
    page.on("response", (response) => {
      if (response.status() < 400) return;
      if (this.networkFailures.length >= MAX_CONSOLE_ERRORS) return;
      this.networkFailures.push(`${response.status()} ${response.url().slice(0, 200)}`);
    });
    // Native dialogs are always auto-dismissed so a stray confirm() can never
    // wedge the session; the event is still reported to the caller.
    page.on("dialog", (dialog: Dialog) => {
      if (this.consoleErrors.length >= MAX_CONSOLE_ERRORS) return;
      this.consoleErrors.push(`dialog:${dialog.type()}:${dialog.message().slice(0, 200)}`);
      void dialog.dismiss().catch(() => undefined);
    });
    page.on("download", (download: Download) => {
      void this.persistDownload(download);
    });
    return id;
  }

  /** Downloads are artifact-only: capped, sanitized, never served back. */
  private async persistDownload(download: Download): Promise<void> {
    if (this.downloadCount >= MAX_DOWNLOADS) return;
    this.downloadCount += 1;
    const safeName = download.suggestedFilename().replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
    const target = join(this.artifactDir, `${this.activePageId}-${Date.now()}-${safeName}`);
    try {
      await mkdir(this.artifactDir, { recursive: true });
      await download.saveAs(target);
      const info = await stat(target);
      if (info.size > MAX_ARTIFACT_BYTES) await unlink(target).catch(() => undefined);
    } catch {
      await unlink(target).catch(() => undefined);
    }
  }

  private page(): Page {
    const page = this.pages.get(this.activePageId);
    if (!page) throw new BrowserError("BROWSER_CRASHED", "Session has no active page");
    return page;
  }

  async observe(): Promise<BrowserObservation> {
    const page = this.page();
    const extraction = await withTimeout(
      page
        .evaluate(extractObservation, {
          maxText: this.options.maxObservationText,
          maxElements: this.options.maxInteractiveElements,
        })
        .then((value) => value as Awaited<ReturnType<typeof extractObservation>>),
      OBSERVE_TIMEOUT_MS,
      () => new BrowserError("ACTION_TIMEOUT", "Observation timed out"),
    );

    const consoleErrors = this.consoleErrors.slice(0, MAX_CONSOLE_ERRORS);
    const networkErrors = this.networkFailures.slice(0, MAX_CONSOLE_ERRORS);
    this.consoleErrors = [];
    this.networkFailures = [];

    return {
      pageId: this.activePageId,
      url: extraction.url,
      title: extraction.title,
      pageText: extraction.pageText,
      interactiveElements: extraction.elements,
      dialogs: extraction.dialogs,
      forms: extraction.forms,
      links: extraction.links,
      consoleErrors: [...consoleErrors, ...networkErrors],
      pageStateHash: computePageStateHash({
        url: extraction.url,
        title: extraction.title,
        interactiveElements: extraction.elements,
      }),
      timestamp: new Date().toISOString(),
    };
  }

  async newPage(): Promise<string> {
    const page = await this.context.newPage();
    return this.registerPage(page);
  }

  async activatePage(pageId: string): Promise<void> {
    if (!this.pages.has(pageId)) {
      throw new BrowserError("POPUP_FAILED", `Unknown page ${pageId}`);
    }
    this.activePageId = pageId;
  }

  async listPages(): Promise<string[]> {
    return [...this.pages.keys()];
  }

  /** Closes the active page and hands control back to a remaining page. */
  async closeCurrentPage(): Promise<string> {
    const closing = this.page();
    for (const [id, page] of this.pages) {
      if (page === closing) this.pages.delete(id);
    }
    // The page is removed from tracking either way: if close() fails the
    // session must not hand back a handle to a page it no longer owns.
    await closing.close().catch(() => undefined);
    const remaining = [...this.pages.entries()][0];
    if (!remaining) {
      this.registerPage(await this.context.newPage());
      return this.activePageId;
    }
    this.activePageId = remaining[0];
    return this.activePageId;
  }

  pageById(pageId: string): Page {
    const page = this.pages.get(pageId);
    if (!page) throw new BrowserError("POPUP_FAILED", `Unknown page ${pageId}`);
    return page;
  }

  async execute(action: BrowserAction, options: BrowserRunOptions): Promise<BrowserActionOutcome> {
    const page = this.page();
    const actionTimeout = options.actionTimeoutMs;
    let result: string | null = null;
    let errorCode: BrowserErrorCode | null = null;
    let errorMessage: string | null = null;

    try {
      result = await withTimeout(
        this.dispatch(page, action, options),
        actionTimeout,
        () => new BrowserError("ACTION_TIMEOUT", `Action ${action.type} timed out`),
      );
    } catch (error) {
      if (error instanceof BrowserError) {
        errorCode = error.code;
        errorMessage = error.message;
      } else if (isPlaywrightTimeout(error)) {
        errorCode = "ACTION_TIMEOUT";
        errorMessage = `${action.type} timed out: ${messageOf(error)}`;
      } else {
        errorCode = "ACTION_FAILED";
        errorMessage = messageOf(error);
      }
    }

    let observation: BrowserObservation;
    try {
      observation = await this.observe();
    } catch (error) {
      errorCode = errorCode ?? "BROWSER_CRASHED";
      errorMessage = errorMessage ?? messageOf(error);
      observation = {
        pageId: this.activePageId,
        url: "",
        title: "",
        pageText: "",
        interactiveElements: [],
        dialogs: [],
        forms: [],
        links: [],
        consoleErrors: [],
        pageStateHash: "unavailable",
        timestamp: new Date().toISOString(),
      };
    }

    return {
      ok: errorCode === null,
      url: observation.url,
      title: observation.title,
      observation,
      result,
      errorCode,
      errorMessage,
      pageId: this.activePageId,
    };
  }

  private async dispatch(
    page: Page,
    action: BrowserAction,
    options: BrowserRunOptions,
  ): Promise<string | null> {
    const timeout = options.actionTimeoutMs;
    const locatorFor = (target: BrowserTarget) => resolveLocator(page, target, timeout);
    const readTextFrom = async (element: Locator | null): Promise<string | null> => {
      if (element === null) return null;
      const text = await element.innerText();
      return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS - 1)}…` : text;
    };

    switch (action.type) {
      case "GOTO":
        await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: options.navigationTimeoutMs });
        return null;
      case "BACK":
        await page.goBack({ waitUntil: "domcontentloaded", timeout: options.navigationTimeoutMs });
        return null;
      case "FORWARD":
        await page.goForward({ waitUntil: "domcontentloaded", timeout: options.navigationTimeoutMs });
        return null;
      case "RELOAD":
        await page.reload({ waitUntil: "domcontentloaded", timeout: options.navigationTimeoutMs });
        return null;
      case "CLICK":
        await (await locatorFor(action.target)).click({ timeout });
        return null;
      case "DOUBLE_CLICK":
        await (await locatorFor(action.target)).dblclick({ timeout });
        return null;
      case "HOVER":
        await (await locatorFor(action.target)).hover({ timeout });
        return null;
      case "FILL":
        await (await locatorFor(action.target)).fill(action.value, { timeout });
        return null;
      case "TYPE":
        await (await locatorFor(action.target)).pressSequentially(action.text, { delay: 10 });
        return null;
      case "PRESS":
        await page.keyboard.press(action.key);
        return null;
      case "SELECT": {
        const locator = await locatorFor(action.target);
        try {
          await locator.selectOption({ label: action.option }, { timeout });
        } catch {
          await locator.selectOption(action.option, { timeout });
        }
        return null;
      }
      case "CHECK":
        await (await locatorFor(action.target)).check({ timeout });
        return null;
      case "UNCHECK":
        await (await locatorFor(action.target)).uncheck({ timeout });
        return null;
      case "SCROLL":
        await page.mouse.wheel(0, action.deltaY);
        await page.waitForTimeout(150);
        return null;
      case "SCROLL_TO":
        await (await locatorFor(action.target)).scrollIntoViewIfNeeded({ timeout });
        return null;
      case "UPLOAD":
        return this.performUpload(action.target, action.assetId, options);
      case "WAIT":
        await page.waitForTimeout(action.durationMs);
        return null;
      case "WAIT_FOR_URL":
        await page.waitForURL(action.url, { timeout: action.timeoutMs ?? timeout });
        return null;
      case "WAIT_FOR_TEXT":
        await page.getByText(action.text, { exact: false }).first().waitFor({
          state: "visible",
          timeout: action.timeoutMs ?? timeout,
        });
        return null;
      case "WAIT_FOR_ELEMENT":
        await (await locatorFor(action.target)).waitFor({
          state: "visible",
          timeout: action.timeoutMs ?? timeout,
        });
        return null;
      case "READ_TEXT": {
        if (!action.target) {
          const text = await page.innerText("body", { timeout });
          return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS - 1)}…` : text;
        }
        return readTextFrom(await locatorFor(action.target));
      }
      case "READ_ATTRIBUTE": {
        const locator = await locatorFor(action.target);
        const attribute = action.attribute.toLowerCase();
        // Live form state lives on the DOM property, not the HTML attribute,
        // so a filled input must be read via inputValue/isChecked.
        if (attribute === "value") {
          if (isPasswordTarget(action.target)) return "<REDACTED>";
          const current = await locator.inputValue({ timeout });
          return current.length > MAX_RESULT_CHARS ? `${current.slice(0, MAX_RESULT_CHARS - 1)}…` : current;
        }
        if (attribute === "checked") {
          return (await locator.isChecked({ timeout })) ? "true" : "false";
        }
        const value = await locator.getAttribute(action.attribute, { timeout });
        return value === null ? null : value.slice(0, MAX_RESULT_CHARS);
      }
      case "ASSERT_VISIBLE": {
        const visible = await (await locatorFor(action.target)).isVisible();
        if (!visible) {
          throw new BrowserError("VERIFICATION_FAILED", "Expected element to be visible");
        }
        return "visible";
      }
      case "ASSERT_TEXT": {
        const locator = action.target ? await locatorFor(action.target) : page.locator("body");
        const text = await locator.innerText({ timeout });
        if (!text.toLowerCase().includes(action.text.toLowerCase())) {
          throw new BrowserError("VERIFICATION_FAILED", `Expected text "${action.text}" on the page`);
        }
        return action.text;
      }
      case "ASSERT_URL": {
        const current = page.url();
        const expected = action.url;
        if (current !== expected && !current.startsWith(expected)) {
          throw new BrowserError("VERIFICATION_FAILED", `Expected URL ${expected} but found ${current}`);
        }
        return current;
      }
      case "OPEN_NEW_TAB": {
        const created = await this.context.newPage();
        const popupId = this.registerPage(created);
        this.activePageId = popupId;
        await created.goto(action.url, {
          waitUntil: "domcontentloaded",
          timeout: options.navigationTimeoutMs,
        });
        return popupId;
      }
      case "CLOSE_PAGE":
        return this.closeCurrentPage();
      default: {
        const exhaustive: never = action;
        throw new BrowserError("ACTION_INVALID", `Unsupported action ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /**
   * Uploads only ever stream bytes resolved from a Content OS asset id through
   * the injected resolver, and only after MIME, extension, and size checks.
   */
  private async performUpload(
    target: BrowserTarget,
    assetId: string,
    options: BrowserRunOptions,
  ): Promise<string | null> {
    const resolver = this.uploadResolver;
    if (!resolver) {
      throw new BrowserError("UPLOAD_BLOCKED", "Uploads are not enabled for this session");
    }
    const source: BrowserUploadSource | null = await resolver(assetId, this.projectId);
    if (!source) {
      throw new BrowserError("UPLOAD_BLOCKED", `Asset ${assetId} could not be resolved`);
    }
    if (source.bytes.byteLength > options.maxUploadBytes) {
      throw new BrowserError("UPLOAD_BLOCKED", "Upload exceeds the size limit");
    }
    if (!isAllowedUpload(source.mimeType, source.bytes.byteLength, options.maxUploadBytes)) {
      throw new BrowserError("UPLOAD_BLOCKED", `Upload type ${source.mimeType} is not allowed`);
    }
    if (!hasAllowedUploadExtension(source.name)) {
      throw new BrowserError("UPLOAD_BLOCKED", `Upload file ${source.name} is not allowed`);
    }
    const page = this.page();
    const locator = await resolveLocator(page, target, options.actionTimeoutMs);
    await locator.setInputFiles({
      name: source.name,
      mimeType: source.mimeType,
      buffer: Buffer.from(source.bytes),
    });
    return source.name;
  }

  setUploadResolver(
    resolver: (assetId: string, projectId: string | null) => Promise<BrowserUploadSource | null>,
  ): void {
    this.uploadResolver = resolver;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const page of this.pages.values()) {
      await page.close({ runBeforeUnload: false }).catch(() => undefined);
    }
    this.pages.clear();
    await this.context.close().catch(() => undefined);
  }
}

export class PlaywrightBrowserRuntime implements BrowserRuntime {
  private browser: Browser | null = null;
  private artifactDir = "";
  private navigationPolicy: BrowserNavigationPolicy = DEFAULT_BROWSER_NAVIGATION_POLICY;
  private uploadResolver:
    | ((assetId: string, projectId: string | null) => Promise<BrowserUploadSource | null>)
    | undefined;
  private readonly maxObservationText: number;
  private readonly maxInteractiveElements: number;
  private readonly headless: boolean;
  private readonly sandboxed: boolean;

  constructor(config: PlaywrightRuntimeConfig = {}) {
    this.navigationPolicy = config.navigationPolicy ?? DEFAULT_BROWSER_NAVIGATION_POLICY;
    this.maxObservationText = config.maxObservationText ?? MAX_OBSERVATION_TEXT;
    this.maxInteractiveElements = config.maxInteractiveElements ?? MAX_INTERACTIVE_ELEMENTS;
    this.headless = config.headless ?? true;
    this.sandboxed = config.chromiumSandbox ?? chromiumSandboxFromEnvironment();
  }

  get isolationMode(): BrowserIsolationMode {
    return this.sandboxed ? "CHROMIUM_SANDBOX" : "UNSANDBOXED_DEV";
  }

  async launch(options: BrowserRuntimeOptions): Promise<void> {
    if (this.browser) return;
    this.artifactDir = options.artifactDir;
    this.uploadResolver = options.uploadResolver;
    await mkdir(options.artifactDir, { recursive: true });
    await chmod(options.artifactDir, 0o700).catch(() => undefined);

    const executablePath = await resolveExecutablePath();
    try {
      this.browser = await chromium.launch({
        headless: this.headless,
        executablePath,
        // Chromium's own sandbox: renderer processes are confined by the
        // kernel, not by application code. Turning it off is the single most
        // dangerous thing this file could do, so it is opt-in, never default.
        chromiumSandbox: this.sandboxed,
        args: [
          ...(this.sandboxed ? [] : ["--no-sandbox"]),
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-extensions",
          "--disable-background-networking",
          "--no-first-run",
          "--no-default-browser-check",
        ],
      });
    } catch (error) {
      throw new BrowserError("BROWSER_START_FAILED", `Could not launch Chromium: ${messageOf(error)}`);
    }
  }

  /**
   * Creates an isolated context and installs the navigation policy as a
   * request interceptor, so even a hostile redirect cannot escape the policy.
   */
  async createSession(options: { projectId?: string } = {}): Promise<BrowserRuntimeSession> {
    if (!this.browser) {
      throw new BrowserError("BROWSER_START_FAILED", "Browser runtime is not running");
    }
    const policy = this.navigationPolicy;
    const context = await this.browser.newContext({
      acceptDownloads: true,
      javaScriptEnabled: true,
      serviceWorkers: "block",
      bypassCSP: false,
      ignoreHTTPSErrors: false,
      permissions: [],
      reducedMotion: "reduce",
      viewport: { width: 1280, height: 800 },
    });

    await context.route("**/*", async (route) => {
      const url = route.request().url();
      try {
        checkBrowserUrl(url, policy);
        await assertPublicResolution(new URL(url).hostname, policy);
        await route.continue();
      } catch {
        await route.abort("blockedbyclient").catch(() => undefined);
      }
    });

    const session = new PlaywrightBrowserSession(
      context,
      { maxObservationText: this.maxObservationText, maxInteractiveElements: this.maxInteractiveElements },
      this.artifactDir,
      await context.newPage(),
      options.projectId ?? null,
      this.uploadResolver,
    );
    if (this.uploadResolver) session.setUploadResolver(this.uploadResolver);
    return session;
  }

  async closeSession(session: BrowserRuntimeSession): Promise<void> {
    if (session instanceof PlaywrightBrowserSession) {
      await session.close();
      return;
    }
    await session.execute({ type: "CLOSE_PAGE" }, {
      navigationTimeoutMs: 1_000,
      actionTimeoutMs: 1_000,
      maxUploadBytes: 0,
    }).catch(() => undefined);
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    if (browser) await browser.close().catch(() => undefined);
  }

  /** Test seam: writes an artifact (screenshot/text) into the session directory. */
  async writeArtifact(name: string, contents: string): Promise<string> {
    const safe = name.replace(/[^A-Za-z0-9._-]/g, "_");
    const path = join(this.artifactDir, safe);
    await writeFile(path, contents, "utf8");
    return path;
  }
}
