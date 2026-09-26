import type { SourceType } from "../domain/source";
import type { EvidenceKind } from "../domain/intelligence";
import type { IntelligenceDraft } from "../domain/intelligence-draft";

export interface IntelligenceInterpretationSource {
  id: string;
  type: SourceType;
  name: string;
}

export interface IntelligenceInterpretationEvidenceRef {
  key: string;
  sourceId: string;
  kind: EvidenceKind;
  locator: string;
}

export interface IntelligenceInterpretationRequest {
  projectId: string;
  sources: IntelligenceInterpretationSource[];
  evidence: IntelligenceInterpretationEvidenceRef[];
  observations: string;
  model?: string;
  signal?: AbortSignal;
}

export interface IntelligenceInterpretationResult {
  provider: string;
  model: string;
  draft: IntelligenceDraft;
}

export interface IntelligenceInterpretationProvider {
  readonly id: string;
  interpret(
    request: IntelligenceInterpretationRequest,
  ): Promise<IntelligenceInterpretationResult>;
}
