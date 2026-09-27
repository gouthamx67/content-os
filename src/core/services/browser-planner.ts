import {
  BrowserError,
  parseBrowserAction,
  type BrowserAction,
  type BrowserActionType,
  type BrowserTarget,
  type ObservedElement,
} from "../domain/browser";
import { DEFAULT_BROWSER_TASK_LIMITS, type BrowserTaskLimits } from "../domain/browser";
import type { BrowserPlanner, BrowserPlannerPlan, BrowserPlannerRequest } from "../ports/browser-planner";

/**
 * Plan validation.
 *
 * Every plan — from the AI planner, the deterministic planner, or an API
 * caller — passes through {@link validatePlannerPlan} before a single action
 * is executed. This is the layer that turns untrusted model output into the
 * closed action set the runtime understands.
 */

export interface PlanValidationOptions {
  limits: BrowserTaskLimits;
  /** Resolves an action's URL through the navigation policy. Throws on refusal. */
  checkUrl: (url: string) => void;
  /** Optional extra per-action rule, e.g. "no GOTO off-origin after start". */
  rule?: (action: BrowserAction, request: BrowserPlannerRequest) => void;
}

/** How many actions a single plan may propose. */
const MAX_ACTIONS_PER_PLAN = 12;

export function validatePlannerPlan(
  raw: unknown,
  request: BrowserPlannerRequest,
  options: PlanValidationOptions,
): BrowserPlannerPlan {
  if (typeof raw !== "object" || raw === null) {
    throw new BrowserError("ACTION_INVALID", "Planner returned no plan");
  }
  const record = raw as Record<string, unknown>;
  const rawActions = record["actions"];
  if (!Array.isArray(rawActions)) {
    throw new BrowserError("ACTION_INVALID", "Planner plan must contain an actions array");
  }
  if (rawActions.length === 0) {
    throw new BrowserError("ACTION_INVALID", "Planner plan contains no actions");
  }
  if (rawActions.length > MAX_ACTIONS_PER_PLAN) {
    throw new BrowserError("ACTION_INVALID", `Plan exceeds ${MAX_ACTIONS_PER_PLAN} actions`);
  }

  const actions: BrowserAction[] = [];
  for (const candidate of rawActions) {
    const action = parseBrowserAction(candidate);
    if (action.type === "GOTO" || action.type === "OPEN_NEW_TAB" || action.type === "WAIT_FOR_URL" || action.type === "ASSERT_URL") {
      options.checkUrl(action.url);
    }
    if (action.type === "WAIT" && action.durationMs > options.limits.navigationTimeoutMs) {
      throw new BrowserError("ACTION_INVALID", "WAIT exceeds the session timeout budget");
    }
    options.rule?.(action, request);
    actions.push(action);
  }

  const rationale = typeof record["rationale"] === "string" ? (record["rationale"] as string) : "";
  const believesComplete = record["believesComplete"] === true;
  return {
    actions,
    rationale: rationale.slice(0, 500),
    believesComplete,
    provider: typeof record["provider"] === "string" ? (record["provider"] as string) : "unknown",
    model: typeof record["model"] === "string" ? (record["model"] as string) : null,
  };
}

/**
 * Deterministic planner.
 *
 * This is the planner used for tests, local development without an AI key,
 * and as the fallback when a model returns unusable output. It navigates by
 * matching the goal's words against observed element names — no randomness, so
 * a failed run is always reproducible.
 */
export class DeterministicBrowserPlanner implements BrowserPlanner {
  readonly name = "deterministic";

  constructor(private readonly maxActions = 6) {}

  async plan(request: BrowserPlannerRequest): Promise<BrowserPlannerPlan> {
    const goal = request.goal.toLowerCase().trim();
    const actions: BrowserAction[] = [];
    const elements = request.availableElements.length > 0
      ? request.availableElements
      : request.observation.interactiveElements;

    // Read the page when the goal asks for content we do not have yet.
    if (/\b(read|extract|collect|what|content|text)\b/.test(goal) && actions.length === 0) {
      actions.push({ type: "READ_TEXT" });
    }

    for (const element of elements) {
      if (actions.length >= this.maxActions) break;
      const action = this.actionForElement(element, goal, request);
      if (action) actions.push(action);
    }

    if (actions.length === 0) {
      // Nothing matched: fall back to a single harmless observation read so
      // the session still produces a meaningful trace.
      actions.push({ type: "READ_TEXT" });
    }

    return {
      actions: actions.slice(0, this.maxActions),
      rationale: "Deterministic match of the goal against observed element names",
      believesComplete: true,
      provider: this.name,
      model: null,
    };
  }

  private actionForElement(
    element: ObservedElement,
    goal: string,
    request: BrowserPlannerRequest,
  ): BrowserAction | null {
    const name = element.name.toLowerCase();
    if (name.length === 0) return null;
    const target: BrowserTarget = { strategy: "ROLE_NAME", role: element.role, name: element.name };
    const mentioned = goal.includes(name) || name.includes(goal);

    switch (element.kind) {
      case "BUTTON":
        return mentioned ? { type: "CLICK", target } : null;
      case "LINK": {
        if (!mentioned || !element.href) return null;
        // A page href is often relative. GOTO only accepts absolute http(s),
        // so resolve it against the observed page or drop the candidate.
        const href = absoluteHref(element.href, request.observation.url);
        if (!href) return null;
        return { type: "GOTO", url: href };
      }
      case "TEXTBOX":
        return { type: "FILL", target, value: this.valueFor(element, request) };
      case "CHECKBOX":
        return { type: "CHECK", target };
      case "SELECT":
        return null;
      default:
        return null;
    }
  }

  private valueFor(element: ObservedElement, request: BrowserPlannerRequest): string {
    if (element.value) return element.value;
    if (/email/i.test(element.name)) return "agent@example.com";
    if (/name/i.test(element.name)) return "Agent Test";
    if (/search|query/i.test(element.name)) return request.goal.slice(0, 60);
    return "Content OS";
  }
}

/** Trims a planner request to the context budget a model can actually hold. */
export function compactPlannerRequest(request: BrowserPlannerRequest): BrowserPlannerRequest {
  return {
    ...request,
    availableElements: request.availableElements.slice(0, 60),
    history: request.history.slice(-10),
    previousActions: request.previousActions.slice(-10),
    limits: request.limits ?? DEFAULT_BROWSER_TASK_LIMITS,
  };
}

/** Short history line for the planner prompt and the persisted trace. */
export function describeActionForHistory(action: BrowserAction): string {
  const target = "target" in action ? action.target : null;
  const described =
    target && typeof target === "object" && "name" in target
      ? String((target as { name: string }).name)
      : target && typeof target === "object" && "label" in target
        ? String((target as { label: string }).label)
        : target && typeof target === "object" && "testId" in target
          ? String((target as { testId: string }).testId)
          : "";
  return `${action.type}${described ? ` ${described}` : ""}`;
}

export type { BrowserActionType };

/** Resolves a possibly relative href against the current page URL. */
function absoluteHref(href: string, pageUrl: string): string | null {
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}
