import type {
  BrowserAction,
  BrowserObservation,
  BrowserTarget,
  BrowserTaskLimits,
  ObservedElement,
} from "../domain/browser";
import type { IntelligenceGraph } from "../domain/intelligence";

/**
 * Everything a planner is allowed to see. Notably absent: any way to execute
 * code, and any credential material.
 */
export interface BrowserPlannerRequest {
  goal: string;
  successCriteria: string | null;
  observation: BrowserObservation;
  /** Product intelligence graph from CP06, so the agent need not rediscover workflows. */
  intelligence: IntelligenceGraph | null;
  /** Compact summary of what already happened this session. */
  history: string[];
  limits: BrowserTaskLimits;
  /** Actions already executed, used to avoid repeating a failed step verbatim. */
  previousActions: BrowserAction[];
  availableElements: ObservedElement[];
}

export interface BrowserPlannerPlan {
  actions: BrowserAction[];
  /** Why the planner believes the goal is met, or the intent behind these actions. */
  rationale: string;
  /** Set when the planner believes the success criteria are now satisfied. */
  believesComplete: boolean;
  provider: string;
  model: string | null;
}

export interface BrowserPlanner {
  readonly name: string;

  plan(request: BrowserPlannerRequest): Promise<BrowserPlannerPlan>;
}

export interface BrowserUploadSource {
  assetId: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export type { BrowserTarget };
