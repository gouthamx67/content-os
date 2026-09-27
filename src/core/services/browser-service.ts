import { randomUUID } from "node:crypto";
import {
  BrowserError,
  canTransitionSessionStatus,
  clampTaskLimits,
  describeTarget,
  evaluateSuccessCriteria,
  parseBrowserAction,
  summarizeAction,
  type BrowserAction,
  type BrowserActionType,
  type BrowserErrorCode,
  type BrowserObservation,
  type BrowserSession,
  type BrowserTargetClass,
  type BrowserTaskLimits,
  type InteractionStep,
  type ObservedElement,
} from "../domain/browser";
import type { IntelligenceGraph } from "../domain/intelligence";
import type { IntelligenceRepository } from "../ports/intelligence-repository";
import type { BrowserPlanner, BrowserPlannerRequest } from "../ports/browser-planner";
import type {
  BrowserIsolationMode,
  BrowserRuntime,
  BrowserRuntimeOptions,
  BrowserRuntimeSession,
} from "../ports/browser-runtime";
import type { BrowserSessionRepository } from "../ports/browser-session-repository";
import { describeActionForHistory } from "./browser-planner";

/**
 * Browser agent orchestration.
 *
 * The loop is deliberately explicit:
 *
 *   OBSERVE -> PLAN -> VALIDATE -> ACT -> OBSERVE -> VERIFY
 *
 * Every plan action passes the domain parser again here, so a planner that
 * somehow returns unvalidated output still cannot reach the browser. Steps are
 * persisted as they happen, not at the end, so an aborted session still leaves
 * a reviewable trace.
 */

export interface RunBrowserTaskInput {
  projectId: string;
  targetSourceId: string;
  initialUrl: string;
  goal: string;
  successCriteria?: string | null;
  targetClass?: BrowserTargetClass;
  limits?: Partial<BrowserTaskLimits>;
  /** Optional product graph so the planner does not rediscover the product. */
  intelligence?: IntelligenceGraph | null;
}

export interface BrowserServiceDeps {
  sessions: BrowserSessionRepository;
  runtime: BrowserRuntime;
  planner: BrowserPlanner;
  /** Navigation policy closure: throws BrowserError(NAVIGATION_BLOCKED). */
  checkUrl: (url: string, targetClass: BrowserTargetClass) => void;
  intelligence?: IntelligenceRepository | null;
  /**
   * Membership check for the owning workspace. Every read and write goes
   * through this, so an API caller can never reach another workspace's traces.
   */
  authorize: (projectId: string, userId: string) => Promise<unknown>;
  /**
   * Launch options for the runtime. `launch` must be idempotent: the service
   * calls it before every session so it never has to care whether a previous
   * run already started the browser process.
   */
  runtimeOptions: BrowserRuntimeOptions;
  /** Called once per session so a runner can enforce wall-clock limits. */
  now?: () => number;
  createId?: () => string;
}

/** Actions that mean "this target does not exist / is ambiguous". */
const REPLAN_TRIGGERS: ReadonlySet<BrowserErrorCode> = new Set([
  "TARGET_NOT_FOUND",
  "TARGET_AMBIGUOUS",
]);

export class BrowserService {
  private readonly now: () => number;
  private readonly createId: () => string;
  /**
   * Sessions currently executing in this process. Cancellation needs this: a
   * row flip alone would leave a live browser driving the page for the rest of
   * its budget.
   */
  private readonly live = new Map<string, { cancel: () => void; session: BrowserRuntimeSession | null }>();

  constructor(private readonly deps: BrowserServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.createId = deps.createId ?? (() => `bse_${randomUUID()}`);
  }

  async runTask(input: RunBrowserTaskInput, userId: string): Promise<BrowserSession> {
    await this.deps.authorize(input.projectId, userId);
    const limits = clampTaskLimits(input.limits);
    const targetClass: BrowserTargetClass = input.targetClass ?? "PUBLIC";
    this.deps.checkUrl(input.initialUrl, targetClass);
    this.assertIsolationForTarget(targetClass);

    let session = await this.deps.sessions.createSession({
      id: this.createId(),
      projectId: input.projectId,
      targetSourceId: input.targetSourceId,
      targetClass,
      initialUrl: input.initialUrl,
      goal: input.goal,
      successCriteria: input.successCriteria ?? null,
      status: "QUEUED",
    });

    session = await this.deps.sessions.updateSessionState(input.projectId, session.id, {
      status: "RUNNING",
      startedAt: new Date(this.now()).toISOString(),
    });

    const deadline = this.now() + limits.maxDurationMs;
    let runtimeSession: BrowserRuntimeSession | null = null;
    let actionCount = 0;
    let pageCount = 1;
    let order = 0;
    let lastObservation: BrowserObservation | null = null;
    let failure: { code: BrowserErrorCode; message: string } | null = null;
    const history: string[] = [];
    const previousActions: BrowserAction[] = [];
    let cancelled = false;
    let plannerClaimedComplete = false;
    let assertionsPassed = 0;
    this.live.set(session.id, {
      cancel: () => {
        cancelled = true;
      },
      session: null,
    });

    try {
      await this.deps.runtime.launch(this.deps.runtimeOptions);
      runtimeSession = await this.deps.runtime.createSession({ projectId: input.projectId });
      this.live.get(session.id)!.session = runtimeSession;

      const navigation = await this.executeStep(input, runtimeSession, limits, order++, {
        type: "GOTO",
        url: input.initialUrl,
      }, null);
      actionCount += 1;
      lastObservation = navigation.observation;
      await this.persistStep(input.projectId, session.id, navigation.step);
      await this.persistObservation(input.projectId, session.id, order - 1, navigation.observation);

      if (!navigation.outcome.ok) {
        failure = { code: navigation.outcome.errorCode ?? "ACTION_FAILED", message: navigation.outcome.errorMessage ?? "Navigation failed" };
      }

      let stalledPlans = 0;
      while (!cancelled && !failure && actionCount < limits.maxActions && this.now() < deadline) {
        const observation: BrowserObservation = lastObservation ?? (await runtimeSession.observe());
        const request: BrowserPlannerRequest = {
          goal: input.goal,
          successCriteria: input.successCriteria ?? null,
          observation,
          intelligence: input.intelligence ?? null,
          history: [...history],
          limits,
          previousActions: [...previousActions],
          availableElements: observation.interactiveElements,
        };

        let plan;
        try {
          plan = await this.deps.planner.plan(request);
        } catch (error) {
          failure = {
            code: error instanceof BrowserError ? error.code : "ACTION_INVALID",
            message: error instanceof Error ? error.message.slice(0, 500) : "Planner failed",
          };
          break;
        }

        if (plan.believesComplete) plannerClaimedComplete = true;

        if (plan.actions.length === 0) {
          if (plan.believesComplete) break;
          // A planner that proposes nothing twice in a row is stuck, not done.
          // Without this guard the loop would spin on empty plans.
          stalledPlans += 1;
          if (stalledPlans >= 2) {
            failure = { code: "ACTION_INVALID", message: "Planner made no progress" };
            break;
          }
          continue;
        }

        // Re-reading an unchanged page is not progress. Without this guard a
        // planner that only READs can spend the whole action budget watching the
        // same screen and the run fails late instead of early.
        const hashBeforePlan: string | undefined = observation.pageStateHash;
        const canChangePage = plan.actions.some(isPageChangingAction);

        for (const action of plan.actions) {
          if (actionCount >= limits.maxActions || this.now() >= deadline) break;
          // Defence in depth: re-validate before every execution.
          let validated: BrowserAction;
          try {
            validated = parseBrowserAction(action);
            if (hasUrl(validated)) this.deps.checkUrl(validated.url, targetClass);
          } catch (error) {
            failure = {
              code: error instanceof BrowserError ? error.code : "ACTION_INVALID",
              message: error instanceof Error ? error.message.slice(0, 500) : "Action rejected",
            };
            break;
          }

          const step = await this.executeStep(input, runtimeSession, limits, order++, validated, observation);
          actionCount += 1;
          pageCount = Math.max(pageCount, (await runtimeSession.listPages()).length);
          lastObservation = step.observation;
          await this.persistStep(input.projectId, session.id, step.step);
          await this.persistObservation(input.projectId, session.id, order - 1, step.observation);

          history.push(`${validated.type} -> ${step.outcome.ok ? "ok" : (step.outcome.errorCode ?? "failed")}`);
          previousActions.push(validated);
          if (
            step.step.status === "COMPLETED" &&
            (validated.type === "ASSERT_VISIBLE" ||
              validated.type === "ASSERT_TEXT" ||
              validated.type === "ASSERT_URL")
          ) {
            assertionsPassed += 1;
          }

          if (!step.outcome.ok) {
            const code = step.outcome.errorCode ?? "ACTION_FAILED";
            // A missing or ambiguous target is recoverable: stop this plan and
            // let the next observation produce a different target.
            if (REPLAN_TRIGGERS.has(code)) break;
            failure = { code, message: step.outcome.errorMessage ?? `${validated.type} failed` };
            break;
          }
        }

        if (!failure && !canChangePage && lastObservation?.pageStateHash === hashBeforePlan) {
          stalledPlans += 1;
          if (stalledPlans >= 2) {
            failure = {
              code: "ACTION_INVALID",
              message: "Planner re-read the same page without changing anything",
            };
            break;
          }
        } else {
          stalledPlans = 0;
        }
      }

      if (!failure && this.now() >= deadline) {
        failure = { code: "SESSION_TIMEOUT", message: "Session exceeded its time budget" };
      }
      if (!failure && actionCount >= limits.maxActions && lastObservation) {
        history.push("action budget exhausted");
      }
    } catch (error) {
      failure = {
        code: error instanceof BrowserError ? error.code : "BROWSER_START_FAILED",
        message: error instanceof Error ? error.message.slice(0, 500) : "Browser session failed to start",
      };
    } finally {
      this.live.delete(session.id);
      if (runtimeSession) {
        await this.deps.runtime.closeSession(runtimeSession).catch(() => undefined);
      }
    }

    // A task that was cancelled, or that never had its success criteria
    // confirmed, is not a success. Reporting COMPLETED for either would be a
    // lie the trace cannot back up.
    if (!failure && cancelled) {
      failure = { code: "ACTION_INVALID", message: "Task was cancelled" };
    }
    if (!failure && input.successCriteria) {
      failure = verifySuccessCriteria(input.successCriteria, lastObservation, {
        plannerClaimedComplete,
        assertionsPassed,
      });
    }

    // A concurrent cancelSession may have settled the row while this loop was
    // still running. Re-read first: an external terminal state wins, and
    // writing over it would resurrect a session the caller already stopped.
    const stored = await this.deps.sessions.getSession(input.projectId, session.id);
    if (stored && stored.status !== "RUNNING" && stored.status !== "QUEUED") {
      return stored;
    }

    const status: BrowserSession["status"] = failure ? "FAILED" : "COMPLETED";
    if (canTransitionSessionStatus("RUNNING", status)) {
      session = await this.deps.sessions.updateSessionState(input.projectId, session.id, {
        status,
        currentUrl: lastObservation?.url ?? input.initialUrl,
        pageCount,
        actionCount,
        endedAt: new Date(this.now()).toISOString(),
        errorCode: failure?.code ?? null,
        errorMessage: failure?.message ?? null,
      });
    }

    await this.recordEvidence(input, session, failure);
    return session;
  }

  /**
   * An untrusted target is only ever opened inside Chromium's OS-level sandbox.
   * A browser running without it is a local development convenience, and
   * refusing here is the point: without this rule a misconfigured dev server
   * would happily point an unsandboxed renderer at an arbitrary website.
   */
  private assertIsolationForTarget(targetClass: BrowserTargetClass): void {
    // The runtime is the only authority on how it launched. A caller-supplied
    // "it was sandboxed" claim is exactly the thing this check exists to refuse.
    const mode: BrowserIsolationMode = this.deps.runtime.isolationMode;
    if (targetClass === "PUBLIC" && mode !== "CHROMIUM_SANDBOX") {
      throw new BrowserError(
        "BROWSER_START_FAILED",
        "Refusing to open an untrusted target without the Chromium sandbox. " +
          "Restore the sandbox, or run against a CONTROLLED_LOCAL target.",
      );
    }
  }

  private async executeStep(
    input: RunBrowserTaskInput,
    runtimeSession: BrowserRuntimeSession,
    limits: BrowserTaskLimits,
    order: number,
    action: BrowserAction,
    before: BrowserObservation | null,
  ): Promise<{
    outcome: Awaited<ReturnType<BrowserRuntimeSession["execute"]>>;
    observation: BrowserObservation;
    step: InteractionStep;
  }> {
    const startedAt = new Date(this.now()).toISOString();
    const started = this.now();
    const outcome = await runtimeSession.execute(action, {
      navigationTimeoutMs: limits.navigationTimeoutMs,
      actionTimeoutMs: limits.actionTimeoutMs,
      maxUploadBytes: limits.maxUploadBytes,
    });
    const completed = new Date(this.now()).toISOString();
    const summary = summarizeAction(action);

    return {
      outcome,
      observation: outcome.observation,
      step: {
        order,
        actionType: action.type,
        targetSummary: summary.target,
        inputSummary: summary.input,
        status: outcome.ok ? "COMPLETED" : "FAILED",
        startedAt,
        completedAt: completed,
        durationMs: Math.max(0, this.now() - started),
        pageStateHashBefore: before?.pageStateHash ?? null,
        pageStateHashAfter: outcome.observation.pageStateHash,
        result: outcome.result,
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
      },
    };
  }

  private async persistStep(projectId: string, sessionId: string, step: InteractionStep): Promise<void> {
    await this.deps.sessions.appendStep(projectId, sessionId, step);
  }

  private async persistObservation(
    projectId: string,
    sessionId: string,
    stepOrder: number,
    observation: BrowserObservation,
  ): Promise<void> {
    await this.deps.sessions.recordObservation({
      sessionId,
      stepOrder,
      pageId: observation.pageId,
      url: observation.url,
      title: observation.title,
      pageStateHash: observation.pageStateHash,
      payload: JSON.stringify({
        pageText: observation.pageText.slice(0, 2_000),
        elements: observation.interactiveElements.slice(0, 40).map((element: ObservedElement) => ({
          role: element.role,
          name: element.name,
          kind: element.kind,
        })),
        dialogs: observation.dialogs.length,
        consoleErrors: observation.consoleErrors.slice(0, 5),
      }),
    });
    void projectId;
  }

  /**
   * Bridges the run into Product Intelligence as BROWSER_INTERACTION evidence,
   * so what the agent actually saw on the live target is reviewable next to
   * the extracted claims. Never stores credentials: only action summaries and
   * page identity.
   */
  private async recordEvidence(
    input: RunBrowserTaskInput,
    session: BrowserSession,
    failure: { code: BrowserErrorCode; message: string } | null,
  ): Promise<void> {
    const repository = this.deps.intelligence;
    if (!repository) return;
    const trace = await this.deps.sessions.getTrace(input.projectId, session.id).catch(() => null);
    const steps = trace?.steps ?? [];
    await repository
      .recordEvidence(input.projectId, [
        {
          id: `ev_${session.id}`,
          key: `browser:${session.id}`,
          sourceId: input.targetSourceId,
          kind: "BROWSER_INTERACTION",
          locator: session.initialUrl.slice(0, 500),
          excerpt: [
            `Goal: ${input.goal}`,
            `Status: ${session.status}`,
            `Actions: ${session.actionCount}`,
            `Final URL: ${session.currentUrl}`,
            failure ? `Failure: ${failure.code}` : null,
            ...steps.slice(0, 25).map((step) => `${step.order}. ${step.actionType} ${step.targetSummary ?? ""}`.trim()),
          ]
            .filter((line): line is string => line !== null)
            .join(" | ")
            .slice(0, 2_000),
          metadata: JSON.stringify({
            sessionId: session.id,
            targetClass: session.targetClass,
            actionCount: session.actionCount,
            pageCount: session.pageCount,
            errorCode: session.errorCode,
            planner: this.deps.planner.name,
          }),
        },
      ])
      .catch(() => undefined);
  }

  async getSession(projectId: string, sessionId: string, userId: string): Promise<BrowserSession | null> {
    await this.deps.authorize(projectId, userId);
    return this.deps.sessions.getSession(projectId, sessionId);
  }

  async listSessions(projectId: string, userId: string, limit?: number): Promise<BrowserSession[]> {
    await this.deps.authorize(projectId, userId);
    return this.deps.sessions.listSessions(projectId, limit);
  }

  async getTrace(projectId: string, sessionId: string, userId: string) {
    await this.deps.authorize(projectId, userId);
    return this.deps.sessions.getTrace(projectId, sessionId);
  }

  async listObservations(projectId: string, sessionId: string, userId: string, limit?: number) {
    await this.deps.authorize(projectId, userId);
    return this.deps.sessions.listObservations(projectId, sessionId, limit);
  }

  async cancelSession(projectId: string, sessionId: string, userId: string): Promise<BrowserSession | null> {
    await this.deps.authorize(projectId, userId);

    // Stop the browser first: a row that says CANCELLED while the agent is still
    // clicking is worse than a row that takes a moment to settle.
    const live = this.live.get(sessionId);
    if (live) {
      live.cancel();
      if (live.session) {
        await this.deps.runtime.closeSession(live.session).catch(() => undefined);
      }
    }

    return this.deps.sessions.cancelSession(projectId, sessionId);
  }
}

/**
 * Independent verification.
 *
 * A run with success criteria passes only if the page itself satisfies them. A
 * criterion this module cannot parse is treated as unmet, and a parsed one is
 * checked against the final observation — the planner's belief is never enough
 * on its own. Free-text criteria still need a passing ASSERT_* step and an
 * explicit completion claim, because that is the only evidence available for
 * them.
 */
function verifySuccessCriteria(
  criteria: string,
  observation: BrowserObservation | null,
  context: { plannerClaimedComplete: boolean; assertionsPassed: number },
): { code: BrowserErrorCode; message: string } | null {
  if (!observation) {
    return { code: "VERIFICATION_FAILED", message: "No observation to verify the success criteria against" };
  }

  const verdict = evaluateSuccessCriteria(criteria, observation);
  if (verdict.verified) return null;

  if (verdict.results.length > 0) {
    const failed = verdict.results.filter((result) => !result.ok);
    if (failed.length > 0) {
      return {
        code: "VERIFICATION_FAILED",
        message: `Success criteria not met: ${failed.map((result) => result.detail).join("; ")}`,
      };
    }
    if (verdict.unparsed.length > 0) {
      return {
        code: "VERIFICATION_FAILED",
        message: `Success criteria could not be checked: ${verdict.unparsed.join("; ")}`,
      };
    }
  }

  if (context.assertionsPassed > 0 && context.plannerClaimedComplete) return null;

  return {
    code: "VERIFICATION_FAILED",
    message:
      verdict.unparsed.length > 0
        ? `Success criteria could not be checked: ${verdict.unparsed.join("; ")}`
        : "Success criteria were never confirmed by the page",
  };
}

/** Actions that can move the page out of the state it is already in. */
const PAGE_CHANGING_ACTIONS = new Set<BrowserAction["type"]>([
  "GOTO",
  "BACK",
  "FORWARD",
  "RELOAD",
  "CLICK",
  "DOUBLE_CLICK",
  "FILL",
  "TYPE",
  "PRESS",
  "SELECT",
  "CHECK",
  "UNCHECK",
  "SCROLL",
  "UPLOAD",
  "OPEN_NEW_TAB",
  "CLOSE_PAGE",
]);

function isPageChangingAction(action: BrowserAction): boolean {
  return PAGE_CHANGING_ACTIONS.has(action.type);
}

function hasUrl(action: BrowserAction): action is Extract<BrowserAction, { url: string }> {
  return (
    action.type === "GOTO" ||
    action.type === "OPEN_NEW_TAB" ||
    action.type === "WAIT_FOR_URL" ||
    action.type === "ASSERT_URL"
  );
}

export { describeActionForHistory, describeTarget };
export type { BrowserActionType };
