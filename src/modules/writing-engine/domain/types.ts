/**
 * The writing engine's vocabulary.
 *
 * Every value a job can carry is a closed union here, so an unknown tone or block
 * type is rejected in the domain rather than reaching the database. The records
 * mirror the contract one-to-one; the context shapes are what a generation is
 * actually grounded in.
 */

export const WRITING_BLOCK_TYPES = [
  "HEADLINE",
  "HOOK",
  "SUBHEAD",
  "BODY",
  "CAPTION",
  "CTA",
  "AD_COPY",
  "PRODUCT_DESCRIPTION",
  "SCRIPT",
  "VOICEOVER",
] as const;
export type WritingBlockType = (typeof WRITING_BLOCK_TYPES)[number];

export const WRITING_TONES = [
  "BRAND",
  "PROFESSIONAL",
  "FRIENDLY",
  "PLAYFUL",
  "BOLD",
  "MINIMAL",
  "TECHNICAL",
  "CONVERSATIONAL",
] as const;
export type WritingTone = (typeof WRITING_TONES)[number];

export const WRITING_LENGTHS = ["SHORT", "MEDIUM", "LONG"] as const;
export type WritingLength = (typeof WRITING_LENGTHS)[number];

export const WRITING_PROVIDERS = ["LOCAL_RULES", "REMOTE_LLM"] as const;
export type WritingProvider = (typeof WRITING_PROVIDERS)[number];

export const WRITING_JOB_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCEL_REQUESTED",
  "CANCELLED",
] as const;
export type WritingJobStatus = (typeof WRITING_JOB_STATUSES)[number];

export const CLAIM_STATUSES = ["GROUNDED", "UNSUPPORTED", "REVIEW"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const WRITING_OBJECTIVES = [
  "AWARENESS",
  "EDUCATION",
  "CONSIDERATION",
  "CONVERSION",
  "RETENTION",
  "PRODUCT_EXPLANATION",
] as const;
export type WritingObjective = (typeof WRITING_OBJECTIVES)[number];

export const REWRITE_INSTRUCTIONS = [
  "SHORTEN",
  "SIMPLIFY",
  "MAKE_MORE_DIRECT",
  "MAKE_MORE_CONVERSATIONAL",
  "REMOVE_HYPE",
] as const;
export type RewriteInstruction = (typeof REWRITE_INSTRUCTIONS)[number];

export type WritingVariantRecord = {
  id: string;
  documentId: string;
  ordinal: number;
  label: string;
  text: string;
  textSha256: string;
  instruction: string | null;
  selected: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WritingClaimRecord = {
  id: string;
  projectId: string;
  documentId: string;
  variantId: string | null;
  text: string;
  status: ClaimStatus;
  sourceIds: string[];
  reasoning: string | null;
  createdAt: string;
};

export type WritingDocumentRecord = {
  id: string;
  projectId: string;
  createdById: string;
  title: string;
  blockType: WritingBlockType;
  tone: WritingTone;
  length: WritingLength;
  objective: string;
  audience: string | null;
  language: string | null;
  content: string;
  contentSha256: string;
  contextSnapshot: string;
  contextSha256: string;
  version: number;
  brandVersion: number | null;
  intelligenceVersion: number | null;
  intentId: string | null;
  directionId: string | null;
  storyboardId: string | null;
  sceneId: string | null;
  selectedVariantId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WritingGenerationJobRecord = {
  id: string;
  projectId: string;
  requestedById: string;
  documentId: string | null;
  provider: WritingProvider;
  status: WritingJobStatus;
  blockType: WritingBlockType;
  tone: WritingTone;
  length: WritingLength;
  objective: string;
  audience: string | null;
  language: string | null;
  prompt: string;
  generationRecipe: string;
  recipeSha256: string;
  contextSnapshot: string;
  contextSha256: string;
  variantCount: number;
  progressPct: number;
  providerJobId: string | null;
  providerModel: string | null;
  providerVersion: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

/**
 * One grounded statement the project actually holds, flattened for generation.
 *
 * `sourceIds` is the important field: it holds real CP06 Source ids only. The
 * `entityId` (a feature, benefit, workflow or shot) is kept apart precisely so a
 * generator can never mistake an intelligence entity id for a source and write it
 * into claim provenance.
 */
export type WritingFactKind =
  | "PRODUCT"
  | "FEATURE"
  | "BENEFIT"
  | "PROBLEM"
  | "WORKFLOW"
  | "CLAIM"
  | "AUDIENCE";

export type WritingFact = {
  entityId: string;
  entityKind: WritingFactKind;
  text: string;
  sourceIds: string[];
};

export type WritingEntityFact = {
  id: string;
  text: string;
  sourceIds: string[];
};

export type WritingProductContext = {
  name: string | null;
  category: string | null;
  purpose: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  valueProposition: string | null;
  targetUser: string | null;
  /** Provenance of the product entity itself. */
  sourceIds: string[];
  features: Array<{ id: string; name: string; description: string | null; sourceIds: string[] }>;
  benefits: Array<{ id: string; name: string; description: string | null; sourceIds: string[] }>;
  problems: Array<{ id: string; name: string; description: string | null; sourceIds: string[] }>;
  workflows: Array<{ id: string; name: string; steps: string[]; sourceIds: string[] }>;
  claims: Array<{ id: string; text: string; sourceIds: string[] }>;
  audienceSignals: Array<{ id: string; segment: string; description: string | null; sourceIds: string[] }>;
};

export type WritingBrandContext = {
  name: string | null;
  tagline: string | null;
  valueProposition: string | null;
  positioning: string | null;
  voiceSummary: string | null;
  preferredTerms: string[];
  prohibitedTerms: string[];
  voiceSignals: string[];
  guidelines: Array<{ title: string; detail: string }>;
  version: number | null;
};

export type WritingIntentContext = {
  id: string;
  channel: string | null;
  contentType: string | null;
  tone: string | null;
  audience: string | null;
  cta: string | null;
  platforms: string[];
};

export type WritingDirectionContext = {
  id: string;
  angle: string | null;
  thesis: string | null;
  hook: string | null;
  cta: string | null;
  voiceDirection: string | null;
  audienceAngle: string | null;
};

export type WritingSceneContext = {
  storyboardId: string;
  sceneId: string;
  type: string | null;
  name: string | null;
  purpose: string | null;
  voiceover: string | null;
  textOverlays: string[];
  claimIds: string[];
  featureIds: string[];
};

/**
 * The frozen reading of the project graph a generation works from.
 *
 * Once built this is serialised into the job's `contextSnapshot` and never read
 * live again: a later edit to the brand or product cannot change what an already
 * queued job writes.
 */
export type WritingContext = {
  projectId: string;
  blockType: WritingBlockType;
  objective: WritingObjective;
  tone: WritingTone;
  length: WritingLength;
  audience: string | null;
  language: string | null;
  userRequest: string;
  product: WritingProductContext;
  brand: WritingBrandContext;
  intent: WritingIntentContext | null;
  direction: WritingDirectionContext | null;
  scene: WritingSceneContext | null;
  /** Every real Source id the facts below draw from. */
  sourceIds: string[];
  facts: WritingFact[];
  brandVersion: number | null;
  intelligenceVersion: number | null;
  createdAt: string;
};

export type WritingGenerateRequest = {
  projectId: string;
  requestedById: string;
  blockType: WritingBlockType;
  tone: WritingTone;
  length: WritingLength;
  objective: WritingObjective;
  audience: string | null;
  language: string | null;
  prompt: string;
  variantCount: number;
  provider: WritingProvider;
  intentId: string | null;
  directionId: string | null;
  storyboardId: string | null;
  sceneId: string | null;
};

export type WritingRecipe = {
  version: 1;
  projectId: string;
  blockType: WritingBlockType;
  tone: WritingTone;
  length: WritingLength;
  objective: WritingObjective;
  audience: string | null;
  language: string | null;
  prompt: string;
  variantCount: number;
  provider: WritingProvider;
  context: WritingContext;
};

export type WritingCandidate = {
  label: string;
  text: string;
  instruction?: string | null;
};
