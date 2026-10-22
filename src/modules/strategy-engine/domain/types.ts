import type { CreativeAngle } from "../../../core/domain/creative-direction";

export const STRATEGY_EVIDENCE_LEVELS = [
  "MEASURED",
  "GROUNDED",
  "HYPOTHESIS",
] as const;
export type StrategyEvidenceLevel = (typeof STRATEGY_EVIDENCE_LEVELS)[number];

export const STRATEGY_PLATFORM_ROLES = [
  "AUTHORITY",
  "REACH",
  "PROOF",
  "CONVERSION",
  "LAUNCH",
  "OWNED",
] as const;
export type StrategyPlatformRole = (typeof STRATEGY_PLATFORM_ROLES)[number];

export type StrategyThesis = {
  headline: string;
  argument: string;
  proof: string;
  evidenceLevel: StrategyEvidenceLevel;
  basis: string[];
};

export type StrategyAudience = {
  summary: string;
  segments: string[];
  pain: string | null;
  desiredOutcome: string | null;
  missing: string[];
  evidenceLevel: StrategyEvidenceLevel;
};

export type StrategyPlatformPlay = {
  platformId: string;
  platformName: string;
  role: StrategyPlatformRole;
  job: string;
  contentTypeId: string;
  format: string;
  cadence: string;
  proofToLeadWith: string;
  why: string;
  evidenceLevel: StrategyEvidenceLevel;
};

export type StrategyTimingWindow = {
  label: string;
  startHourUtc: number;
  endHourUtc: number;
  confidence: "LOW" | "MEDIUM" | "HIGH" | "HYPOTHESIS";
  note: string;
};

export type StrategyTiming = {
  status: "MEASURED" | "EXPERIMENT";
  headline: string;
  detail: string;
  windows: StrategyTimingWindow[];
  measurement: string;
  evidence: string[];
  evidenceLevel: StrategyEvidenceLevel;
};

export type StrategyContentPlay = {
  id: string;
  sequence: number;
  title: string;
  angle: CreativeAngle;
  angleLabel: string;
  subjectType: string;
  subjectLabel: string;
  platformId: string;
  platformName: string;
  contentTypeId: string;
  format: string;
  hook: string;
  proof: string;
  proofReady: boolean;
  whyNow: string;
  cta: string;
  successSignal: string;
  repeatRule: string;
};

export type StrategyGuardrail = {
  title: string;
  detail: string;
  severity: "STOP" | "CHECK";
};

export type StrategyMeasurement = {
  readiness: "MEASURED" | "NEEDS_DATA";
  headline: string;
  detail: string;
  measuredPosts: number;
  publishedPosts: number;
  nextCheck: string;
  decisionRule: string;
  evidenceLevel: StrategyEvidenceLevel;
};

export type StrategySourceSummary = {
  features: number;
  specificFeatures: number;
  problems: number;
  benefits: number;
  workflows: number;
  supportedClaims: number;
  audienceSignals: number;
  measuredPosts: number;
  publishedPosts: number;
};

export type StrategyTrendItem = {
  id: string;
  title: string;
  source: string;
  sourceUrl: string;
  publishedAt: string | null;
  whyNow: string;
  contentAngle: string;
  hook: string;
  platformId: string;
  platformName: string;
  format: string;
  proofNeeded: string;
};

export type StrategyTrendLayer = {
  status: "READY" | "DISABLED" | "UNAVAILABLE";
  asOf: string;
  summary: string;
  items: StrategyTrendItem[];
};

export type SocialStrategy = {
  generatedAt: string;
  confidence: StrategyEvidenceLevel;
  thesis: StrategyThesis;
  audience: StrategyAudience;
  platforms: StrategyPlatformPlay[];
  timing: StrategyTiming;
  contentSystem: {
    principle: string;
    rotationRule: string;
    plays: StrategyContentPlay[];
  };
  guardrails: StrategyGuardrail[];
  measurement: StrategyMeasurement;
  missingInputs: string[];
  sourceSummary: StrategySourceSummary;
};

export function strategyEvidenceLabel(level: StrategyEvidenceLevel): string {
  if (level === "MEASURED") return "Measured evidence";
  if (level === "GROUNDED") return "Grounded in project data";
  return "Hypothesis to test";
}
