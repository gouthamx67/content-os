import { describe, expect, it } from "vitest";
import {
  BrowserError,
  DEFAULT_BROWSER_TASK_LIMITS,
  type BrowserAction,
  type BrowserObservation,
  type BrowserSession,
  type BrowserTargetClass,
  type InteractionStep,
} from "../domain/browser";
import type { BrowserPlanner, BrowserPlannerPlan, BrowserPlannerRequest } from "../ports/browser-planner";
import type {
  BrowserActionOutcome,
  BrowserIsolationMode,
  BrowserRunOptions,
  BrowserRuntime,
  BrowserRuntimeOptions,
  BrowserRuntimeSession,
} from "../ports/browser-runtime";
import type {
  BrowserObservationRecord,
  BrowserSessionPageState,
  BrowserSessionRepository,
  CreateBrowserSessionInput,
} from "../ports/browser-session-repository";
import type { EvidenceValues } from "../ports/intelligence-repository";
import { BrowserService } from "./browser-service";

/**
 * These tests drive the orchestration loop with an in-memory browser so the
 * loop's decisions (plan validation, replanning on ambiguity, budget limits,
 * evidence bridging, authorization) are verified independently of Chromium.
 * The Chromium path is covered by playwright-runtime.test.ts.
 */

function observation(over: Partial<BrowserObservation> = {}): BrowserObservation {
  return {
    pageId: "p1",
    url: "https://example.com/",
    title: "Example",
    pageText: "Example page",
    interactiveElements: [],
    dialogs: [],
    forms: [],
    links: [],
    consoleErrors: [],
    pageStateHash: "aaaa1111",
    timestamp: new Date().toISOString(),
    ...over,
  };
}

class FakeRuntimeSession implements BrowserRuntimeSession {
  readonly executed: BrowserAction[] = [];
  pages: string[] = ["p1"];

  constructor(
    private readonly handler: (
      action: BrowserAction,
      call: number,
    ) => Partial<BrowserActionOutcome> | Promise<Partial<BrowserActionOutcome>>,
  ) {}

  get pageId(): string {
    return "p1";
  }

  async observe(): Promise<BrowserObservation> {
    return observation();
  }

  async newPage(): Promise<string> {
    this.pages.push(`p${this.pages.length + 1}`);
    return this.pages.at(-1) ?? "p1";
  }

  async activatePage(): Promise<void> {}

  async listPages(): Promise<string[]> {
    return this.pages;
  }

  async execute(action: BrowserAction, options: BrowserRunOptions): Promise<BrowserActionOutcome> {
    void options;
    this.executed.push(action);
    const partial = await this.handler(action, this.executed.length);
    return {
      ok: true,
      url: observation().url,
      title: observation().title,
      observation: observation(),
      result: null,
      errorCode: null,
      errorMessage: null,
      pageId: "p1",
      ...partial,
    };
  }
}

class FakeRuntime implements BrowserRuntime {
  lastSession: FakeRuntimeSession | null = null;
  closed = 0;
  isolationMode: BrowserIsolationMode = "CHROMIUM_SANDBOX";

  constructor(
    private readonly handler: (
      action: BrowserAction,
      call: number,
    ) => Partial<BrowserActionOutcome> | Promise<Partial<BrowserActionOutcome>>,
  ) {}

  async launch(options: BrowserRuntimeOptions): Promise<void> {
    void options;
  }
  async createSession(): Promise<BrowserRuntimeSession> {
    this.lastSession = new FakeRuntimeSession(this.handler);
    return this.lastSession;
  }
  async closeSession(): Promise<void> {
    // no-op for the fake
  }
  async close(): Promise<void> {
    this.closed += 1;
  }
}

class InMemoryBrowserSessions implements BrowserSessionRepository {
  readonly sessions = new Map<string, BrowserSession>();
  readonly steps = new Map<string, InteractionStep[]>();
  readonly observations: BrowserObservationRecord[] = [];
  updates = 0;

  private stamp(): string {
    return new Date().toISOString();
  }

  async createSession(input: CreateBrowserSessionInput): Promise<BrowserSession> {
    const session: BrowserSession = {
      id: input.id,
      projectId: input.projectId,
      targetSourceId: input.targetSourceId,
      targetClass: input.targetClass,
      initialUrl: input.initialUrl,
      currentUrl: input.initialUrl,
      status: input.status,
      goal: input.goal,
      successCriteria: input.successCriteria,
      startedAt: null,
      endedAt: null,
      pageCount: 0,
      actionCount: 0,
      errorCode: null,
      errorMessage: null,
      createdAt: this.stamp(),
      updatedAt: this.stamp(),
    };
    this.sessions.set(session.id, session);
    this.steps.set(session.id, []);
    return session;
  }

  async getSession(projectId: string, sessionId: string): Promise<BrowserSession | null> {
    const session = this.sessions.get(sessionId);
    return session && session.projectId === projectId ? session : null;
  }

  async listSessions(projectId: string): Promise<BrowserSession[]> {
    return [...this.sessions.values()].filter((session) => session.projectId === projectId);
  }

  async updateSessionState(
    projectId: string,
    sessionId: string,
    state: Partial<BrowserSessionPageState>,
  ): Promise<BrowserSession> {
    const session = this.sessions.get(sessionId);
    if (!session || session.projectId !== projectId) {
      throw new BrowserError("SESSION_NOT_FOUND", "missing");
    }
    if (state.status && session.status !== state.status) {
      const allowed: Record<string, string[]> = {
        QUEUED: ["RUNNING", "CANCELLED"],
        RUNNING: ["COMPLETED", "FAILED", "CANCELLED"],
        COMPLETED: [],
        FAILED: [],
        CANCELLED: [],
      };
      if (!allowed[session.status]?.includes(state.status)) {
        throw new BrowserError("ACTION_INVALID", `illegal ${session.status}->${state.status}`);
      }
    }
    this.updates += 1;
    const updated = { ...session, ...state, updatedAt: this.stamp() } as BrowserSession;
    this.sessions.set(sessionId, updated);
    return updated;
  }

  async appendStep(_projectId: string, sessionId: string, step: InteractionStep): Promise<void> {
    this.steps.get(sessionId)?.push(step);
  }

  async getTrace(_projectId: string, sessionId: string) {
    const steps = this.steps.get(sessionId);
    if (!steps) return null;
    const session = this.sessions.get(sessionId);
    return { steps, startedAt: session?.startedAt ?? null, completedAt: session?.endedAt ?? null };
  }

  async recordObservation(record: Omit<BrowserObservationRecord, "id" | "createdAt">): Promise<void> {
    this.observations.push({ ...record, id: `obs_${this.observations.length}`, createdAt: this.stamp() });
  }

  async listObservations(): Promise<BrowserObservationRecord[]> {
    return this.observations;
  }

  async cancelSession(projectId: string, sessionId: string): Promise<BrowserSession | null> {
    const session = await this.getSession(projectId, sessionId);
    if (!session) return null;
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(session.status)) return session;
    return this.updateSessionState(projectId, sessionId, { status: "CANCELLED", endedAt: this.stamp() });
  }
}

class RecordingIntelligence {
  recorded: { projectId: string; evidence: EvidenceValues[] }[] = [];
  async recordEvidence(projectId: string, evidence: EvidenceValues[]): Promise<void> {
    this.recorded.push({ projectId, evidence });
  }
}

/** Planner that replays a fixed script, one action per call. */
class ScriptedPlanner implements BrowserPlanner {
  readonly name = "scripted";
  calls = 0;
  constructor(
    private readonly script: (request: BrowserPlannerRequest, call: number) => BrowserAction[],
    private readonly claimsComplete = true,
  ) {}
  async plan(request: BrowserPlannerRequest): Promise<BrowserPlannerPlan> {
    this.calls += 1;
    return {
      actions: this.script(request, this.calls),
      rationale: "scripted",
      believesComplete: this.claimsComplete,
      provider: this.name,
      model: null,
    };
  }
}

function fakeRuntimeOptions(): BrowserRuntimeOptions {
  return {
    artifactDir: "/tmp/content-os-browser-test",
    navigationTimeoutMs: 1_000,
    actionTimeoutMs: 1_000,
  };
}

function makeService(
  runtime: BrowserRuntime,
  planner: BrowserPlanner,
  sessions = new InMemoryBrowserSessions(),
  intelligence: RecordingIntelligence | null = null,
  extra: Partial<{ now: () => number }> = {},
) {
  const service = new BrowserService({
    sessions,
    runtime,
    planner,
    runtimeOptions: fakeRuntimeOptions(),
    checkUrl: (url: string, targetClass: BrowserTargetClass) => {
      const loopback = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
      if (loopback && targetClass === "CONTROLLED_LOCAL") return;
      if (!/^https:\/\//.test(url)) throw new BrowserError("NAVIGATION_BLOCKED", `blocked ${url}`);
    },
    intelligence: intelligence as never,
    authorize: async () => undefined,
    ...extra,
  });
  return { service, sessions };
}

const baseInput = {
  projectId: "proj_1",
  targetSourceId: "src_1",
  initialUrl: "https://example.com/",
  goal: "Create a project",
};

describe("BrowserService", () => {
  it("navigates, plans, acts and completes a successful run", async () => {
    const runtime = new FakeRuntime(() => ({}));
    const planner = new ScriptedPlanner((_request, call) =>
      call === 1
        ? [{ type: "CLICK", target: { strategy: "ROLE_NAME", role: "button", name: "New Project" } }]
        : [],
    );
    const { service, sessions } = makeService(runtime, planner);
    const session = await service.runTask(baseInput, "user_1");

    expect(session.status).toBe("COMPLETED");
    expect(session.errorCode).toBeNull();
    expect(session.actionCount).toBe(2);
    expect(sessions.steps.get(session.id)).toHaveLength(2);
    expect(sessions.steps.get(session.id)?.[0]?.actionType).toBe("GOTO");
    expect(sessions.steps.get(session.id)?.[1]?.targetSummary).toBe('button "New Project"');
    expect(session.startedAt).not.toBeNull();
    expect(session.endedAt).not.toBeNull();
  });

  it("persists an observation for every step", async () => {
    const runtime = new FakeRuntime(() => ({}));
    const planner = new ScriptedPlanner((_request, call) =>
      call === 1 ? [{ type: "READ_TEXT" }] : [],
    );
    const { service, sessions } = makeService(runtime, planner);
    const session = await service.runTask(baseInput, "user_1");
    expect(sessions.observations.length).toBe(session.actionCount);
    expect(sessions.observations[0]?.url).toBe("https://example.com/");
  });

  it("refuses the request outright when the target URL is blocked by policy", async () => {
    const runtime = new FakeRuntime(() => ({}));
    const planner = new ScriptedPlanner(() => []);
    const { service, sessions } = makeService(runtime, planner);
    // A blocked target never becomes a session: the request is refused instead.
    await expect(
      service.runTask({ ...baseInput, initialUrl: "http://169.254.169.254/" }, "user_1"),
    ).rejects.toThrow(BrowserError);
    expect(sessions.sessions.size).toBe(0);
  });

  it("replans instead of failing when a target is ambiguous", async () => {
    const runtime = new FakeRuntime((action) =>
      action.type === "CLICK"
        ? { ok: false, errorCode: "TARGET_AMBIGUOUS", errorMessage: "matched 3 elements" }
        : {},
    );
    const planner = new ScriptedPlanner((_request, call) =>
      call <= 2 ? [{ type: "CLICK", target: { strategy: "CSS", css: "nav a" } }] : [],
    );
    const { service, sessions } = makeService(runtime, planner);
    const session = await service.runTask(baseInput, "user_1");

    expect(session.status).toBe("COMPLETED");
    expect(planner.calls).toBeGreaterThan(1);
    const steps = sessions.steps.get(session.id) ?? [];
    expect(steps.some((step) => step.errorCode === "TARGET_AMBIGUOUS")).toBe(true);
  });

  it("fails the session on a non-recoverable action error", async () => {
    const runtime = new FakeRuntime((action) =>
      action.type === "ASSERT_TEXT"
        ? { ok: false, errorCode: "VERIFICATION_FAILED", errorMessage: "Expected text missing" }
        : {},
    );
    const planner = new ScriptedPlanner((_request, call) =>
      call === 1 ? [{ type: "ASSERT_TEXT", text: "Created" }] : [],
    );
    const { service } = makeService(runtime, planner);
    const session = await service.runTask(baseInput, "user_1");
    expect(session.status).toBe("FAILED");
    expect(session.errorCode).toBe("VERIFICATION_FAILED");
  });

  it("stops at the action budget rather than looping", async () => {
    const runtime = new FakeRuntime(() => ({}));
    // Navigations are page-changing, so only the action budget can stop this.
    const planner = new ScriptedPlanner(() => [
      { type: "GOTO", url: "https://example.com/next" },
    ]);
    const { service } = makeService(runtime, planner);
    const session = await service.runTask({ ...baseInput, limits: { maxActions: 5 } }, "user_1");
    expect(session.status).toBe("COMPLETED");
    expect(session.actionCount).toBe(5);
  });

  it("fails fast when the planner only re-reads the same page", async () => {
    const runtime = new FakeRuntime(() => ({}));
    // A planner stuck in a read loop on an unchanged page must not spend the
    // whole action budget watching one screen.
    const planner = new ScriptedPlanner(() => [{ type: "READ_TEXT" }], false);
    const { service } = makeService(runtime, planner);
    const session = await service.runTask({ ...baseInput, limits: { maxActions: 40 } }, "user_1");
    expect(session.status).toBe("FAILED");
    expect(session.errorCode).toBe("ACTION_INVALID");
    expect(session.errorMessage).toContain("re-read the same page");
    expect(session.actionCount).toBeLessThan(10);
  });

  it("stops when the wall clock budget is exhausted", async () => {
    const runtime = new FakeRuntime(() => ({}));
    const planner = new ScriptedPlanner(() => [{ type: "READ_TEXT" }]);
    let clock = 0;
    const { service } = makeService(runtime, planner, new InMemoryBrowserSessions(), null, {
      now: () => {
        clock += 2_000;
        return clock;
      },
    });
    const session = await service.runTask({ ...baseInput, limits: { maxDurationMs: 10_000, maxActions: 50 } }, "user_1");
    expect(session.status).toBe("FAILED");
    expect(session.errorCode).toBe("SESSION_TIMEOUT");
  });

  it("records BROWSER_INTERACTION evidence without leaking input values", async () => {
    const runtime = new FakeRuntime(() => ({}));
    const planner = new ScriptedPlanner((_request, call) =>
      call === 1
        ? [
            {
              type: "FILL",
              target: { strategy: "LABEL", label: "Password" },
              value: "super-secret-value",
            },
          ]
        : [],
    );
    const intelligence = new RecordingIntelligence();
    const { service } = makeService(runtime, planner, new InMemoryBrowserSessions(), intelligence);
    await service.runTask(baseInput, "user_1");

    expect(intelligence.recorded).toHaveLength(1);
    const evidence = intelligence.recorded[0]!.evidence[0]!;
    expect(evidence.kind).toBe("BROWSER_INTERACTION");
    expect(evidence.sourceId).toBe("src_1");
    expect(evidence.excerpt).not.toContain("super-secret-value");
    expect(evidence.excerpt).toContain("FILL");
  });

  it("fails cleanly when the runtime cannot start a session", async () => {
    const runtime: BrowserRuntime = {
      isolationMode: "CHROMIUM_SANDBOX",
      launch: async () => undefined,
      createSession: async () => {
        throw new BrowserError("BROWSER_START_FAILED", "no chromium");
      },
      closeSession: async () => undefined,
      close: async () => undefined,
    };
    const planner = new ScriptedPlanner(() => []);
    const { service } = makeService(runtime, planner);
    const session = await service.runTask(baseInput, "user_1");
    expect(session.status).toBe("FAILED");
    expect(session.errorCode).toBe("BROWSER_START_FAILED");
  });

  it("rejects an action the policy refuses even if a planner returns it", async () => {
    const runtime = new FakeRuntime(() => ({}));
    const planner = new ScriptedPlanner((_request, call) =>
      call === 1 ? [{ type: "GOTO", url: "http://10.0.0.5/internal" }] : [],
    );
    const { service } = makeService(runtime, planner);
    const session = await service.runTask(baseInput, "user_1");
    expect(session.status).toBe("FAILED");
    expect(session.errorCode).toBe("NAVIGATION_BLOCKED");
    expect(runtime.lastSession?.executed.every((action) => action.type !== "GOTO" || action.url === baseInput.initialUrl)).toBe(true);
  });

  it("authorizes every read path", async () => {
    const sessions = new InMemoryBrowserSessions();
    const runtime = new FakeRuntime(() => ({}));
    const planner = new ScriptedPlanner(() => []);
    const service = new BrowserService({
      sessions,
      runtime,
      planner,
      runtimeOptions: fakeRuntimeOptions(),
      checkUrl: () => undefined,
      authorize: async () => {
        throw new BrowserError("ACTION_INVALID", "forbidden");
      },
    });
    await expect(service.runTask(baseInput, "intruder")).rejects.toThrow("forbidden");
    await expect(service.listSessions("proj_1", "intruder")).rejects.toThrow("forbidden");
    await expect(service.getSession("proj_1", "nope", "intruder")).rejects.toThrow("forbidden");
    await expect(service.cancelSession("proj_1", "nope", "intruder")).rejects.toThrow("forbidden");
  });

  it("scopes sessions to their project", async () => {
    const sessions = new InMemoryBrowserSessions();
    const service = new BrowserService({
      sessions,
      runtime: new FakeRuntime(() => ({})),
      runtimeOptions: fakeRuntimeOptions(),
      planner: new ScriptedPlanner(() => []),
      checkUrl: () => undefined,
      authorize: async () => undefined,
    });
    const created = await service.runTask(baseInput, "user_1");
    expect(await service.getSession("other_project", created.id, "user_1")).toBeNull();
    expect(await service.listSessions("other_project", "user_1")).toEqual([]);
  });

  it("uses the default limits when none are supplied", async () => {
    const runtime = new FakeRuntime(() => ({}));
    const planner = new ScriptedPlanner(() => []);
    const { service } = makeService(runtime, planner);
    const session = await service.runTask({ ...baseInput, limits: undefined }, "user_1");
    expect(session.status).toBe("COMPLETED");
    expect(DEFAULT_BROWSER_TASK_LIMITS.maxActions).toBeGreaterThan(session.actionCount);
  });

  it("stops a live run when the session is cancelled", async () => {
    const sessions = new InMemoryBrowserSessions();
    // Cancel from inside the third executed action: the loop must notice and
    // settle the session instead of running to its action budget.
    let cancelled = false;
    const planner: BrowserPlanner = {
      name: "self-cancelling",
      async plan(): Promise<BrowserPlannerPlan> {
        return {
          actions: [{ type: "READ_TEXT" }],
          rationale: "keep reading",
          believesComplete: false,
          provider: "self-cancelling",
          model: null,
        };
      },
    };
    const runtime = new FakeRuntime((action, call) => {
      if (call === 3 && !cancelled) {
        cancelled = true;
        const running = [...sessions.sessions.values()].find(
          (session) => session.status === "RUNNING",
        );
        if (running) void sessions.cancelSession(sessions.sessions.values().next().value!.projectId, running.id);
      }
      return action.type === "READ_TEXT" ? {} : {};
    });
    const service = new BrowserService({
      sessions,
      runtime,
      planner,
      runtimeOptions: fakeRuntimeOptions(),
      checkUrl: () => undefined,
      authorize: async () => undefined,
    });
    const session = await service.runTask(
      { ...baseInput, limits: { maxActions: 40 } },
      "user_1",
    );
    // The persisted session was cancelled by the concurrent caller, so the
    // service must not overwrite that terminal state.
    const stored = sessions.sessions.get(session.id)!;
    expect(stored.status).toBe("CANCELLED");
    expect(session.actionCount).toBeLessThan(40);
  });

  it("closes the live browser when a run is cancelled", async () => {
    const sessions = new InMemoryBrowserSessions();
    const planner: BrowserPlanner = {
      name: "waiting",
      async plan(): Promise<BrowserPlannerPlan> {
        return {
          actions: [{ type: "WAIT", durationMs: 5 }],
          rationale: "wait",
          believesComplete: false,
          provider: "waiting",
          model: null,
        };
      },
    };
    // A slow WAIT keeps the loop alive long enough for the cancel to land.
    const runtime = new FakeRuntime(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return {};
    });
    const service = new BrowserService({
      sessions,
      runtime,
      planner,
      runtimeOptions: fakeRuntimeOptions(),
      checkUrl: () => undefined,
      authorize: async () => undefined,
    });
    const running = service.runTask({ ...baseInput, limits: { maxActions: 30 } }, "user_1");
    // Give the loop a moment to register the live session, then cancel it.
    await new Promise((resolve) => setTimeout(resolve, 120));
    const session = [...sessions.sessions.values()][0]!;
    const cancelled = await service.cancelSession(session.projectId, session.id, "user_1");
    expect(cancelled?.status).toBe("CANCELLED");
    const finished = await running;
    expect(["CANCELLED", "FAILED"]).toContain(finished.status);
    expect(finished.actionCount).toBeLessThan(30);
  });

  it("does not report success when the success criteria were never confirmed", async () => {
    const runtime = new FakeRuntime(() => ({}));
    const planner = new ScriptedPlanner(
      () => [{ type: "GOTO", url: "https://example.com/next" }],
      false,
    );
    const { service } = makeService(runtime, planner);
    const session = await service.runTask(
      { ...baseInput, successCriteria: "A confirmation banner appears" },
      "user_1",
    );
    expect(session.status).toBe("FAILED");
    expect(session.errorCode).toBe("VERIFICATION_FAILED");
  });

  it("verifies a checkable criterion against the final page, not the planner", async () => {
    const runtime = new FakeRuntime((action) =>
      action.type === "READ_TEXT"
        ? { observation: observation({ pageText: "Project created successfully" }) }
        : {},
    );
    const planner = new ScriptedPlanner((_request, call) => (call === 1 ? [{ type: "READ_TEXT" }] : []), true);
    const { service } = makeService(runtime, planner);

    const met = await service.runTask(
      { ...baseInput, successCriteria: 'text contains "created successfully"' },
      "user_1",
    );
    expect(met.status).toBe("COMPLETED");
    expect(met.errorCode).toBeNull();
  });

  it("fails a checkable criterion the page does not satisfy", async () => {
    const runtime = new FakeRuntime((action) =>
      action.type === "READ_TEXT"
        ? { observation: observation({ pageText: "Project created successfully" }) }
        : {},
    );
    // The planner claims completion; the page says otherwise. The page wins.
    const planner = new ScriptedPlanner((_request, call) => (call === 1 ? [{ type: "READ_TEXT" }] : []), true);
    const { service } = makeService(runtime, planner);
    const session = await service.runTask(
      { ...baseInput, successCriteria: 'text contains "invoice paid"' },
      "user_1",
    );
    expect(session.status).toBe("FAILED");
    expect(session.errorCode).toBe("VERIFICATION_FAILED");
    expect(session.errorMessage).toContain("invoice paid");
  });

  it("checks a url criterion", async () => {
    const runtime = new FakeRuntime((action) =>
      action.type === "READ_TEXT" ? { observation: observation({ url: "https://example.com/projects/7" }) } : {},
    );
    const planner = new ScriptedPlanner((_request, call) => (call === 1 ? [{ type: "READ_TEXT" }] : []), true);
    const { service } = makeService(runtime, planner);
    const session = await service.runTask(
      { ...baseInput, successCriteria: 'url contains "/projects/7"' },
      "user_1",
    );
    expect(session.status).toBe("COMPLETED");
  });

  it("checks an element criterion", async () => {
    const runtime = new FakeRuntime((action) =>
      action.type === "READ_TEXT" ? { observation: observation({ url: "https://example.com/", interactiveElements: [] }) } : {},
    );
    const planner = new ScriptedPlanner((_request, call) => (call === 1 ? [{ type: "READ_TEXT" }] : []), true);
    const { service } = makeService(runtime, planner);
    const session = await service.runTask(
      { ...baseInput, successCriteria: 'element "Save" visible' },
      "user_1",
    );
    expect(session.status).toBe("FAILED");
    expect(session.errorMessage).toContain("Save");
  });

  it("accepts free-text criteria only when an ASSERT step actually passed", async () => {
    const runtime = new FakeRuntime(() => ({}));
    const planner = new ScriptedPlanner(
      (_request, call) =>
        call === 1 ? [{ type: "ASSERT_TEXT", text: "Created" }] : [],
      true,
    );
    const { service } = makeService(runtime, planner);
    const session = await service.runTask(
      { ...baseInput, successCriteria: "A confirmation banner appears" },
      "user_1",
    );
    expect(session.status).toBe("COMPLETED");
  });

  it("refuses free-text criteria with no passing assertion", async () => {
    const runtime = new FakeRuntime(() => ({}));
    const planner = new ScriptedPlanner((_request, call) => (call === 1 ? [{ type: "READ_TEXT" }] : []), true);
    const { service } = makeService(runtime, planner);
    const session = await service.runTask(
      { ...baseInput, successCriteria: "A confirmation banner appears" },
      "user_1",
    );
    expect(session.status).toBe("FAILED");
    expect(session.errorCode).toBe("VERIFICATION_FAILED");
  });

  it("refuses an untrusted target when the browser sandbox is disabled", async () => {
    const runtime = new FakeRuntime(() => ({}));
    runtime.isolationMode = "UNSANDBOXED_DEV";
    const planner = new ScriptedPlanner(() => []);
    const { service, sessions } = makeService(runtime, planner);
    await expect(service.runTask(baseInput, "user_1")).rejects.toThrow(/sandbox/i);
    expect(sessions.sessions.size).toBe(0);
  });

  it("still allows a controlled local target without the sandbox", async () => {
    const runtime = new FakeRuntime(() => ({}));
    runtime.isolationMode = "UNSANDBOXED_DEV";
    const planner = new ScriptedPlanner(() => []);
    const { service } = makeService(runtime, planner);
    const session = await service.runTask(
      { ...baseInput, initialUrl: "http://127.0.0.1:4311/", targetClass: "CONTROLLED_LOCAL" },
      "user_1",
    );
    expect(session.status).toBe("COMPLETED");
  });

  it("does not let a caller claim a sandbox the runtime did not get", async () => {
    const runtime = new FakeRuntime(() => ({}));
    runtime.isolationMode = "UNSANDBOXED_DEV";
    const planner = new ScriptedPlanner(() => []);
    const service = new BrowserService({
      sessions: new InMemoryBrowserSessions(),
      runtime,
      planner,
      runtimeOptions: fakeRuntimeOptions(),
      // A caller that tries to assert sandboxing anyway must not be believed.
      ...({ isolationMode: "CHROMIUM_SANDBOX" } as unknown as Record<string, never>),
      checkUrl: () => undefined,
      authorize: async () => undefined,
    });
    await expect(service.runTask(baseInput, "user_1")).rejects.toThrow(/sandbox/);
  });

  it("classifies targets explicitly", async () => {
    const runtime = new FakeRuntime(() => ({}));
    const planner = new ScriptedPlanner(() => []);
    const sessions = new InMemoryBrowserSessions();
    const checked: BrowserTargetClass[] = [];
    const service = new BrowserService({
      sessions,
      runtime,
      planner,
      runtimeOptions: fakeRuntimeOptions(),
      checkUrl: (_url, targetClass) => checked.push(targetClass),
      authorize: async () => undefined,
    });
    await service.runTask({ ...baseInput, targetClass: "CONTROLLED_LOCAL" }, "user_1");
    expect(checked).toContain("CONTROLLED_LOCAL");
  });
});
