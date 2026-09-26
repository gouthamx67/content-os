import type { Source } from "../../core/domain/source";
import type {
  SourceAnalysisContext,
  SourceAnalysisResult,
  SourceAnalyzer,
} from "../../core/ports/source-analyzer";
import type { IntelligenceDraft } from "../../core/domain/intelligence-draft";
import { addDraftEvidence, emptyIntelligenceDraft } from "../../core/domain/intelligence-draft";
import {
  canonicalEntityKey,
  isDuplicateEntity,
  textCoversPhrase,
} from "../../core/domain/intelligence-canonical";
import { findMeta, parseHtmlDocument } from "./html";
import { decodeUtf8, isMeaningfulPhrase, truncate } from "./text";
import { applyInsightExtraction } from "./insight-wiring";
import {
  assetRoleForMediaType,
  classifyAssetMediaType,
  classifyFeatureCategory,
  extractAudienceSignals,
  extractClaims,
  importanceForFeature,
  looksLikeFeatureLabel,
} from "./heuristics";

const MAX_IMAGES = 20;
const MAX_HEADING_FEATURES = 30;
const MAX_LIST_FEATURES = 40;

function addEvidence(
  draft: IntelligenceDraft,
  sourceId: string,
  locator: string,
  excerpt: string | null,
): string {
  return addDraftEvidence(draft, {
    sourceId,
    kind: "URL_SECTION",
    locator,
    excerpt: excerpt ? truncate(excerpt, 500) : null,
    metadata: null,
  }).key;
}

export class WebsiteAnalyzer implements SourceAnalyzer {
  readonly id = "website";

  supports(source: Source): boolean {
    return source.type === "WEBSITE" || source.type === "WEB_APP";
  }

  async analyze(context: SourceAnalysisContext): Promise<SourceAnalysisResult> {
    const notes: string[] = [];
    const draft = emptyIntelligenceDraft();
    const { source } = context;

    if (!context.bytes) {
      notes.push("Website content was not stored locally, so only source metadata was analyzed");
      return { draft, notes };
    }

    const html = decodeUtf8(context.bytes);
    const document = parseHtmlDocument(html);
    if (document.headings.length === 0 && document.paragraphs.length === 0) {
      notes.push("No readable headings or paragraphs were found in the website markup");
    }

    const siteName = findMeta(document, "og:site_name", "application-name");
    const metaDescription = findMeta(document, "description", "og:description");
    const headingOne = document.headings.find((heading) => heading.level === 1)?.text ?? null;
    const productName = siteName ?? document.title ?? headingOne;
    const productEvidence =
      addEvidence(
        draft,
        source.id,
        siteName ? "meta:og:site_name" : document.title ? "title" : "h1:0",
        productName ?? metaDescription ?? source.name,
      ) ?? "";

    if (productName || metaDescription) {
      draft.product = {
        name: productName ? truncate(productName, 200) : null,
        shortDescription: metaDescription ? truncate(metaDescription, 300) : null,
        longDescription: document.paragraphs[0]
          ? truncate(document.paragraphs.slice(0, 3).join(" "), 2_000)
          : null,
        category: null,
        purpose: document.paragraphs[0] ? truncate(document.paragraphs[0], 500) : null,
        valueProposition: metaDescription ? truncate(metaDescription, 500) : null,
        targetUserSummary: null,
        confidence: "HIGH",
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
        confidence: "HIGH",
      });
    }

    const headingFeatures: { name: string; evidenceKey: string }[] = [];
    let headingCount = 0;
    for (const [index, heading] of document.headings.entries()) {
      if (headingCount >= MAX_HEADING_FEATURES) break;
      if (heading.level === 1) continue;
      if (productName && isDuplicateEntity(heading.text, productName)) continue;
      if (!looksLikeFeatureLabel(heading.text)) continue;
      const key = canonicalEntityKey("FEATURE", heading.text);
      if (draft.features.some((feature) => feature.key === key)) continue;
      const evidenceKey = addEvidence(draft, source.id, `h${heading.level}:${index}`, heading.text);
      headingFeatures.push({ name: heading.text, evidenceKey });
      headingCount += 1;
    }

    const listFeatures: { name: string; evidenceKey: string }[] = [];
    let listCount = 0;
    for (const [index, item] of document.listItems.entries()) {
      if (listCount >= MAX_LIST_FEATURES) break;
      if (item.length > 160) continue;
      if (!looksLikeFeatureLabel(item)) continue;
      const key = canonicalEntityKey("FEATURE", item);
      if (draft.features.some((feature) => feature.key === key)) continue;
      if (headingFeatures.some((feature) => isDuplicateEntity(item, feature.name))) continue;
      const evidenceKey = addEvidence(draft, source.id, `li:${index}`, item);
      listFeatures.push({ name: item, evidenceKey });
      listCount += 1;
    }

    for (const feature of [...headingFeatures, ...listFeatures]) {
      const context_ =
        headingFeatures.includes(feature) ? ("heading" as const) : ("list" as const);
      draft.features.push({
        key: canonicalEntityKey("FEATURE", feature.name),
        name: truncate(feature.name, 200),
        description: null,
        category: classifyFeatureCategory(feature.name),
        importance: importanceForFeature(feature.name, context_),
        confidence: "MEDIUM",
        assertionKind: "FACT",
        sourceIds: [source.id],
        evidenceKeys: [feature.evidenceKey],
      });
      draft.relationships.push({
        type: "FEATURE_SUPPORTED_BY_EVIDENCE",
        fromType: "FEATURE",
        fromKey: canonicalEntityKey("FEATURE", feature.name),
        toType: "EVIDENCE",
        toKey: feature.evidenceKey,
        confidence: "MEDIUM",
      });
    }

    const copyTexts = [
      ...document.paragraphs,
      ...document.listItems,
      ...document.buttons,
      ...document.headings.map((heading) => heading.text),
    ];
    const claimEvidence = addEvidence(draft, source.id, "body:copy", copyTexts.slice(0, 3).join(" "));
    for (const claim of extractClaims(copyTexts)) {
      const key = canonicalEntityKey("CLAIM", claim.text);
      draft.claims.push({
        key,
        text: claim.text,
        claimType: claim.claimType,
        sourceId: source.id,
        confidence: "MEDIUM",
        assertionKind: claim.marketing ? "MARKETING_CLAIM" : "INFERENCE",
        sourceIds: [source.id],
        evidenceKeys: [claimEvidence],
      });
      draft.relationships.push({
        type: "CLAIM_SUPPORTED_BY_EVIDENCE",
        fromType: "CLAIM",
        fromKey: key,
        toType: "EVIDENCE",
        toKey: claimEvidence,
        confidence: "MEDIUM",
      });
    }

    for (const [index, audience] of extractAudienceSignals(copyTexts).entries()) {
      const evidenceKey = addEvidence(
        draft,
        source.id,
        `audience:${index}:${audience.segment}`,
        audience.segment,
      );
      draft.audienceSignals.push({
        key: canonicalEntityKey("AUDIENCE_SIGNAL", audience.segment),
        segment: audience.segment,
        description: null,
        kind: audience.kind,
        confidence: "MEDIUM",
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
        confidence: "MEDIUM",
      });
    }

    const brandSignals: { kind: string; label: string; value: string }[] = [];
    if (siteName) brandSignals.push({ kind: "BRAND_NAME", label: "Site name", value: siteName });
    else if (document.title) brandSignals.push({ kind: "BRAND_NAME", label: "Page title", value: document.title });
    if (metaDescription) {
      brandSignals.push({ kind: "TAGLINE", label: "Meta description", value: truncate(metaDescription, 300) });
    }
    for (const color of document.colors.slice(0, 6)) {
      brandSignals.push({ kind: "COLOR", label: "Palette color", value: color });
    }
    for (const font of document.fonts.slice(0, 4)) {
      brandSignals.push({ kind: "FONT", label: "Font family", value: font });
    }
    const logo = document.images.find((image) =>
      /logo|wordmark|logomark/i.test(`${image.src} ${image.alt}`),
    );
    if (logo) {
      brandSignals.push({ kind: "LOGO", label: "Logo asset", value: truncate(logo.src || logo.alt, 300) });
    }

    for (const signal of brandSignals) {
      const key = canonicalEntityKey("BRAND_SIGNAL", `${signal.kind}-${signal.label}`);
      if (draft.brandSignals.some((existing) => existing.key === key)) continue;
      const evidenceKey = addEvidence(draft, source.id, `brand:${signal.kind}:${signal.label}`, signal.value);
      draft.brandSignals.push({
        key,
        kind: signal.kind as (typeof draft.brandSignals)[number]["kind"],
        label: truncate(signal.label, 200),
        value: truncate(signal.value, 300),
        confidence: "HIGH",
        assertionKind: "FACT",
        sourceIds: [source.id],
        evidenceKeys: [evidenceKey],
      });
      draft.relationships.push({
        type: "BRAND_SUPPORTED_BY_EVIDENCE",
        fromType: "BRAND_SIGNAL",
        fromKey: key,
        toType: "EVIDENCE",
        toKey: evidenceKey,
        confidence: "HIGH",
      });
    }

    // Website copy states pains, outcomes and flows in body text. Each block is
    // scoped to the heading above it, which is what lets a feature in that
    // section be linked to the problem or benefit stated next to it.
    const featureSections = new Map<string, string>();
    for (const feature of draft.features) {
      if (featureSections.has(feature.key)) continue;
      const heading = document.headings.find((entry) => entry.text === feature.name);
      if (heading) featureSections.set(feature.key, heading.text);
    }
    applyInsightExtraction(draft, {
      sourceId: source.id,
      evidenceKind: "URL_SECTION",
      confidence: "MEDIUM",
      featureSections,
      candidates: document.blocks.map((block, index) => ({
        text: block.text,
        section: block.heading,
        locator: `block:${index}:${block.kind}:${block.text.slice(0, 40)}`,
      })),
    });

    const featureNames = draft.features.map((feature) => feature.name);
    for (const [index, image] of document.images.entries()) {
      if (index >= MAX_IMAGES) break;
      if (!isMeaningfulPhrase(image.src, 1, 500) && !isMeaningfulPhrase(image.alt, 3, 300)) continue;
      const name = image.alt.length > 0 ? truncate(image.alt, 200) : `Image ${index + 1}`;
      const key = canonicalEntityKey("ASSET", name);
      if (draft.assets.some((asset) => asset.key === key)) continue;
      const mediaType = classifyAssetMediaType(image.src, image.alt, index);
      const evidenceKey = addEvidence(
        draft,
        source.id,
        `img:${index}`,
        image.alt || image.src,
      );
      draft.assets.push({
        key,
        sourceId: source.id,
        name,
        mediaType,
        role: assetRoleForMediaType(mediaType),
        storageKey: null,
        mimeType: null,
        width: image.width,
        height: image.height,
        durationMs: null,
        qualitySignals: JSON.stringify({ format: "remote", hasAlt: image.alt.length > 0 }),
        relatedFeatureKeys: [],
        relatedClaimKeys: [],
        confidence: "MEDIUM",
        assertionKind: "FACT",
        sourceIds: [source.id],
        evidenceKeys: [evidenceKey],
      });

      const matching = featureNames.find((feature) => textCoversPhrase(image.alt, feature));
      if (matching) {
        draft.assets[draft.assets.length - 1].relatedFeatureKeys = [
          canonicalEntityKey("FEATURE", matching),
        ];
        draft.relationships.push({
          type: "ASSET_REPRESENTS_FEATURE",
          fromType: "ASSET",
          fromKey: key,
          toType: "FEATURE",
          toKey: canonicalEntityKey("FEATURE", matching),
          confidence: "MEDIUM",
        });
      }
    }

    if (draft.features.length === 0) {
      notes.push("No features could be extracted from headings or list items");
    }
    return { draft, notes };
  }
}
