import type { BrowserAction, BrowserErrorCode, BrowserObservation, BrowserTarget, ObservedElement } from "../domain/browser";
import type { BrowserUploadSource } from "./browser-planner";

/**
 * Result of executing one validated action inside a live browser context.
 */
export interface BrowserActionOutcome {
  ok: boolean;
  url: string;
  title: string;
  /** Truncated observation captured after the action settled. */
  observation: BrowserObservation;
  /** Read/assert payload (element text, attribute value) when the action produces one. */
  result: string | null;
  errorCode: BrowserErrorCode | null;
  errorMessage: string | null;
  /** Page the action ran against, when the session tracks multiple pages. */
  pageId: string;
}

export interface BrowserRuntimeOptions {
  /** Ephemeral artifact directory for downloads; never inside the repo. */
  artifactDir: string;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
  /**
   * Resolves a Content OS asset id to bytes for UPLOAD. The runtime never
   * accepts a host path: an unresolvable id fails with UPLOAD_BLOCKED.
   */
  uploadResolver?: (
    assetId: string,
    projectId: string | null,
  ) => Promise<BrowserUploadSource | null>;
}

export interface BrowserRunOptions {
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
  maxUploadBytes: number;
  /** Cap on interactive elements collected per observation. */
  maxInteractiveElements?: number;
}

/**
 * The execution layer behind the browser agent. One runtime instance owns one
 * Chromium browser; each {@link BrowserRuntimeSession} gets its own isolated
 * BrowserContext so cookies/storage/history never leak between projects.
 *
 * Implementations must translate only validated {@link BrowserAction}s into
 * Playwright calls. They never interpret free-form instructions.
 */
export interface BrowserRuntimeSession {
  readonly pageId: string;

  /** Current top-level page state, normalized into a compact observation. */
  observe(): Promise<BrowserObservation>;

  /** Opens a fresh page in the same context and makes it active. */
  newPage(): Promise<string>;

  /** Switches the active page (popups, tabs). */
  activatePage(pageId: string): Promise<void>;

  listPages(): Promise<string[]>;

  execute(action: BrowserAction, options: BrowserRunOptions): Promise<BrowserActionOutcome>;
}

/**
 * How the browser process is isolated from the host.
 *
 * CHROMIUM_SANDBOX keeps Chromium's own OS-level renderer sandbox, which is the
 * only mode allowed to load an untrusted (PUBLIC) target. UNSANDBOXED is a local
 * development escape hatch: it exists because a sandbox cannot start in some
 * containers, and it must never be used to visit a host the project did not
 * declare. The service enforces that pairing; see BrowserService.
 */
export type BrowserIsolationMode = "CHROMIUM_SANDBOX" | "UNSANDBOXED_DEV";

export interface BrowserRuntime {
  /**
   * The isolation the runtime will use. Read before launch to decide whether a
   * target is safe to open.
   */
  readonly isolationMode: BrowserIsolationMode;

  /** Launches the browser process. Throws BROWSER_START_FAILED / BROWSER_CRASHED. */
  launch(options: BrowserRuntimeOptions): Promise<void>;

  /**
   * Creates a fresh isolated context. Must be safe to call concurrently.
   * `projectId` is the owning workspace: the runtime forwards it to the upload
   * resolver so one project can never upload another project's asset.
   */
  createSession(options?: { projectId?: string }): Promise<BrowserRuntimeSession>;

  /** Closes every page and the context owned by one session. */
  closeSession(session: BrowserRuntimeSession): Promise<void>;

  /** Terminates the browser process. Idempotent. */
  close(): Promise<void>;
}

export interface ResolvedBrowserTarget {
  target: BrowserTarget;
  /** True when more than one element matched; the executor must refuse. */
  ambiguous: boolean;
  matchCount: number;
}

export interface ObservedPageModel {
  url: string;
  title: string;
  pageText: string;
  interactiveElements: ObservedElement[];
  links: ObservedElement[];
  forms: ObservedElement[];
  dialogs: ObservedElement[];
  consoleErrors: string[];
}
