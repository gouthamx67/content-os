import type {
  BrandConfidence,
  BrandPrecedence,
  BrandTermCategory,
  BrandTermPreference,
  BrandTextField,
} from "../domain/brand";

export interface BrandInterpretationEvidenceRef {
  key: string;
  sourceId: string;
  kind: string;
  locator: string;
}

export interface BrandInterpretationSource {
  id: string;
  type: string;
  name: string;
}

export interface BrandInterpretationRequest {
  projectId: string;
  sources: BrandInterpretationSource[];
  evidence: BrandInterpretationEvidenceRef[];
  observations: string;
  deterministicFields: BrandTextField[];
  model?: string;
}

export interface BrandInterpretedText {
  field: BrandTextField;
  value: string;
  confidence: BrandConfidence;
  evidenceKeys: string[];
}

export interface BrandInterpretedVoiceSignal {
  kind: string;
  value: string;
  confidence: BrandConfidence;
  evidenceKeys: string[];
}

export interface BrandInterpretedTerm {
  term: string;
  category: BrandTermCategory;
  preference: BrandTermPreference;
  confidence: BrandConfidence;
  evidenceKeys: string[];
}

/**
 * The AI is allowed to describe the brand, never to fabricate its material
 * facts: colors, fonts and assets are not part of this result type, so there is
 * no field for a model to fill with a hex value or a font file.
 */
export interface BrandInterpretationResult {
  provider: string;
  model: string;
  text: BrandInterpretedText[];
  voiceSignals: BrandInterpretedVoiceSignal[];
  terms: BrandInterpretedTerm[];
  notes: string[];
}

export interface BrandInterpretationProvider {
  readonly id: string;
  interpret(
    request: BrandInterpretationRequest,
  ): Promise<BrandInterpretationResult>;
}

export const BRAND_AI_BASIS: BrandPrecedence = "INFERENCE";
