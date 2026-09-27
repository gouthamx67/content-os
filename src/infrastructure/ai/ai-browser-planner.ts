import { BrowserError, type BrowserActionType } from "../../core/domain/browser";
import type { AIProvider } from "../../core/ports/ai-provider";
import type {
  BrowserPlanner,
  BrowserPlannerPlan,
  BrowserPlannerRequest,
} from "../../core/ports/browser-planner";
import {
  compactPlannerRequest,
  describeActionForHistory,
  validatePlannerPlan,
  type PlanValidationOptions,
} from "../../core/services/browser-planner";

/**
 * AI-driven browser planner.
 *
 * The model sees a compact observation and returns a JSON plan. Its output is
 * untrusted: it is parsed with {@link validatePlannerPlan}, which rejects
 * unknown actions, smuggled code, oversized payloads, and off-policy URLs. A
 * plan that fails validation never reaches the browser.
 */

const SYSTEM_PROMPT = `You plan web browser interactions for an automated agent.

You receive a goal, the current page observation, and the elements available on the page.
You reply with a single JSON object and nothing else:

{"actions":[{"type":"CLICK","target":{"strategy":"ROLE_NAME","role":"button","name":"New Project"}}],"rationale":"...","believesComplete":false}

Rules:
- Only use these action types: GOTO, BACK, FORWARD, RELOAD, CLICK, DOUBLE_CLICK, HOVER, FILL, TYPE, PRESS, SELECT, CHECK, UNCHECK, SCROLL, SCROLL_TO, UPLOAD, WAIT, WAIT_FOR_URL, WAIT_FOR_TEXT, WAIT_FOR_ELEMENT, READ_TEXT, READ_ATTRIBUTE, ASSERT_VISIBLE, ASSERT_TEXT, ASSERT_URL, OPEN_NEW_TAB, CLOSE_PAGE.
- There is no way to run JavaScript. Never attempt to evaluate scripts or add script/code fields.
- Target strategies in order of preference: ROLE_NAME, LABEL, PLACEHOLDER, TEST_ID, CSS, XPATH.
- Use exact accessible names copied from the observation.
- Prefer ASSERT_* actions to verify the goal before claiming completion.
- Keep plans short: at most 8 actions.
- Never target coordinates.`;

export interface AiBrowserPlannerOptions {
  model?: string;
  temperature?: number;
  maxOutputChars?: number;
}

export class AiBrowserPlanner implements BrowserPlanner {
  readonly name = "ai";

  constructor(
    private readonly provider: AIProvider,
    private readonly validation: Omit<PlanValidationOptions, "limits">,
    private readonly options: AiBrowserPlannerOptions = {},
  ) {}

  async plan(request: BrowserPlannerRequest): Promise<BrowserPlannerPlan> {
    const compact = compactPlannerRequest(request);
    const userPrompt = JSON.stringify(
      {
        goal: compact.goal,
        successCriteria: compact.successCriteria,
        url: compact.observation.url,
        title: compact.observation.title,
        pageTextExcerpt: compact.observation.pageText.slice(0, 1_500),
        elements: compact.availableElements.slice(0, 60),
        history: compact.history.slice(-8),
        previousActions: compact.previousActions.slice(-5).map(describeActionForHistory),
        productKnowledge: compact.intelligence
          ? {
              features: compact.intelligence.features.slice(0, 15).map((feature) => feature.name),
              workflows: compact.intelligence.workflows.slice(0, 5).map((workflow) => workflow.name),
              problems: compact.intelligence.problems.slice(0, 8).map((problem) => problem.name),
            }
          : null,
        remainingActionBudget: compact.limits.maxActions - compact.previousActions.length,
      },
      null,
      0,
    );

    const response = await this.provider.generate({
      model: this.options.model,
      temperature: this.options.temperature ?? 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      metadata: { purpose: "browser-plan" },
    });

    const text = response.text.slice(0, this.options.maxOutputChars ?? 20_000);
    const plan = extractJsonPlan(text);
    const validated = validatePlannerPlan(plan, request, {
      ...this.validation,
      limits: request.limits,
    });
    return { ...validated, provider: this.provider.constructor.name, model: response.model ?? null };
  }
}

/**
 * Models wrap JSON in prose and fences more often than not. This extracts the
 * outermost balanced object without trusting anything inside it — the result
 * still has to survive strict validation.
 */
export function extractJsonPlan(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  if (start < 0) {
    throw new BrowserError("ACTION_INVALID", "Planner response contained no JSON object");
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, index + 1)) as unknown;
        } catch {
          throw new BrowserError("ACTION_INVALID", "Planner response was not valid JSON");
        }
      }
    }
  }
  throw new BrowserError("ACTION_INVALID", "Planner response had an unbalanced JSON object");
}

export type { BrowserActionType, BrowserPlannerPlan, BrowserPlannerRequest };
export { describeActionForHistory };
