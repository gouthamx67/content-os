import type { Source } from "../../core/domain/source";
import type {
  SourceAnalysisContext,
  SourceAnalysisResult,
  SourceAnalyzer,
} from "../../core/ports/source-analyzer";
import type { IntelligenceDraft } from "../../core/domain/intelligence-draft";
import { addDraftEvidence, emptyIntelligenceDraft } from "../../core/domain/intelligence-draft";
import { canonicalEntityKey, isDuplicateEntity } from "../../core/domain/intelligence-canonical";
import { collapseWhitespace, decodeUtf8, isMeaningfulPhrase, splitSentences, truncate } from "./text";
import {
  extractAudienceSignals,
  extractClaims,
  importanceForFeature,
  looksLikeFeatureLabel,
} from "./heuristics";
import { applyInsightExtraction } from "./insight-wiring";
import { extractPdfText } from "./pdf";

const MAX_SECTIONS = 30;
const MAX_CLAIMS = 25;
const MAX_AUDIENCE = 15;

interface Section {
  heading: string | null;
  body: string;
}

const MARKDOWN_HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const PLAIN_HEADING = /^([A-Z][\w'& /-]{2,60})$/;

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, (_match, heading: string) =>
      /[.!?]$/.test(heading) ? `${heading} ` : `${heading}. `,
    )
    .replace(/[*_`]/g, "");
}

function splitSections(text: string): Section[] {
  const lines = text.split(/\r?\n/);
  const sections: Section[] = [];
  let heading: string | null = null;
  let body: string[] = [];

  const flush = () => {
    const joined = collapseWhitespace(body.join(" "));
    if (heading !== null || joined.length > 0) sections.push({ heading, body: joined });
    body = [];
  };

  let inFence = false;
  for (const line of lines) {
    if (/^\s{0,3}(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      body.push(line);
      continue;
    }
    const markdown = MARKDOWN_HEADING.exec(line);
    if (markdown) {
      flush();
      heading = markdown[2].trim();
      continue;
    }
    const plain = PLAIN_HEADING.exec(line.trim());
    if (plain && line.trim().length <= 60) {
      flush();
      heading = plain[1].trim();
      continue;
    }
    body.push(line);
  }
  flush();
  return sections;
}

function addEvidence(
  draft: IntelligenceDraft,
  sourceId: string,
  kind: "DOCUMENT_SECTION" | "SOURCE_FRAGMENT",
  locator: string,
  excerpt: string | null,
): string {
  return addDraftEvidence(draft, {
    sourceId,
    kind,
    locator,
    excerpt: excerpt ? truncate(excerpt, 500) : null,
    metadata: null,
  }).key;
}

export class DocumentAnalyzer implements SourceAnalyzer {
  readonly id = "document";

  supports(source: Source): boolean {
    return source.type === "TEXT" || source.type === "DOCUMENT" || source.type === "PDF";
  }

  async analyze(context: SourceAnalysisContext): Promise<SourceAnalysisResult> {
    const draft = emptyIntelligenceDraft();
    const notes: string[] = [];
    const { source } = context;

    if (!context.bytes) {
      notes.push("Document content was not stored locally, so only source metadata was analyzed");
      return { draft, notes };
    }

    let text: string;
    let isPdf = false;
    if (source.type === "PDF" || source.mimeType === "application/pdf") {
      isPdf = true;
      const extraction = extractPdfText(context.bytes);
      notes.push(...extraction.notes);
      text = extraction.text;
    } else {
      text = decodeUtf8(context.bytes);
    }

    if (text.trim().length === 0) {
      notes.push("No readable text could be extracted from the document");
      return { draft, notes };
    }

    const prose = stripMarkdown(text);
    const sections = splitSections(text);
    const baseConfidence = isPdf ? "MEDIUM" : "HIGH";
    const evidenceKind = "DOCUMENT_SECTION" as const;

    const titleSection = sections.find((section) => section.heading !== null);
    const productName = titleSection?.heading ? truncate(titleSection.heading, 200) : source.name;
    const summary = sections
      .map((section) => section.body)
      .find((body) => body.length > 40);
    const productEvidence = addEvidence(
      draft,
      source.id,
      evidenceKind,
      titleSection?.heading ? `heading:${titleSection.heading.slice(0, 60)}` : "body:start",
      summary ?? productName,
    );

    draft.product = {
      name: isMeaningfulPhrase(productName, 2, 200) ? productName : source.name,
      shortDescription: summary ? truncate(summary, 300) : null,
      longDescription: prose.length > 0 ? truncate(prose.slice(0, 2_000), 2_000) : null,
      category: null,
      purpose: summary ? truncate(summary, 500) : null,
      valueProposition: null,
      targetUserSummary: null,
      confidence: baseConfidence,
      assertionKind: "FACT",
      sourceIds: [source.id],
      evidenceKeys: [productEvidence],
    };
    draft.relationships.push({
      type: "PRODUCT_SUPPORTED_BY_EVIDENCE",
      fromType: "PRODUCT",
      fromKey: "product",
      toType: "EVIDENCE",
      toKey: productEvidence,
      confidence: baseConfidence,
    });

    /** Feature heading, so narrative linkage can compare section scope. */
    const featureSections = new Map<string, string>();

    let sectionCount = 0;
    for (const [index, section] of sections.entries()) {
      if (sectionCount >= MAX_SECTIONS) break;
      if (section.heading === null) continue;
      if (index === 0) continue;
      const heading = section.heading;
      if (!looksLikeFeatureLabel(heading, 3, 120)) continue;
      if (isDuplicateEntity(heading, productName)) continue;
      const key = canonicalEntityKey("FEATURE", heading);
      if (draft.features.some((feature) => feature.key === key)) continue;
      if (draft.features.some((feature) => isDuplicateEntity(heading, feature.name))) continue;
      const evidenceKey = addEvidence(draft, source.id, evidenceKind, `heading:${index}:${heading.slice(0, 60)}`, section.body.slice(0, 400));
      draft.features.push({
        key,
        name: truncate(heading, 200),
        description: section.body.length > 0 ? truncate(section.body, 500) : null,
        category: "OTHER",
        importance: importanceForFeature(heading, "heading"),
        confidence: baseConfidence === "HIGH" ? "MEDIUM" : "LOW",
        assertionKind: "FACT",
        sourceIds: [source.id],
        evidenceKeys: [evidenceKey],
      });
      draft.relationships.push({
        type: "FEATURE_SUPPORTED_BY_EVIDENCE",
        fromType: "FEATURE",
        fromKey: key,
        toType: "EVIDENCE",
        toKey: evidenceKey,
        confidence: baseConfidence === "HIGH" ? "MEDIUM" : "LOW",
      });
      featureSections.set(key, heading);
      sectionCount += 1;
    }

    // Problems, benefits and workflows are stated in prose rather than in a
    // heading, so they are read from the section bodies with the heading kept as
    // scope for evidence and for feature linkage.
    applyInsightExtraction(draft, {
      sourceId: source.id,
      evidenceKind,
      confidence: baseConfidence === "HIGH" ? "MEDIUM" : "LOW",
      featureSections,
      candidates: sections.flatMap((section, index) =>
        splitSentences(section.body).map((text) => ({
          text,
          section: section.heading,
          locator: `section:${index}:${section.heading?.slice(0, 40) ?? "body"}:${text.slice(0, 40)}`,
        })),
      ),
    });

    const bodyEvidence = addEvidence(draft, source.id, evidenceKind, "body:prose", prose.slice(0, 400));
    for (const claim of extractClaims([prose], MAX_CLAIMS)) {
      const key = canonicalEntityKey("CLAIM", claim.text);
      if (draft.claims.some((existing) => existing.key === key)) continue;
      draft.claims.push({
        key,
        text: claim.text,
        claimType: claim.claimType,
        sourceId: source.id,
        confidence: baseConfidence === "HIGH" ? "MEDIUM" : "LOW",
        assertionKind: claim.marketing ? "MARKETING_CLAIM" : "INFERENCE",
        sourceIds: [source.id],
        evidenceKeys: [bodyEvidence],
      });
      draft.relationships.push({
        type: "CLAIM_SUPPORTED_BY_EVIDENCE",
        fromType: "CLAIM",
        fromKey: key,
        toType: "EVIDENCE",
        toKey: bodyEvidence,
        confidence: baseConfidence === "HIGH" ? "MEDIUM" : "LOW",
      });
    }

    for (const [index, audience] of extractAudienceSignals([prose], MAX_AUDIENCE).entries()) {
      const evidenceKey = addEvidence(
        draft,
        source.id,
        evidenceKind,
        `audience:${index}:${audience.segment}`,
        audience.segment,
      );
      draft.audienceSignals.push({
        key: canonicalEntityKey("AUDIENCE_SIGNAL", audience.segment),
        segment: audience.segment,
        description: null,
        kind: audience.kind,
        confidence: baseConfidence === "HIGH" ? "MEDIUM" : "LOW",
        assertionKind: "FACT",
        sourceIds: [source.id],
        evidenceKeys: [evidenceKey],
      });
      draft.relationships.push({
        type: "AUDIENCE_SUPPORTED_BY_EVIDENCE",
        fromType: "AUDIENCE_SIGNAL",
        fromKey: canonicalEntityKey("AUDIENCE_SIGNAL", audience.segment),
        toType: "EVIDENCE",
        toKey: evidenceKey,
        confidence: baseConfidence === "HIGH" ? "MEDIUM" : "LOW",
      });
    }

    return { draft, notes };
  }
}
