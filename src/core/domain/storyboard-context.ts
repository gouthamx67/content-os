/**
 * The storyboard context is everything a planner is allowed to know about one
 * direction it is turning into scenes. It is assembled on the server from the
 * project's own records and the chosen direction, and passed whole.
 *
 * The important property is not that it is complete - it is that it is closed.
 * `assets`, `evidence`, `claims`, `features`, `workflows` and `browserCaptures`
 * are the complete set of things a scene may refer to, so a reference to
 * anything outside them is an invention the validator can catch. A planner that
 * had been handed a database handle would have no such line to fall back on.
 *
 * Dates are ISO strings, matching the rest of the domain.
 */

import type { CreativeDirection, CreativeMode } from "./creative-direction";
import type { CreativeModePolicy } from "./creative-context";

/** What the piece has to be, as the resolved request and the brief imply. */
export interface StoryboardContextRequirements {
  /** Milliseconds. This is the number the timeline has to land on exactly. */
  targetDurationMs: number;
  aspectRatio: string | null;
  platforms: string[];
  language: string | null;
  tone: string | null;
  style: string | null;
  channel: string;
  contentTypeName: string;
  rawRequest: string;
  audience: string | null;
  /** The ask from the request, if the request made one. */
  cta: string | null;
}

export interface StoryboardContextClaim {
  id: string;
  text: string;
  verification: string;
  evidenceIds: string[];
}

export interface StoryboardContextFeature {
  id: string;
  name: string;
  description: string;
  evidenceIds: string[];
}

export interface StoryboardContextWorkflowStep {
  id: string;
  order: number;
  action: string;
  description: string;
  featureIds: string[];
}

export interface StoryboardContextWorkflow {
  id: string;
  name: string;
  description: string;
  steps: StoryboardContextWorkflowStep[];
  featureIds: string[];
  evidenceIds: string[];
}

export interface StoryboardContextProduct {
  name: string;
  description: string;
  valueProposition: string;
  audienceSummary: string;
  features: StoryboardContextFeature[];
  workflows: StoryboardContextWorkflow[];
  problems: Array<{ id: string; description: string }>;
  benefits: Array<{ id: string; description: string }>;
  claims: StoryboardContextClaim[];
}

export interface StoryboardContextBrand {
  name: string;
  positioning: string;
  tagline: string;
  voiceSummary: string;
  tone: string[];
  visualStyle: string;
  colors: Array<{ role: string; name: string; hex: string }>;
  fonts: Array<{ role: string; family: string; weight: string | null }>;
  preferredTerms: string[];
  avoidTerms: string[];
  version: number | null;
}

export interface StoryboardContextAsset {
  id: string;
  name: string;
  type: string;
  role: string | null;
  /** Whether the asset can stand in for the real product interface. */
  isProductUi: boolean;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  origin: "PROJECT" | "INTELLIGENCE";
}

/** A browser session this project has already run, and the traces inside it. */
export interface StoryboardContextBrowserCapture {
  id: string;
  url: string;
  goal: string;
  status: string;
  /** Trace ids (step orders as `sss_oo`) this session actually recorded. */
  traceIds: string[];
}

export interface StoryboardContextEvidence {
  id: string;
  kind: string;
  locator: string;
  snippet: string;
  claimIds: string[];
}

/** The chosen direction, flattened. A storyboard is written against one of these. */
export interface StoryboardContextDirection {
  id: string;
  name: string;
  angle: CreativeDirection["angle"];
  mode: CreativeMode;
  /** The run this direction came from, so a plan traces back to a generation. */
  creativeRunId: string;
  thesis: string;
  hook: CreativeDirection["hook"];
  audienceAngle: string;
  emotionalAngle: string;
  narrativeSummary: string;
  visualStrategy: CreativeDirection["visualStrategy"];
  proofStrategy: CreativeDirection["proofStrategy"];
  voiceDirection: string;
  musicDirection: string;
  soundDirection: string;
  cta: string | null;
  rationale: string;
}

export interface StoryboardContext {
  projectId: string;
  intentId: string;
  directionId: string;
  mode: CreativeMode;
  policy: CreativeModePolicy;
  requirements: StoryboardContextRequirements;
  direction: StoryboardContextDirection;
  product: StoryboardContextProduct;
  brand: StoryboardContextBrand;
  assets: StoryboardContextAsset[];
  evidence: StoryboardContextEvidence[];
  browserCaptures: StoryboardContextBrowserCapture[];
  brandVersion: number | null;
  intelligenceVersion: number | null;
}

/** A trace id is the session it belongs to plus the step order inside it. */
export function browserTraceId(sessionId: string, order: number): string {
  return `${sessionId}_${String(order).padStart(3, "0")}`;
}
