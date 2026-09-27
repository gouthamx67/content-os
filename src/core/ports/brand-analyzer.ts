import type {
  BrandAsset,
  BrandAssetRole,
  BrandColor,
  BrandColorRole,
  BrandConfidence,
  BrandFont,
  BrandFontRole,
  BrandGuideline,
  BrandOrigin,
  BrandPrecedence,
  BrandTerm,
  BrandTermCategory,
  BrandTermPreference,
  BrandVoiceSignal,
} from "../domain/brand";
import type { Source } from "../domain/source";
import type { Asset } from "../domain/asset";
import type { EvidenceKind } from "../domain/intelligence";

export interface BrandEvidenceDraft {
  key: string;
  sourceId: string;
  kind: EvidenceKind;
  locator: string;
  excerpt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface BrandColorCandidate {
  role: BrandColorRole;
  name: string;
  hex: string;
  confidence: BrandConfidence;
  origin: BrandOrigin;
  basis: BrandPrecedence;
  evidenceKeys: string[];
  notes?: string | null;
}

export interface BrandFontCandidate {
  role: BrandFontRole;
  family: string;
  weight?: string | null;
  style?: string | null;
  sourceUrl?: string | null;
  confidence: BrandConfidence;
  origin: BrandOrigin;
  basis: BrandPrecedence;
  evidenceKeys: string[];
  notes?: string | null;
}

export interface BrandAssetCandidate {
  assetId: string;
  role: BrandAssetRole;
  label: string;
  confidence: BrandConfidence;
  origin: BrandOrigin;
  basis: BrandPrecedence;
  evidenceKeys: string[];
  notes?: string | null;
}

export interface BrandTermCandidate {
  term: string;
  category: BrandTermCategory;
  preference: BrandTermPreference;
  confidence: BrandConfidence;
  origin: BrandOrigin;
  basis: BrandPrecedence;
  evidenceKeys: string[];
  notes?: string | null;
}

export interface BrandGuidelineCandidate {
  title: string;
  detail: string;
  origin: BrandOrigin;
  basis: BrandPrecedence;
  evidenceKeys: string[];
}

export interface BrandVoiceSignalCandidate {
  kind: string;
  value: string;
  confidence: BrandConfidence;
  origin: BrandOrigin;
  basis: BrandPrecedence;
  evidenceKeys: string[];
}

export interface BrandTextCandidate {
  field:
    | "name"
    | "positioning"
    | "tagline"
    | "valueProposition"
    | "voiceSummary"
    | "visualStyle";
  value: string;
  confidence: BrandConfidence;
  origin: BrandOrigin;
  basis: BrandPrecedence;
  evidenceKeys: string[];
}

export interface BrandAnalyzerResult {
  text: BrandTextCandidate[];
  colors: BrandColorCandidate[];
  fonts: BrandFontCandidate[];
  assets: BrandAssetCandidate[];
  terms: BrandTermCandidate[];
  guidelines: BrandGuidelineCandidate[];
  voiceSignals: BrandVoiceSignalCandidate[];
  evidence: BrandEvidenceDraft[];
  notes: string[];
}

export function emptyBrandAnalyzerResult(): BrandAnalyzerResult {
  return {
    text: [],
    colors: [],
    fonts: [],
    assets: [],
    terms: [],
    guidelines: [],
    voiceSignals: [],
    evidence: [],
    notes: [],
  };
}

export interface BrandAnalyzerInput {
  projectId: string;
  source: Source | null;
  bytes: Uint8Array | null;
  text: string | null;
  html: string | null;
  existingAssetIds: string[];
  existingAssets: Asset[];
  signal?: AbortSignal;
}

export interface BrandAnalyzer {
  readonly id: string;
  supports(input: BrandAnalyzerInput): boolean;
  analyze(input: BrandAnalyzerInput): Promise<BrandAnalyzerResult>;
}

export class BrandAnalyzerRegistry {
  private readonly analyzers: BrandAnalyzer[];

  constructor(analyzers: readonly BrandAnalyzer[] = []) {
    this.analyzers = [...analyzers];
  }

  all(): readonly BrandAnalyzer[] {
    return this.analyzers;
  }

  add(analyzer: BrandAnalyzer): this {
    this.analyzers.push(analyzer);
    return this;
  }

  find(input: BrandAnalyzerInput): BrandAnalyzer | null {
    return this.analyzers.find((analyzer) => analyzer.supports(input)) ?? null;
  }
}

export type BrandMaterial =
  | { kind: "color"; value: BrandColor }
  | { kind: "font"; value: BrandFont }
  | { kind: "asset"; value: BrandAsset }
  | { kind: "term"; value: BrandTerm }
  | { kind: "voiceSignal"; value: BrandVoiceSignal }
  | { kind: "guideline"; value: BrandGuideline };

export function brandMaterialKey(material: BrandMaterial): string {
  switch (material.kind) {
    case "color":
      return `color:${material.value.role}:${material.value.hex}`;
    case "font":
      return `font:${material.value.role}:${material.value.family.toLowerCase()}`;
    case "asset":
      return `asset:${material.value.assetId}:${material.value.role}`;
    case "term":
      return `term:${material.value.term.toLowerCase()}`;
    case "voiceSignal":
      return `voice:${material.value.kind}:${material.value.value.toLowerCase()}`;
    case "guideline":
      return `guideline:${material.value.title.toLowerCase()}`;
  }
}
