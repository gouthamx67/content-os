import type { Source } from "../../core/domain/source";
import type {
  SourceAnalysisContext,
  SourceAnalysisResult,
  SourceAnalyzer,
} from "../../core/ports/source-analyzer";
import { addDraftEvidence, emptyIntelligenceDraft } from "../../core/domain/intelligence-draft";
import { canonicalEntityKey } from "../../core/domain/intelligence-canonical";
import { truncate } from "./text";

export class ReferenceAnalyzer implements SourceAnalyzer {
  readonly id = "reference";

  supports(source: Source): boolean {
    return source.type === "FIGMA" || source.type === "OTHER";
  }

  async analyze(context: SourceAnalysisContext): Promise<SourceAnalysisResult> {
    const draft = emptyIntelligenceDraft();
    const { source } = context;

    const evidenceKey = addDraftEvidence(draft, {
      sourceId: source.id,
      kind: "EXTRACTED_METADATA",
      locator: `reference:${source.name}`,
      excerpt: source.uri ?? source.name,
      metadata: null,
    }).key;
    draft.assets.push({
      key: canonicalEntityKey("ASSET", source.name),
      sourceId: source.id,
      name: truncate(source.name, 200),
      mediaType: "OTHER",
      role: "SUPPORTING",
      storageKey: source.storageKey,
      mimeType: source.mimeType,
      width: null,
      height: null,
      durationMs: null,
      qualitySignals: JSON.stringify({ reference: true, resolved: false }),
      relatedFeatureKeys: [],
      relatedClaimKeys: [],
      confidence: "LOW",
      assertionKind: "FACT",
      sourceIds: [source.id],
      evidenceKeys: [evidenceKey],
    });

    return {
      draft,
      notes: [
        "This source is a reference link. Its contents are not fetched, so only the reference itself was recorded",
      ],
    };
  }
}
