import type { Source } from "../domain/source";
import type { IntelligenceDraft } from "../domain/intelligence-draft";

export interface SourceAnalysisContext {
  projectId: string;
  source: Source;
  bytes: Uint8Array | null;
  signal?: AbortSignal;
}

export interface SourceAnalysisResult {
  draft: IntelligenceDraft;
  notes: string[];
}

export interface SourceAnalyzer {
  readonly id: string;
  supports(source: Source): boolean;
  analyze(context: SourceAnalysisContext): Promise<SourceAnalysisResult>;
}

export class SourceAnalyzerRegistry {
  private readonly analyzers: SourceAnalyzer[];

  constructor(analyzers: readonly SourceAnalyzer[]) {
    this.analyzers = [...analyzers];
  }

  all(): readonly SourceAnalyzer[] {
    return this.analyzers;
  }

  find(source: Source): SourceAnalyzer | null {
    return this.analyzers.find((analyzer) => analyzer.supports(source)) ?? null;
  }
}
