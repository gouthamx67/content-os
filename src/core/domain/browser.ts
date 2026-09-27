/**
 * Browser agent domain.
 *
 * Pure model + validation only: no Playwright, no HTTP, no persistence. The
 * runtime port in `src/core/ports/browser-runtime.ts` is the only place that
 * touches a real browser. Everything a planner (AI or deterministic) emits
 * must pass `parseBrowserAction` before it can reach the runtime, which is
 * what keeps arbitrary JavaScript execution impossible: there is simply no
 * action type that carries code.
 */

export const BROWSER_SESSION_STATUSES = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type BrowserSessionStatus = (typeof BROWSER_SESSION_STATUSES)[number];

export const BROWSER_STEP_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
] as const;
export type BrowserStepStatus = (typeof BROWSER_STEP_STATUSES)[number];

export const BROWSER_ACTION_TYPES = [
  "GOTO",
  "BACK",
  "FORWARD",
  "RELOAD",
  "CLICK",
  "DOUBLE_CLICK",
  "HOVER",
  "FILL",
  "TYPE",
  "PRESS",
  "SELECT",
  "CHECK",
  "UNCHECK",
  "SCROLL",
  "SCROLL_TO",
  "UPLOAD",
  "WAIT",
  "WAIT_FOR_URL",
  "WAIT_FOR_TEXT",
  "WAIT_FOR_ELEMENT",
  "READ_TEXT",
  "READ_ATTRIBUTE",
  "ASSERT_VISIBLE",
  "ASSERT_TEXT",
  "ASSERT_URL",
  "OPEN_NEW_TAB",
  "CLOSE_PAGE",
] as const;
export type BrowserActionType = (typeof BROWSER_ACTION_TYPES)[number];

export const BROWSER_ERROR_CODES = [
  "BROWSER_START_FAILED",
  "SESSION_TIMEOUT",
  "NAVIGATION_BLOCKED",
  "TARGET_NOT_FOUND",
  "TARGET_AMBIGUOUS",
  "ACTION_INVALID",
  "ACTION_TIMEOUT",
  "ACTION_FAILED",
  "VERIFICATION_FAILED",
  "POPUP_FAILED",
  "DIALOG_FAILED",
  "UPLOAD_BLOCKED",
  "NETWORK_BLOCKED",
  "LOCAL_APP_FAILED",
  "LOCAL_APP_TIMEOUT",
  "BROWSER_CRASHED",
  "SESSION_NOT_FOUND",
] as const;
export type BrowserErrorCode = (typeof BROWSER_ERROR_CODES)[number];

export class BrowserError extends Error {
  override readonly name = "BrowserError";

  constructor(
    readonly code: BrowserErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * How a plan refers to an element. Strategies are ordered by resilience:
 * semantic role + accessible name first, opaque selectors last. XPath exists
 * only as an explicit fallback and coordinates are deliberately absent —
 * ambiguity is reported, never guessed.
 */
export const BROWSER_TARGET_STRATEGIES = [
  "ROLE_NAME",
  "LABEL",
  "PLACEHOLDER",
  "TEST_ID",
  "CSS",
  "XPATH",
] as const;
export type BrowserTargetStrategy = (typeof BROWSER_TARGET_STRATEGIES)[number];

export type BrowserTarget =
  | { strategy: "ROLE_NAME"; role: string; name: string }
  | { strategy: "LABEL"; label: string }
  | { strategy: "PLACEHOLDER"; placeholder: string }
  | { strategy: "TEST_ID"; testId: string }
  | { strategy: "CSS"; css: string }
  | { strategy: "XPATH"; xpath: string };

export const TARGET_STRATEGY_RANK: Record<BrowserTargetStrategy, number> = {
  ROLE_NAME: 1,
  LABEL: 2,
  PLACEHOLDER: 3,
  TEST_ID: 4,
  CSS: 5,
  XPATH: 6,
};

const KNOWN_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "menuitem",
  "menu",
  "tab",
  "dialog",
  "alert",
  "heading",
  "list",
  "listitem",
  "form",
  "search",
  "navigation",
  "region",
  "main",
  "banner",
  "contentinfo",
  "table",
  "row",
  "cell",
  "option",
  "switch",
  "treeitem",
  "grid",
  "generic",
  "slider",
  "spinbutton",
  "searchbox",
  "status",
  "log",
  "progressbar",
  "separator",
  "toolbar",
  "tooltip",
  "img",
  "paragraph",
  "strong",
  "emphasis",
  "blockquote",
  "code",
  "time",
  "note",
  "article",
  "group",
  "complementary",
  "definition",
  "term",
]);

const KNOWN_KEYS = new Set([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Shift+Tab",
  "Control+a",
  "Control+c",
  "Control+v",
  "Control+Enter",
  "Meta+a",
  "Meta+c",
  "Meta+v",
  "Meta+Enter",
]);

export const MAX_ACTION_TEXT_CHARS = 10_000;
export const MAX_WAIT_MS = 30_000;
export const MAX_TIMEOUT_MS = 60_000;

/**
 * Per-task resource bounds. A task that exceeds any of these fails with
 * SESSION_TIMEOUT / ACTION_FAILED instead of running forever.
 */
export interface BrowserTaskLimits {
  maxActions: number;
  maxPages: number;
  maxDurationMs: number;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
  maxUploadBytes: number;
}

export const DEFAULT_BROWSER_TASK_LIMITS: BrowserTaskLimits = {
  maxActions: 100,
  maxPages: 20,
  maxDurationMs: 5 * 60 * 1000,
  navigationTimeoutMs: 15_000,
  actionTimeoutMs: 10_000,
  maxUploadBytes: 10 * 1024 * 1024,
};

export function clampTaskLimits(
  overrides: Partial<BrowserTaskLimits> | null | undefined,
): BrowserTaskLimits {
  const source = overrides ?? {};
  const positive = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : fallback;
  return {
    maxActions: Math.min(positive(source.maxActions, DEFAULT_BROWSER_TASK_LIMITS.maxActions), 500),
    maxPages: Math.min(positive(source.maxPages, DEFAULT_BROWSER_TASK_LIMITS.maxPages), 100),
    maxDurationMs: Math.min(
      positive(source.maxDurationMs, DEFAULT_BROWSER_TASK_LIMITS.maxDurationMs),
      15 * 60 * 1000,
    ),
    navigationTimeoutMs: Math.min(
      positive(source.navigationTimeoutMs, DEFAULT_BROWSER_TASK_LIMITS.navigationTimeoutMs),
      MAX_TIMEOUT_MS,
    ),
    actionTimeoutMs: Math.min(
      positive(source.actionTimeoutMs, DEFAULT_BROWSER_TASK_LIMITS.actionTimeoutMs),
      MAX_TIMEOUT_MS,
    ),
    maxUploadBytes: Math.min(
      positive(source.maxUploadBytes, DEFAULT_BROWSER_TASK_LIMITS.maxUploadBytes),
      100 * 1024 * 1024,
    ),
  };
}

export type BrowserAction =
  | { type: "GOTO"; url: string }
  | { type: "BACK" }
  | { type: "FORWARD" }
  | { type: "RELOAD" }
  | { type: "CLICK"; target: BrowserTarget }
  | { type: "DOUBLE_CLICK"; target: BrowserTarget }
  | { type: "HOVER"; target: BrowserTarget }
  | { type: "FILL"; target: BrowserTarget; value: string }
  | { type: "TYPE"; target: BrowserTarget; text: string }
  | { type: "PRESS"; key: string }
  | { type: "SELECT"; target: BrowserTarget; option: string }
  | { type: "CHECK"; target: BrowserTarget }
  | { type: "UNCHECK"; target: BrowserTarget }
  | { type: "SCROLL"; deltaY: number }
  | { type: "SCROLL_TO"; target: BrowserTarget }
  | { type: "UPLOAD"; target: BrowserTarget; assetId: string }
  | { type: "WAIT"; durationMs: number }
  | { type: "WAIT_FOR_URL"; url: string; timeoutMs?: number }
  | { type: "WAIT_FOR_TEXT"; text: string; timeoutMs?: number }
  | { type: "WAIT_FOR_ELEMENT"; target: BrowserTarget; timeoutMs?: number }
  | { type: "READ_TEXT"; target?: BrowserTarget }
  | { type: "READ_ATTRIBUTE"; target: BrowserTarget; attribute: string }
  | { type: "ASSERT_VISIBLE"; target: BrowserTarget }
  | { type: "ASSERT_TEXT"; text: string; target?: BrowserTarget }
  | { type: "ASSERT_URL"; url: string }
  | { type: "OPEN_NEW_TAB"; url: string }
  | { type: "CLOSE_PAGE" };

export interface ObservedElement {
  role: string;
  name: string;
  kind:
    | "BUTTON"
    | "LINK"
    | "TEXTBOX"
    | "CHECKBOX"
    | "RADIO"
    | "SELECT"
    | "DIALOG"
    | "FORM"
    | "HEADING"
    | "MENU_ITEM"
    | "TAB"
    | "LIST"
    | "OTHER";
  /** Current value for inputs, useful for post-fill verification. */
  value?: string | null;
  /**
   * Absolute or relative href for links. Present so a planner can navigate by
   * clicking a real link target; still subject to the navigation policy.
   */
  href?: string | null;
}

export interface BrowserObservation {
  pageId: string;
  url: string;
  title: string;
  /** Normalized visible text, capped — never a raw DOM dump. */
  pageText: string;
  interactiveElements: ObservedElement[];
  dialogs: ObservedElement[];
  forms: ObservedElement[];
  links: ObservedElement[];
  /** One line per notable console/page error. */
  consoleErrors: string[];
  pageStateHash: string;
  timestamp: string;
}

export interface InteractionStep {
  order: number;
  actionType: BrowserActionType;
  /** Human-readable target description, redacted where sensitive. */
  targetSummary: string | null;
  /** Redacted input summary: passwords become `<REDACTED>`. */
  inputSummary: string | null;
  status: BrowserStepStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  pageStateHashBefore: string | null;
  pageStateHashAfter: string | null;
  /** Read/assert result payload, redacted and capped. */
  result: string | null;
  errorCode: BrowserErrorCode | null;
  errorMessage: string | null;
}

export interface InteractionTrace {
  steps: InteractionStep[];
  startedAt: string | null;
  completedAt: string | null;
}

export interface BrowserSession {
  id: string;
  projectId: string;
  targetSourceId: string;
  /** PUBLIC or CONTROLLED_LOCAL — see the navigation policy. */
  targetClass: BrowserTargetClass;
  initialUrl: string;
  currentUrl: string;
  status: BrowserSessionStatus;
  goal: string | null;
  successCriteria: string | null;
  startedAt: string | null;
  endedAt: string | null;
  pageCount: number;
  actionCount: number;
  errorCode: BrowserErrorCode | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export const BROWSER_TARGET_CLASSES = ["PUBLIC", "CONTROLLED_LOCAL"] as const;
export type BrowserTargetClass = (typeof BROWSER_TARGET_CLASSES)[number];

export function emptyInteractionTrace(): InteractionTrace {
  return { steps: [], startedAt: null, completedAt: null };
}

// ---------------------------------------------------------------------------
// Validation — every action from a planner (AI, deterministic, or API) must
// pass through parseBrowserAction before touching the runtime.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): BrowserError {
  return new BrowserError("ACTION_INVALID", message);
}

function requireString(value: unknown, field: string, max = MAX_ACTION_TEXT_CHARS): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(`Action field "${field}" must be a non-empty string`);
  }
  if (value.length > max) {
    throw invalid(`Action field "${field}" exceeds ${max} characters`);
  }
  return value;
}

function requireHttpUrl(value: unknown, field: string): string {
  const raw = requireString(value, field, 2048);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw invalid(`Action field "${field}" must be an absolute HTTP(S) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw invalid(`Action field "${field}" must use http: or https:`);
  }
  return raw;
}

function requireTimeout(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw invalid("Action field \"timeoutMs\" must be a positive number");
  }
  if (value > MAX_TIMEOUT_MS) {
    throw invalid(`Action field "timeoutMs" exceeds ${MAX_TIMEOUT_MS}ms`);
  }
  return Math.floor(value);
}

/**
 * Validates a target descriptor. Accepts only the six known strategies with
 * the right fields; anything else — including coordinate objects, scripts, or
 * unknown strategies — is rejected before it can reach a browser.
 */
/**
 * Exact field set permitted per target strategy. Rejecting unknown target
 * fields matters as much as rejecting unknown action fields: a target is the
 * one part of an action a planner fully controls, so an ignored `script` key
 * would be a hole in the only place a caller could try to smuggle one.
 */
const ALLOWED_TARGET_FIELDS: Record<BrowserTargetStrategy, readonly string[]> = {
  ROLE_NAME: ["strategy", "role", "name"],
  LABEL: ["strategy", "label"],
  PLACEHOLDER: ["strategy", "placeholder"],
  TEST_ID: ["strategy", "testId"],
  CSS: ["strategy", "css"],
  XPATH: ["strategy", "xpath"],
};

export function parseBrowserTarget(value: unknown): BrowserTarget {
  if (!isRecord(value)) {
    throw invalid("Target must be an object");
  }
  const strategy = value["strategy"];
  if (typeof strategy !== "string" || !BROWSER_TARGET_STRATEGIES.includes(strategy as BrowserTargetStrategy)) {
    throw invalid(`Unknown target strategy: ${String(strategy)}`);
  }
  const allowed = ALLOWED_TARGET_FIELDS[strategy as BrowserTargetStrategy];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw invalid(`Unknown field in ${strategy} target: ${key}`);
    }
  }
  switch (strategy as BrowserTargetStrategy) {
    case "ROLE_NAME": {
      const role = requireString(value["role"], "target.role", 64).toLowerCase();
      if (!KNOWN_ROLES.has(role)) {
        throw invalid(`Unknown ARIA role: ${role}`);
      }
      const name = requireString(value["name"], "target.name", 300);
      return { strategy: "ROLE_NAME", role, name };
    }
    case "LABEL":
      return { strategy: "LABEL", label: requireString(value["label"], "target.label", 300) };
    case "PLACEHOLDER":
      return {
        strategy: "PLACEHOLDER",
        placeholder: requireString(value["placeholder"], "target.placeholder", 300),
      };
    case "TEST_ID":
      return { strategy: "TEST_ID", testId: requireString(value["testId"], "target.testId", 300) };
    case "CSS":
      return { strategy: "CSS", css: requireString(value["css"], "target.css", 500) };
    case "XPATH":
      return { strategy: "XPATH", xpath: requireString(value["xpath"], "target.xpath", 500) };
  }
}

function requireTarget(value: unknown): BrowserTarget {
  if (value === undefined || value === null) {
    throw invalid("Action requires a target");
  }
  return parseBrowserTarget(value);
}

function optionalTarget(value: unknown): BrowserTarget | undefined {
  if (value === undefined || value === null) return undefined;
  return parseBrowserTarget(value);
}

/**
 * Exact field set permitted per action type. Unknown fields are rejected
 * rather than ignored, so a planner cannot smuggle `script`, `code`, or
 * `evaluate` alongside a legitimate action.
 */
const ALLOWED_ACTION_FIELDS: Record<BrowserActionType, readonly string[]> = {
  GOTO: ["type", "url"],
  BACK: ["type"],
  FORWARD: ["type"],
  RELOAD: ["type"],
  CLICK: ["type", "target"],
  DOUBLE_CLICK: ["type", "target"],
  HOVER: ["type", "target"],
  FILL: ["type", "target", "value"],
  TYPE: ["type", "target", "text"],
  PRESS: ["type", "key"],
  SELECT: ["type", "target", "option"],
  CHECK: ["type", "target"],
  UNCHECK: ["type", "target"],
  SCROLL: ["type", "deltaY"],
  SCROLL_TO: ["type", "target"],
  UPLOAD: ["type", "target", "assetId"],
  WAIT: ["type", "durationMs"],
  WAIT_FOR_URL: ["type", "url", "timeoutMs"],
  WAIT_FOR_TEXT: ["type", "text", "timeoutMs"],
  WAIT_FOR_ELEMENT: ["type", "target", "timeoutMs"],
  READ_TEXT: ["type", "target"],
  READ_ATTRIBUTE: ["type", "target", "attribute"],
  ASSERT_VISIBLE: ["type", "target"],
  ASSERT_TEXT: ["type", "text", "target"],
  ASSERT_URL: ["type", "url"],
  OPEN_NEW_TAB: ["type", "url"],
  CLOSE_PAGE: ["type"],
};

function assertNoExtraFields(value: Record<string, unknown>, type: BrowserActionType): void {
  const allowed = new Set(ALLOWED_ACTION_FIELDS[type]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw invalid(`Unexpected field "${key}" is not permitted on a ${type} action`);
    }
  }
}

/**
 * Strict parser for planner output. This is the action validator's shape
 * stage: unknown action types, arbitrary code, malformed fields and oversize
 * payloads are all rejected here, before any safety policy or browser call.
 */
export function parseBrowserAction(value: unknown): BrowserAction {
  if (!isRecord(value)) {
    throw invalid("Action must be an object");
  }
  const rawType = value["type"];
  if (typeof rawType !== "string" || !BROWSER_ACTION_TYPES.includes(rawType as BrowserActionType)) {
    throw invalid(`Unsupported browser action type: ${String(rawType)}`);
  }
  const type = rawType as BrowserActionType;
  assertNoExtraFields(value, type);

  switch (type) {
    case "GOTO":
      return { type, url: requireHttpUrl(value["url"], "url") };
    case "OPEN_NEW_TAB":
      return { type, url: requireHttpUrl(value["url"], "url") };
    case "BACK":
    case "FORWARD":
    case "RELOAD":
    case "CLOSE_PAGE":
      return { type };
    case "CLICK":
    case "DOUBLE_CLICK":
    case "HOVER":
    case "CHECK":
    case "UNCHECK":
    case "ASSERT_VISIBLE":
    case "SCROLL_TO":
      return { type, target: requireTarget(value["target"]) };
    case "WAIT_FOR_ELEMENT":
      return {
        type,
        target: requireTarget(value["target"]),
        timeoutMs: requireTimeout(value["timeoutMs"]),
      };
    case "FILL":
      return {
        type,
        target: requireTarget(value["target"]),
        value: requireString(value["value"], "value"),
      };
    case "TYPE":
      return {
        type,
        target: requireTarget(value["target"]),
        text: requireString(value["text"], "text"),
      };
    case "PRESS": {
      const key = requireString(value["key"], "key", 32);
      if (!KNOWN_KEYS.has(key) && key.length !== 1) {
        throw invalid(`Unsupported key: ${key}`);
      }
      return { type, key };
    }
    case "SELECT":
      return {
        type,
        target: requireTarget(value["target"]),
        option: requireString(value["option"], "option", 500),
      };
    case "SCROLL": {
      const deltaY = value["deltaY"];
      if (typeof deltaY !== "number" || !Number.isFinite(deltaY) || Math.abs(deltaY) > 100_000) {
        throw invalid("Action field \"deltaY\" must be a bounded number");
      }
      return { type, deltaY };
    }
    case "UPLOAD": {
      // Uploads reference Content OS assets by ID only. Host filesystem paths
      // are rejected outright; the service resolves assetId to storage bytes.
      const assetId = requireString(value["assetId"], "assetId", 200);
      if (assetId.includes("/") || assetId.includes("\\") || assetId.includes("..")) {
        throw invalid("Upload assetId must be a Content OS asset identifier, not a path");
      }
      return { type, target: requireTarget(value["target"]), assetId };
    }
    case "WAIT": {
      const durationMs = value["durationMs"];
      if (
        typeof durationMs !== "number" ||
        !Number.isFinite(durationMs) ||
        durationMs <= 0 ||
        durationMs > MAX_WAIT_MS
      ) {
        throw invalid(`Action field "durationMs" must be between 1 and ${MAX_WAIT_MS}`);
      }
      return { type, durationMs: Math.floor(durationMs) };
    }
    case "WAIT_FOR_URL":
      return {
        type,
        url: requireHttpUrl(value["url"], "url"),
        timeoutMs: requireTimeout(value["timeoutMs"]),
      };
    case "WAIT_FOR_TEXT":
      return {
        type,
        text: requireString(value["text"], "text"),
        timeoutMs: requireTimeout(value["timeoutMs"]),
      };
    case "READ_TEXT":
      return { type, target: optionalTarget(value["target"]) };
    case "READ_ATTRIBUTE": {
      const attribute = requireString(value["attribute"], "attribute", 100);
      if (!/^[a-zA-Z-]+$/.test(attribute)) {
        throw invalid("Action field \"attribute\" must be a plain attribute name");
      }
      return { type, target: requireTarget(value["target"]), attribute };
    }
    case "ASSERT_TEXT":
      return {
        type,
        text: requireString(value["text"], "text"),
        target: optionalTarget(value["target"]),
      };
    case "ASSERT_URL":
      return { type, url: requireHttpUrl(value["url"], "url") };
  }
}

export function isSensitiveTarget(action: { type: string; target?: unknown }): boolean {
  if (action.type !== "FILL" && action.type !== "TYPE") return false;
  const summary = describeTarget(action.target);
  return /pass(word)?|secret|token|api[- ]?key|credential/i.test(summary);
}

export function describeTarget(target: unknown): string {
  if (!isRecord(target) || typeof target["strategy"] !== "string") {
    return "unknown";
  }
  switch (target["strategy"]) {
    case "ROLE_NAME":
      return `${String(target["role"])} "${String(target["name"])}"`;
    case "LABEL":
      return `label "${String(target["label"])}"`;
    case "PLACEHOLDER":
      return `placeholder "${String(target["placeholder"])}"`;
    case "TEST_ID":
      return `test id "${String(target["testId"])}"`;
    case "CSS":
      return `css ${String(target["css"])}`;
    case "XPATH":
      return `xpath ${String(target["xpath"])}`;
    default:
      return "unknown";
  }
}

export const REDACTED = "<REDACTED>";

/** Trace-safe action summary: sensitive values never reach persistence. */
export function summarizeAction(action: BrowserAction): {
  target: string | null;
  input: string | null;
} {
  const target = "target" in action ? describeTarget(action.target) : null;
  switch (action.type) {
    case "GOTO":
    case "OPEN_NEW_TAB":
      return { target, input: action.url };
    case "FILL":
      return {
        target,
        input: isSensitiveTarget(action) ? REDACTED : truncate(action.value, 200),
      };
    case "TYPE":
      return {
        target,
        input: isSensitiveTarget(action) ? REDACTED : truncate(action.text, 200),
      };
    case "SELECT":
      return { target, input: truncate(action.option, 200) };
    case "PRESS":
      return { target, input: action.key };
    case "SCROLL":
      return { target, input: String(action.deltaY) };
    case "SCROLL_TO":
    case "CLICK":
    case "DOUBLE_CLICK":
    case "HOVER":
    case "CHECK":
    case "UNCHECK":
    case "WAIT_FOR_ELEMENT":
    case "ASSERT_VISIBLE":
      return { target, input: null };
    case "UPLOAD":
      return { target, input: action.assetId };
    case "WAIT":
      return { target, input: `${action.durationMs}ms` };
    case "WAIT_FOR_URL":
    case "ASSERT_URL":
      return { target, input: action.url };
    case "WAIT_FOR_TEXT":
    case "ASSERT_TEXT":
      return { target, input: truncate(action.text, 200) };
    case "READ_TEXT":
    case "READ_ATTRIBUTE":
      return {
        target,
        input: action.type === "READ_ATTRIBUTE" ? action.attribute : null,
      };
    case "BACK":
    case "FORWARD":
    case "RELOAD":
    case "CLOSE_PAGE":
      return { target: null, input: null };
  }
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

/**
 * Builds the best semantic target for an observed element. Role + accessible
 * name is always preferred; elements without a name cannot be targeted
 * reliably and return null so the planner can disambiguate or replan.
 */
export function elementToTarget(element: ObservedElement): BrowserTarget | null {
  if (element.name.length === 0) return null;
  if (!KNOWN_ROLES.has(element.role)) return null;
  return { strategy: "ROLE_NAME", role: element.role, name: element.name };
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Compact state fingerprint for change detection between steps. Built from
 * URL, title and element identities — deliberately not full text, which can
 * change for unrelated reasons (clocks, relative times).
 */
export function computePageStateHash(observation: {
  url: string;
  title: string;
  interactiveElements: ObservedElement[];
}): string {
  const identity = [
    observation.url,
    observation.title,
    ...observation.interactiveElements
      .map((element) => `${element.role}:${element.name}`)
      .sort(),
  ].join("|");
  return fnv1a(identity);
}

/**
 * Self-transitions are legal only while a run is still open: the service saves
 * page and action counts after every step, which is progress, not a transition.
 * Terminal rows never reopen, so a late writer cannot resurrect a finished run.
 */
const SESSION_STATUS_TRANSITIONS: Record<BrowserSessionStatus, BrowserSessionStatus[]> = {
  QUEUED: ["QUEUED", "RUNNING", "CANCELLED"],
  RUNNING: ["RUNNING", "COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionSessionStatus(
  from: BrowserSessionStatus,
  to: BrowserSessionStatus,
): boolean {
  return SESSION_STATUS_TRANSITIONS[from].includes(to);
}

/** Best-effort semantic target for a natural-language-ish element hint. */
export function targetFromName(name: string): BrowserTarget {
  return { strategy: "ROLE_NAME", role: "generic", name };
}

/**
 * Success criteria.
 *
 * A planner claiming `believesComplete` is not evidence that anything happened.
 * Criteria are therefore expressed in a tiny checkable language that this
 * module can evaluate against a real observation:
 *
 *   text contains "Created"          -> TEXT_PRESENT
 *   url contains "/dashboard"       -> URL_CONTAINS
 *   title contains "Projects"       -> TITLE_CONTAINS
 *   element "Project Name" visible  -> ELEMENT_PRESENT
 *
 * Anything else is returned as an unparseable criterion. The service treats an
 * unparseable criterion as unmet rather than waving it through, so free text can
 * never be a rubber stamp for a run that changed nothing.
 */
export type SuccessCriterion =
  | { kind: "TEXT_PRESENT"; value: string }
  | { kind: "URL_CONTAINS"; value: string }
  | { kind: "TITLE_CONTAINS"; value: string }
  | { kind: "ELEMENT_PRESENT"; name: string };

export type SuccessCriterionResult = {
  criterion: SuccessCriterion;
  ok: boolean;
  detail: string;
};

const MAX_CRITERION_VALUE = 200;

function normalizeCriteriaValue(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "").trim().slice(0, MAX_CRITERION_VALUE);
}

/** Best-effort parse of one criterion line. Returns null when unrecognised. */
export function parseSuccessCriterion(line: string): SuccessCriterion | null {
  const text = line.trim();
  if (!text) return null;

  let match = /^(?:page\s+)?text\s+(?:contains|includes|shows?)\s+(.+)$/i.exec(text);
  if (match) return { kind: "TEXT_PRESENT", value: normalizeCriteriaValue(match[1]!) };

  match = /^url\s+(?:contains|includes|matches)\s+(.+)$/i.exec(text);
  if (match) return { kind: "URL_CONTAINS", value: normalizeCriteriaValue(match[1]!) };

  match = /^(?:page\s+)?title\s+(?:contains|includes|is)\s+(.+)$/i.exec(text);
  if (match) return { kind: "TITLE_CONTAINS", value: normalizeCriteriaValue(match[1]!) };

  match = /^element\s+(.+?)\s+(?:is\s+)?(?:visible|present|exists)$/i.exec(text);
  if (match) return { kind: "ELEMENT_PRESENT", name: normalizeCriteriaValue(match[1]!) };

  return null;
}

/** Splits on newlines, semicolons, and " and " so prose lists still work. */
export function parseSuccessCriteria(text: string | null | undefined): SuccessCriterion[] {
  if (!text) return [];
  return text
    .split(/[\n;]+|\band\b/i)
    .map((line) => parseSuccessCriterion(line))
    .filter((criterion): criterion is SuccessCriterion => criterion !== null);
}

function foldCase(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function evaluateSuccessCriterion(
  criterion: SuccessCriterion,
  observation: Pick<BrowserObservation, "url" | "title" | "pageText" | "interactiveElements">,
): SuccessCriterionResult {
  switch (criterion.kind) {
    case "TEXT_PRESENT": {
      const needle = foldCase(criterion.value);
      const ok = needle.length > 0 && foldCase(observation.pageText).includes(needle);
      return {
        criterion,
        ok,
        detail: ok ? `page text contains "${criterion.value}"` : `page text does not contain "${criterion.value}"`,
      };
    }
    case "URL_CONTAINS": {
      const needle = criterion.value;
      const ok = needle.length > 0 && observation.url.toLowerCase().includes(needle.toLowerCase());
      return {
        criterion,
        ok,
        detail: ok ? `url ${observation.url} contains "${needle}"` : `url ${observation.url} does not contain "${needle}"`,
      };
    }
    case "TITLE_CONTAINS": {
      const needle = foldCase(criterion.value);
      const ok = needle.length > 0 && foldCase(observation.title).includes(needle);
      return {
        criterion,
        ok,
        detail: ok ? `title contains "${criterion.value}"` : `title does not contain "${criterion.value}"`,
      };
    }
    case "ELEMENT_PRESENT": {
      const needle = foldCase(criterion.name);
      const found = observation.interactiveElements.some((element) =>
        foldCase(element.name).includes(needle),
      );
      return {
        criterion,
        ok: found,
        detail: found ? `element "${criterion.name}" is present` : `element "${criterion.name}" was not found`,
      };
    }
  }
}

export type SuccessCriteriaVerdict = {
  /** True only when every parsed criterion was observed to hold. */
  verified: boolean;
  results: SuccessCriterionResult[];
  /** Lines that were not understood; these can never count as satisfied. */
  unparsed: string[];
};

export function evaluateSuccessCriteria(
  text: string | null | undefined,
  observation: Pick<BrowserObservation, "url" | "title" | "pageText" | "interactiveElements">,
): SuccessCriteriaVerdict {
  const criteria = parseSuccessCriteria(text);
  const understood = new Set(criteria.map((criterion) => JSON.stringify(criterion)));
  const unparsed = (text ?? "")
    .split(/[\n;]+|\band\b/i)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => {
      const parsed = parseSuccessCriterion(line);
      return parsed === null || !understood.has(JSON.stringify(parsed));
    });

  const results = criteria.map((criterion) => evaluateSuccessCriterion(criterion, observation));
  return {
    verified: criteria.length > 0 && unparsed.length === 0 && results.every((result) => result.ok),
    results,
    unparsed,
  };
}
