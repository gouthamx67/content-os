/**
 * The creative context is everything a director is allowed to know. It is built
 * on the server from the project's own records and passed whole to a provider,
 * so a director never has to ask the browser what the product is.
 *
 * Nothing in here is a suggestion. `assets`, `evidence` and `claims` are the
 * complete set of things a direction is permitted to reference, and the
 * validator treats a reference to anything outside them as an invention.
 */

import type { CreativeAngle, CreativeMode } from "./creative-direction";
import type { BrandExecutionProfile } from "./brand";

/** What a direction is allowed to lean on, and how far it may lean. */
export interface CreativeModePolicy {
  mode: CreativeMode;
  label: string;
  description: string;
  /** Metaphors and visual analogies are permitted. */
  allowMetaphor: boolean;
  /** Unconventional opening mechanisms are permitted. */
  allowExperimentalHooks: boolean;
  /** The real product interface is required, not merely preferred. */
  requireProductUi: boolean;
  /** A style that cannot be shown with real UI may still be proposed. */
  allowConceptualVisuals: boolean;
  /**
   * Always zero. A mode can change how creative a piece is allowed to be; it
   * cannot change what the project is allowed to have said.
   */
  maxUnverifiedClaims: 0;
  /** Candidate angles this mode will consider. */
  readonly allowedAngles: readonly CreativeAngle[];
}

export interface CreativeContextProduct {
  name: string;
  description: string;
  valueProposition: string;
  features: Array<{ id: string; name: string; description: string }>;
  problems: Array<{ id: string; description: string }>;
  benefits: Array<{ id: string; description: string }>;
  workflows: Array<{ id: string; name: string; steps: string[] }>;
  /** CP06 claims, with the verification status that decides whether they may be used. */
  claims: Array<{
    id: string;
    text: string;
    verification: string;
    evidenceIds: string[];
  }>;
  audienceSummary: string;
}

export interface CreativeContextBrand {
  name: string;
  summary: string;
  tone: string[];
  style: string[];
  ctaStyle: string | null;
  /** The brand's own guidance for what this kind of content should feel like. */
  executionSummary: string;
  version: number | null;
}

export interface CreativeContextAsset {
  id: string;
  name: string;
  type: string;
  role: string | null;
  /** Whether the asset can stand in for real product UI, decided server-side. */
  isProductUi: boolean;
  origin: "PROJECT" | "INTELLIGENCE";
}

export interface CreativeContextEvidence {
  id: string;
  kind: string;
  /** Where the evidence came from, in words a person can check. */
  locator: string;
  snippet: string;
  /** Claims this evidence supports. */
  claimIds: string[];
}

/**
 * The resolved intent, flattened for the director. A direction is written
 * against one request, so the director has to be able to read the request it is
 * writing for without going back to the API.
 */
export interface CreativeContextIntent {
  channel: string;
  contentTypeName: string;
  purpose: string | null;
  audience: string | null;
  tone: string | null;
  style: string | null;
  language: string | null;
  cta: string | null;
  durationSeconds: number | null;
  quantity: number;
  aspectRatio: string | null;
  platforms: string[];
  rawRequest: string;
  /** Ids of the product-graph entities the user actually pointed at. */
  subjects: Array<{ type: string; id: string }>;
  constraints: string[];
}

export interface CreativeContext {
  projectId: string;
  intentId: string;
  intent: CreativeContextIntent;
  product: CreativeContextProduct;
  brand: CreativeContextBrand;
  assets: CreativeContextAsset[];
  evidence: CreativeContextEvidence[];
  mode: CreativeMode;
  policy: CreativeModePolicy;
  brandVersion: number | null;
  intelligenceVersion: number | null;
}

/** Builds the brand half of the context from the real execution profile. */
export function brandContext(
  brand: BrandExecutionProfile | null,
): CreativeContextBrand {
  return {
    name: brand?.name ?? "",
    summary: brand?.positioning ?? "",
    tone: brand?.voice.signals.map((signal) => signal.value) ?? [],
    style: brand?.visual.style ? [brand.visual.style] : [],
    ctaStyle: null,
    executionSummary: brand?.voice.summary ?? "",
    version: brand?.version ?? null,
  };
}
