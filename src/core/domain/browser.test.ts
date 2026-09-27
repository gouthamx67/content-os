import { describe, expect, it } from "vitest";
import {
  BROWSER_ACTION_TYPES,
  BrowserError,
  DEFAULT_BROWSER_TASK_LIMITS,
  REDACTED,
  TARGET_STRATEGY_RANK,
  canTransitionSessionStatus,
  clampTaskLimits,
  computePageStateHash,
  describeTarget,
  elementToTarget,
  isSensitiveTarget,
  parseBrowserAction,
  parseBrowserTarget,
  summarizeAction,
  type BrowserAction,
  type ObservedElement,
  parseSuccessCriteria,
  evaluateSuccessCriteria,
  BrowserObservation,
} from "./browser";

const validTarget = { strategy: "ROLE_NAME" as const, role: "button", name: "Save" };

describe("parseBrowserAction", () => {
  it("accepts every supported action type", () => {
    const samples: Record<string, unknown> = {
      GOTO: { type: "GOTO", url: "https://example.com" },
      BACK: { type: "BACK" },
      FORWARD: { type: "FORWARD" },
      RELOAD: { type: "RELOAD" },
      CLICK: { type: "CLICK", target: validTarget },
      DOUBLE_CLICK: { type: "DOUBLE_CLICK", target: validTarget },
      HOVER: { type: "HOVER", target: validTarget },
      FILL: { type: "FILL", target: validTarget, value: "hello" },
      TYPE: { type: "TYPE", target: validTarget, text: "hello" },
      PRESS: { type: "PRESS", key: "Enter" },
      SELECT: { type: "SELECT", target: validTarget, option: "Campaign" },
      CHECK: { type: "CHECK", target: validTarget },
      UNCHECK: { type: "UNCHECK", target: validTarget },
      SCROLL: { type: "SCROLL", deltaY: 400 },
      SCROLL_TO: { type: "SCROLL_TO", target: validTarget },
      UPLOAD: { type: "UPLOAD", target: validTarget, assetId: "asset_1" },
      WAIT: { type: "WAIT", durationMs: 500 },
      WAIT_FOR_URL: { type: "WAIT_FOR_URL", url: "https://example.com/done" },
      WAIT_FOR_TEXT: { type: "WAIT_FOR_TEXT", text: "Done" },
      WAIT_FOR_ELEMENT: { type: "WAIT_FOR_ELEMENT", target: validTarget },
      READ_TEXT: { type: "READ_TEXT" },
      READ_ATTRIBUTE: { type: "READ_ATTRIBUTE", target: validTarget, attribute: "href" },
      ASSERT_VISIBLE: { type: "ASSERT_VISIBLE", target: validTarget },
      ASSERT_TEXT: { type: "ASSERT_TEXT", text: "Done" },
      ASSERT_URL: { type: "ASSERT_URL", url: "https://example.com/done" },
      OPEN_NEW_TAB: { type: "OPEN_NEW_TAB", url: "https://example.com" },
      CLOSE_PAGE: { type: "CLOSE_PAGE" },
    };
    for (const type of BROWSER_ACTION_TYPES) {
      expect(samples[type], `missing sample for ${type}`).toBeDefined();
      expect(() => parseBrowserAction(samples[type])).not.toThrow();
    }
    expect(BROWSER_ACTION_TYPES).toHaveLength(Object.keys(samples).length);
  });

  it("refuses arbitrary JavaScript execution in every form", () => {
    const attempts: unknown[] = [
      { type: "EVALUATE", script: "fetch('https://evil.example')" },
      { type: "EVALUATE_JS", code: "1+1" },
      { type: "EXECUTE", script: "alert(1)" },
      { type: "RUN_SCRIPT", js: "process.exit()" },
      { type: "CLICK", target: validTarget, script: "steal()" },
      { type: "CLICK", target: { strategy: "COORDINATE", x: 10, y: 20 } },
      { type: "CLICK", target: { strategy: "ROLE_NAME", role: "button", name: "Save" }, evaluate: "x=1" },
      { type: "FILL", target: validTarget, value: "x", js: "1" },
      { type: "PRESS", key: "Enter", script: "fetch('x')" },
    ];
    for (const attempt of attempts) {
      expect(() => parseBrowserAction(attempt)).toThrow(BrowserError);
    }
  });

  it("rejects unknown and malformed structures", () => {
    const bad: unknown[] = [
      null,
      "CLICK",
      [],
      {},
      { type: 42 },
      { type: "CLICK" },
      { type: "FILL", target: validTarget },
      { type: "FILL", target: validTarget, value: "" },
      { type: "GOTO", url: "not-a-url" },
      { type: "GOTO", url: "file:///etc/passwd" },
      { type: "GOTO", url: "javascript:alert(1)" },
      { type: "GOTO", url: "data:text/html,<h1>x" },
      { type: "READ_ATTRIBUTE", target: validTarget, attribute: "onclick; drop" },
      { type: "WAIT", durationMs: 0 },
      { type: "WAIT", durationMs: 999_999 },
      { type: "SCROLL", deltaY: Number.NaN },
      { type: "PRESS", key: "Meta+Shift+Q" },
    ];
    for (const value of bad) {
      expect(() => parseBrowserAction(value)).toThrow(BrowserError);
    }
  });

  it("rejects oversized payloads", () => {
    expect(() =>
      parseBrowserAction({ type: "FILL", target: validTarget, value: "x".repeat(20_000) }),
    ).toThrow(/exceeds/);
    expect(() =>
      parseBrowserAction({ type: "GOTO", url: `https://example.com/${"a".repeat(3000)}` }),
    ).toThrow(/exceeds/);
  });

  it("rejects upload references that look like host paths", () => {
    for (const assetId of ["/etc/passwd", "../../secret.txt", "C:\\secrets\\key.pem", "a/b"]) {
      expect(() => parseBrowserAction({ type: "UPLOAD", target: validTarget, assetId })).toThrow(
        /not a path/,
      );
    }
  });

  it("requires a target only for target-bearing actions", () => {
    expect(() => parseBrowserAction({ type: "READ_TEXT", target: undefined })).not.toThrow();
    expect(() => parseBrowserAction({ type: "READ_TEXT", target: { strategy: "TEST_ID", testId: "x" } })).not.toThrow();
    expect(() => parseBrowserAction({ type: "CLICK", target: { strategy: "TEST_ID" } })).toThrow();
  });

  it("normalizes roles and rejects invented ones", () => {
    const parsed = parseBrowserAction({
      type: "CLICK",
      target: { strategy: "ROLE_NAME", role: "BUTTON", name: "Save" },
    }) as Extract<BrowserAction, { type: "CLICK" }>;
    expect(parsed.target).toEqual({ strategy: "ROLE_NAME", role: "button", name: "Save" });
    expect(() =>
      parseBrowserAction({ type: "CLICK", target: { strategy: "ROLE_NAME", role: "superwidget", name: "x" } }),
    ).toThrow(/Unknown ARIA role/);
  });
});

describe("parseBrowserTarget", () => {
  it("accepts all six strategies in preference order", () => {
    const strategies = [
      { strategy: "ROLE_NAME", role: "button", name: "Save" },
      { strategy: "LABEL", label: "Email" },
      { strategy: "PLACEHOLDER", placeholder: "you@example.com" },
      { strategy: "TEST_ID", testId: "submit" },
      { strategy: "CSS", css: "button.primary" },
      { strategy: "XPATH", xpath: "//button[@id='submit']" },
    ] as const;
    const ranks = strategies.map((target) => TARGET_STRATEGY_RANK[target.strategy]);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6]);
    for (const target of strategies) {
      expect(parseBrowserTarget(target)).toEqual(target);
    }
  });

  it("rejects coordinate targeting and unknown strategies", () => {
    expect(() => parseBrowserTarget({ strategy: "COORDINATE", x: 1, y: 2 })).toThrow(/Unknown target strategy/);
    expect(() => parseBrowserTarget({ strategy: "TEXT", text: "Save" })).toThrow(/Unknown target strategy/);
    expect(() => parseBrowserTarget({ strategy: "CSS", css: "" })).toThrow();
  });
});

describe("summarizeAction and redaction", () => {
  it("redacts password and secret input values", () => {
    const password = parseBrowserAction({
      type: "FILL",
      target: { strategy: "LABEL", label: "Password" },
      value: "hunter2",
    }) as BrowserAction;
    expect(isSensitiveTarget(password)).toBe(true);
    expect(summarizeAction(password).input).toBe(REDACTED);

    for (const label of ["API Key", "auth token", "Client Secret", "credentials", "passphrase"]) {
      const action = parseBrowserAction({
        type: "TYPE",
        target: { strategy: "LABEL", label },
        text: "sensitive-value",
      }) as BrowserAction;
      expect(summarizeAction(action).input, label).toBe(REDACTED);
    }
  });

  it("keeps ordinary input visible but truncated", () => {
    const action = parseBrowserAction({
      type: "FILL",
      target: { strategy: "LABEL", label: "Project Name" },
      value: "n".repeat(500),
    }) as BrowserAction;
    const summary = summarizeAction(action);
    expect(summary.input).not.toBe(REDACTED);
    expect(summary.input).toHaveLength(200);
    expect(summary.target).toBe('label "Project Name"');
  });

  it("describes each target strategy", () => {
    expect(describeTarget({ strategy: "ROLE_NAME", role: "button", name: "Save" })).toBe('button "Save"');
    expect(describeTarget({ strategy: "TEST_ID", testId: "submit" })).toBe('test id "submit"');
    expect(describeTarget(null)).toBe("unknown");
  });
});

describe("task limits", () => {
  it("falls back to defaults for junk input", () => {
    expect(clampTaskLimits(null)).toEqual(DEFAULT_BROWSER_TASK_LIMITS);
    expect(clampTaskLimits({ maxActions: Number.NaN, maxPages: -1 })).toEqual(DEFAULT_BROWSER_TASK_LIMITS);
  });

  it("clamps to safe ceilings", () => {
    const limits = clampTaskLimits({
      maxActions: 100_000,
      maxPages: 5_000,
      maxDurationMs: 24 * 60 * 60 * 1000,
      maxUploadBytes: 10 * 1024 * 1024 * 1024,
    });
    expect(limits.maxActions).toBe(500);
    expect(limits.maxPages).toBe(100);
    expect(limits.maxDurationMs).toBe(15 * 60 * 1000);
    expect(limits.maxUploadBytes).toBe(100 * 1024 * 1024);
  });

  it("accepts tighter limits", () => {
    expect(clampTaskLimits({ maxActions: 5 }).maxActions).toBe(5);
  });
});

describe("session status machine", () => {
  it("allows only forward progress to terminal states", () => {
    expect(canTransitionSessionStatus("QUEUED", "RUNNING")).toBe(true);
    expect(canTransitionSessionStatus("RUNNING", "COMPLETED")).toBe(true);
    expect(canTransitionSessionStatus("RUNNING", "FAILED")).toBe(true);
    expect(canTransitionSessionStatus("RUNNING", "CANCELLED")).toBe(true);
    expect(canTransitionSessionStatus("QUEUED", "COMPLETED")).toBe(false);
    expect(canTransitionSessionStatus("COMPLETED", "RUNNING")).toBe(false);
    expect(canTransitionSessionStatus("FAILED", "COMPLETED")).toBe(false);
    expect(canTransitionSessionStatus("CANCELLED", "RUNNING")).toBe(false);
  });
});

describe("observation helpers", () => {
  const element = (over: Partial<ObservedElement> = {}): ObservedElement => ({
    role: "button",
    name: "Save",
    kind: "BUTTON",
    ...over,
  });

  it("maps observed elements to semantic targets", () => {
    expect(elementToTarget(element({ role: "button", name: "Save" }))).toEqual({
      strategy: "ROLE_NAME",
      role: "button",
      name: "Save",
    });
    expect(elementToTarget(element({ role: "textbox", name: "Email" }))).toEqual({
      strategy: "ROLE_NAME",
      role: "textbox",
      name: "Email",
    });
  });

  it("refuses to target unnamed or unknown-role elements", () => {
    expect(elementToTarget(element({ name: "" }))).toBeNull();
    expect(elementToTarget(element({ role: "mystery" }))).toBeNull();
  });

  it("hashes page state and detects change", () => {
    const base = { url: "https://a.example", title: "A", interactiveElements: [element(), element({ name: "Cancel" })] };
    const same = { url: "https://a.example", title: "A", interactiveElements: [element({ name: "Cancel" }), element()] };
    expect(computePageStateHash(base)).toBe(computePageStateHash(same));
    expect(computePageStateHash(base)).toHaveLength(8);
    expect(computePageStateHash({ ...base, url: "https://b.example" })).not.toBe(computePageStateHash(base));
    expect(computePageStateHash({ ...base, title: "B" })).not.toBe(computePageStateHash(base));
  });
});

describe("session status transitions", () => {
  it("allows progress writes while a run is open", () => {
    expect(canTransitionSessionStatus("RUNNING", "RUNNING")).toBe(true);
    expect(canTransitionSessionStatus("QUEUED", "QUEUED")).toBe(true);
    expect(canTransitionSessionStatus("QUEUED", "RUNNING")).toBe(true);
  });

  it("never reopens a terminal session", () => {
    for (const terminal of ["COMPLETED", "FAILED", "CANCELLED"] as const) {
      for (const target of ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const) {
        expect(canTransitionSessionStatus(terminal, target)).toBe(false);
      }
    }
  });
});

describe("success criteria", () => {
  const observation = {
    url: "https://example.com/projects/7",
    title: "Launchboard Dashboard",
    pageText: "Project created successfully",
    interactiveElements: [
      { kind: "BUTTON", role: "button", name: "Save", enabled: true },
      { kind: "LINK", role: "link", name: "Projects", enabled: true },
    ],
  } as unknown as BrowserObservation;

  it("parses each supported criterion form", () => {
    expect(parseSuccessCriteria('text contains "Created"')).toEqual([
      { kind: "TEXT_PRESENT", value: "Created" },
    ]);
    expect(parseSuccessCriteria("url includes /dashboard")).toEqual([
      { kind: "URL_CONTAINS", value: "/dashboard" },
    ]);
    expect(parseSuccessCriteria("title is Launchboard")).toEqual([
      { kind: "TITLE_CONTAINS", value: "Launchboard" },
    ]);
    expect(parseSuccessCriteria('element "Save" is visible')).toEqual([
      { kind: "ELEMENT_PRESENT", name: "Save" },
    ]);
  });

  it("splits a list of criteria and ignores unparseable lines", () => {
    const criteria = parseSuccessCriteria(
      'text contains "created" and url contains "/projects" and the sky is blue',
    );
    expect(criteria).toEqual([
      { kind: "TEXT_PRESENT", value: "created" },
      { kind: "URL_CONTAINS", value: "/projects" },
    ]);
  });

  it("verifies criteria against a real observation", () => {
    const verdict = evaluateSuccessCriteria(
      'text contains "created successfully" and url contains "/projects/7" and element "Save" visible',
      observation,
    );
    expect(verdict.verified).toBe(true);
    expect(verdict.results).toHaveLength(3);
    expect(verdict.unparsed).toEqual([]);
  });

  it("refuses to verify when a criterion is absent", () => {
    const verdict = evaluateSuccessCriteria('text contains "never appears"', observation);
    expect(verdict.verified).toBe(false);
    expect(verdict.results[0]?.ok).toBe(false);
    expect(verdict.results[0]?.detail).toContain("does not contain");
  });

  it("treats unparseable free text as unverified", () => {
    const verdict = evaluateSuccessCriteria("A confirmation banner appears", observation);
    expect(verdict.verified).toBe(false);
    expect(verdict.results).toEqual([]);
    expect(verdict.unparsed).toEqual(["A confirmation banner appears"]);
  });

  it("does not verify an empty criteria string", () => {
    expect(evaluateSuccessCriteria(null, observation).verified).toBe(false);
    expect(evaluateSuccessCriteria("   ", observation).verified).toBe(false);
  });
});
