import { brandEvidenceKey, normalizeHexColor, normalizeFontFamily, normalizeTerm } from "../../lib/brand-normalization";
import type {
  BrandAnalyzerInput,
  BrandAnalyzerResult,
  BrandEvidenceDraft,
} from "../../core/ports/brand-analyzer";
import { emptyBrandAnalyzerResult } from "../../core/ports/brand-analyzer";
import {
  AVOID_LANGUAGE,
  COLOR_ROLE_KEYWORDS,
  CTA_TERMS,
  FONT_ROLE_KEYWORDS,
  GUIDELINE_PATTERNS,
  HEX_IN_TEXT,
  VOICE_PERSPECTIVE_RULES,
  VOICE_PRONOUN_RULES,
  VOICE_SIGNAL_LEXICON,
  VOICE_TONE_RULES,
} from "./brand-lexicon";
import { extractPdfText } from "../analysis/pdf";
import { collapseWhitespace, decodeUtf8, truncate } from "../analysis/text";
import type { Source } from "../../core/domain/source";
import type { EvidenceKind } from "../../core/domain/intelligence";
import type { BrandTextField } from "../../core/domain/brand";

const MAX_BYTES = 4_000_000;
const MAX_GUIDELINES = 8;
const MAX_TERMS = 10;
const MAX_COLORS = 8;
const MAX_FONTS = 6;
const EXCERPT_LIMIT = 1_500;
const TEXT_TYPES: Source["type"][] = ["TEXT", "DOCUMENT", "PDF", "OTHER"];

export class TextBrandAnalyzer {
  readonly id = "brand-text";

  supports(input: BrandAnalyzerInput): boolean {
    if (!input.source) return false;
    if (!TEXT_TYPES.includes(input.source.type)) return false;
    return Boolean(input.text) || Boolean(input.bytes);
  }

  async analyze(input: BrandAnalyzerInput): Promise<BrandAnalyzerResult> {
    const result = emptyBrandAnalyzerResult();
    const source = input.source;
    if (!source) return result;

    const text = this.readText(input);
    if (!text) {
      result.notes.push(`No readable brand text in source ${source.id}`);
      return result;
    }

    const sourceId = source.id;
    const evidence = new Map<string, BrandEvidenceDraft>();
    const addEvidence = (
      kind: EvidenceKind,
      locator: string,
      excerpt: string,
      metadata: Record<string, unknown> | null = null,
    ) => {
      const key = brandEvidenceKey(sourceId, kind, locator);
      if (!evidence.has(key)) {
        evidence.set(key, { key, sourceId, kind, locator, excerpt, metadata });
      }
      return key;
    };

    const fullKey = addEvidence(
      "DOCUMENT_SECTION",
      "text:full",
      truncate(text.replace(/\s+/g, " "), EXCERPT_LIMIT),
      { characters: text.length },
    );

    this.extractGuidelines(text, addEvidence, result, fullKey);
    this.extractVoice(text, fullKey, result);
    this.extractTerms(text, fullKey, result);
    this.extractColors(text, addEvidence, result, fullKey);
    this.extractFonts(text, addEvidence, result, fullKey);
    this.extractIdentity(text, addEvidence, result, fullKey);

    result.evidence = [...evidence.values()];
    return result;
  }

  private readText(input: BrandAnalyzerInput): string | null {
    if (input.text) return input.text;
    const bytes = input.bytes;
    if (!bytes || bytes.length === 0) return null;
    const slice = bytes.length > MAX_BYTES ? bytes.subarray(0, MAX_BYTES) : bytes;
    const isPdf =
      input.source?.type === "PDF" || input.source?.mimeType === "application/pdf";
    if (isPdf) {
      const extraction = extractPdfText(slice);
      return extraction.text.length > 0 ? extraction.text : null;
    }
    return decodeUtf8(slice);
  }

  private extractGuidelines(
    text: string,
    addEvidence: (kind: EvidenceKind, locator: string, excerpt: string, metadata?: Record<string, unknown> | null) => string,
    result: BrandAnalyzerResult,
    fullKey: string,
  ): void {
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length && result.guidelines.length < MAX_GUIDELINES; index += 1) {
      const line = lines[index]?.trim() ?? "";
      if (line.length < 8 || line.length > 300) continue;
      for (const pattern of GUIDELINE_PATTERNS) {
        const match = pattern.re.exec(line);
        if (!match) continue;
        const detail = collapseWhitespace(match[1] ?? "").replace(/[.;,]$/, "");
        if (detail.length < 6) continue;
        const key = addEvidence("DOCUMENT_SECTION", `text:guideline:${index + 1}`, line, {
          line: index + 1,
        });
        result.guidelines.push({
          title: pattern.title,
          detail: truncate(detail, 300),
          origin: "EXTRACTED",
          basis: "EXPLICIT_GUIDELINE",
          evidenceKeys: [key, fullKey],
        });
        if (pattern.avoid) {
          result.terms.push({
            term: this.avoidTermFrom(detail),
            category: "INDUSTRY_TERM",
            preference: "AVOID",
            confidence: "MEDIUM",
            origin: "EXTRACTED",
            basis: "EXPLICIT_GUIDELINE",
            evidenceKeys: [key, fullKey],
          });
        }
        break;
      }
    }
  }

  private avoidTermFrom(detail: string): string {
    const quoted = /["“']([^"”']{3,40})["”']/.exec(detail)?.[1];
    if (quoted) return normalizeTerm(quoted);
    const head = detail.split(/\s+/).slice(0, 3).join(" ");
    return normalizeTerm(head.replace(/[.,;:]$/, ""));
  }

  private extractVoice(text: string, key: string, result: BrandAnalyzerResult): void {
    const rules = [
      ...VOICE_TONE_RULES,
      ...VOICE_PRONOUN_RULES,
      ...VOICE_PERSPECTIVE_RULES,
    ];
    for (const rule of rules) {
      if (result.voiceSignals.length >= 10) break;
      if (!rule.test.test(text)) continue;
      if (result.voiceSignals.some((signal) => signal.kind === rule.kind)) continue;
      result.voiceSignals.push({
        kind: rule.kind,
        value: rule.value,
        confidence: "MEDIUM",
        origin: "EXTRACTED",
        basis: "GENERAL_EXTRACTION",
        evidenceKeys: [key],
      });
    }
  }

  private extractTerms(text: string, key: string, result: BrandAnalyzerResult): void {
    const seen = new Set<string>();
    for (const entry of CTA_TERMS) {
      if (result.terms.length >= MAX_TERMS) break;
      if (!entry.pattern.test(text) || seen.has(entry.term)) continue;
      seen.add(entry.term);
      result.terms.push({
        term: entry.term,
        category: "CALL_TO_ACTION",
        preference: "PREFERRED",
        confidence: entry.generic ? "LOW" : "MEDIUM",
        origin: "EXTRACTED",
        basis: "GENERAL_EXTRACTION",
        evidenceKeys: [key],
      });
    }
    for (const entry of VOICE_SIGNAL_LEXICON.terms) {
      if (result.terms.length >= MAX_TERMS) break;
      if (!entry.pattern.test(text) || seen.has(entry.term)) continue;
      seen.add(entry.term);
      result.terms.push({
        term: entry.term,
        category: entry.category,
        preference: "PREFERRED",
        confidence: entry.explicit ? "MEDIUM" : "LOW",
        origin: "EXTRACTED",
        basis: "GENERAL_EXTRACTION",
        evidenceKeys: [key],
      });
    }
    for (const entry of VOICE_SIGNAL_LEXICON.avoid) {
      if (result.terms.length >= MAX_TERMS + 4) break;
      if (!entry.pattern.test(text) || seen.has(entry.term)) continue;
      seen.add(entry.term);
      result.terms.push({
        term: entry.term,
        category: "INDUSTRY_TERM",
        preference: "AVOID",
        confidence: "MEDIUM",
        origin: "EXTRACTED",
        basis: entry.explicit ? "EXPLICIT_GUIDELINE" : "GENERAL_EXTRACTION",
        evidenceKeys: [key],
      });
    }
  }

  private extractColors(
    text: string,
    addEvidence: (kind: EvidenceKind, locator: string, excerpt: string, metadata?: Record<string, unknown> | null) => string,
    result: BrandAnalyzerResult,
    fullKey: string,
  ): void {
    const seen = new Set<string>();
    for (const match of text.matchAll(HEX_IN_TEXT)) {
      if (result.colors.length >= MAX_COLORS) break;
      const hex = normalizeHexColor(match[0]);
      if (!hex || seen.has(hex)) continue;
      seen.add(hex);
      const roleEntry = COLOR_ROLE_KEYWORDS.find((entry) => entry.test.test(text));
      const key = addEvidence("DOCUMENT_SECTION", `text:color:${hex}`, `${hex}`);
      result.colors.push({
        role: (roleEntry?.role as BrandAnalyzerResult["colors"][number]["role"]) ?? "PRIMARY",
        name: roleEntry
          ? `${roleEntry.role.charAt(0)}${roleEntry.role.slice(1).toLowerCase()} color`
          : `Brand color ${hex}`,
        hex,
        confidence: roleEntry ? "HIGH" : "MEDIUM",
        origin: "EXTRACTED",
        basis: roleEntry ? "EXPLICIT_GUIDELINE" : "GENERAL_EXTRACTION",
        evidenceKeys: [key, fullKey],
        notes: roleEntry
          ? `Document names it as the ${roleEntry.role.toLowerCase()} color`
          : null,
      });
    }
  }

  private extractFonts(
    text: string,
    addEvidence: (kind: EvidenceKind, locator: string, excerpt: string, metadata?: Record<string, unknown> | null) => string,
    result: BrandAnalyzerResult,
    fullKey: string,
  ): void {
    const seen = new Set<string>();
    const add = (family: string, role: string | null, weight: string | null) => {
      if (result.fonts.length >= MAX_FONTS) return;
      const normalized = normalizeFontFamily(family);
      if (!normalized || seen.has(normalized.toLowerCase())) return;
      if (GENERIC_FONT_NAMES.has(normalized.toLowerCase())) return;
      seen.add(normalized.toLowerCase());
      const key = addEvidence(
        "DOCUMENT_SECTION",
        `text:font:${normalized.toLowerCase()}`,
        `${normalized} font`,
      );
      result.fonts.push({
        role: (role as BrandAnalyzerResult["fonts"][number]["role"]) ?? "BODY",
        family: normalized,
        weight,
        style: null,
        sourceUrl: null,
        confidence: role ? "HIGH" : "MEDIUM",
        origin: "EXTRACTED",
        basis: role ? "EXPLICIT_GUIDELINE" : "GENERAL_EXTRACTION",
        evidenceKeys: [key, fullKey],
        notes: "Named as a brand font in the document",
      });
    };

    // "Heading font: Sora" states the role in the label and the family in the
    // value. Reading the whole text for the role would give every family in the
    // document the same role, so the role is taken from this match only.
    for (const line of text.split(/\r?\n/)) {
      const match = FONT_LABEL_PATTERN.exec(line);
      if (!match) continue;
      const roleEntry = FONT_ROLE_KEYWORDS.find((entry) => entry.test.test(match[1] ?? ""));
      add(match[2] ?? "", roleEntry?.role ?? null, fontWeight(line));
    }

    // "Sora is the heading font" names the family first and the role in prose.
    for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9'\-]{1,30})\s+(?:font|typeface)\b/g)) {
      const roleEntry = FONT_ROLE_KEYWORDS.find((entry) => entry.test.test(text));
      add(match[1] ?? "", roleEntry?.role ?? null, fontWeight(text));
    }
  }

  private extractIdentity(
    text: string,
    addEvidence: (kind: EvidenceKind, locator: string, excerpt: string, metadata?: Record<string, unknown> | null) => string,
    result: BrandAnalyzerResult,
    fullKey: string,
  ): void {
    for (const field of IDENTITY_FIELDS) {
      const match = new RegExp(
        `(?:^|\\n)\\s*(?:[#*\\-]+\\s*)?${field.label}\\s*[:\\-]\\s*(.{4,200})`,
        "i",
      ).exec(text);
      if (!match) continue;
      const value = truncate(collapseWhitespace(match[1] ?? "").replace(/[.;,]$/, ""), 200);
      if (value.length < 4) continue;
      if (result.text.some((candidate) => candidate.field === field.field)) continue;
      const key = addEvidence("DOCUMENT_SECTION", `text:${field.field}`, value);
      result.text.push({
        field: field.field,
        value,
        confidence: "HIGH",
        origin: "EXTRACTED",
        basis: "EXPLICIT_GUIDELINE",
        evidenceKeys: [key, fullKey],
      });
    }

    if (!result.text.some((candidate) => candidate.field === "name")) {
      const heading = documentHeading(text);
      if (heading) {
        const key = addEvidence("DOCUMENT_SECTION", "text:heading", heading);
        result.text.push({
          field: "name",
          value: heading,
          confidence: "MEDIUM",
          origin: "EXTRACTED",
          basis: "GENERAL_EXTRACTION",
          evidenceKeys: [key, fullKey],
        });
      }
    }

    if (
      !result.text.some(
        (candidate) => candidate.field === "positioning" || candidate.field === "valueProposition",
      )
    ) {
      const match = POSITIONING_PATTERN.exec(text);
      const value = match ? collapseWhitespace(match[0]).replace(/[.;,]$/, "") : null;
      if (value && value.length >= 12 && value.length <= 200) {
        const key = addEvidence("DOCUMENT_SECTION", "text:positioning", value);
        result.text.push({
          field: "positioning",
          value: truncate(value, 200),
          confidence: "MEDIUM",
          origin: "EXTRACTED",
          basis: "GENERAL_EXTRACTION",
          evidenceKeys: [key, fullKey],
        });
      }
    }

    if (AVOID_LANGUAGE.test(text)) {
      result.notes.push("Document contains explicit avoid language");
    }
  }
}

const IDENTITY_FIELDS: ReadonlyArray<{
  field: BrandTextField;
  label: string;
}> = [
  { field: "name", label: "(?:brand\\s+)?name" },
  { field: "tagline", label: "(?:tagline|tag\\s*line|slogan)" },
  { field: "positioning", label: "positioning" },
  { field: "valueProposition", label: "value\\s+proposition" },
  { field: "voiceSummary", label: "(?:voice|tone)" },
  { field: "visualStyle", label: "(?:visual\\s+style|art\\s+direction|design\\s+style)" },
];

/**
 * A document that opens with a product name is stating its brand. Only a short
 * leading line qualifies: a long first paragraph is prose, not a name, and a
 * heading that ends in a document word ("brand guidelines") is describing the
 * document rather than naming the thing it describes.
 */
function documentHeading(text: string): string | null {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0);
  if (!firstLine) return null;

  const cleaned = firstLine.replace(/^#{1,6}\s*/, "").replace(/[*_`]/g, "").trim();
  if (cleaned.length < 2 || cleaned.length > 60) return null;
  if (/[.!?,;:]$/.test(cleaned)) return null;
  if (/\s{2,}/.test(cleaned)) return null;
  if (NON_NAME_HEADINGS.test(cleaned)) return null;

  const words = cleaned.split(/\s+/);
  const letters = cleaned.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return null;
  // Rejects a heading that is really a sentence fragment of lowercase prose.
  if (words.length > 6) return null;
  if (/^(?:we|our|the|a|an|this|that|it|they)\b/i.test(cleaned)) return null;

  return cleaned;
}

const POSITIONING_PATTERN = /\b(?:[A-Z][\w&. ]{1,40}|we)\s+(?:is|are)\s+(?:the|a|an)\s+[^\n.]{10,180}/;

/**
 * "Heading font: Sora" and "Body font: Inter" name a role in the label and the
 * family in the value, so the family must start with a capital and be followed
 * by end of line rather than more words.
 */
const FONT_LABEL_PATTERN =
  /^\s*(?:([A-Za-z][A-Za-z ]{0,20}?)\s+)?(?:font|typeface)\s*(?:family)?\s*[:\-]\s*([A-Z][A-Za-z0-9'\-]{1,30})\s*$/;

function fontWeight(text: string): string | null {
  return /\b(?:bold|black|heavy|semibold|extrabold)\b/i.test(text) ? "700" : null;
}

const GENERIC_FONT_NAMES = new Set([
  "sans serif",
  "serif",
  "monospace",
  "system",
  "default",
  "body",
  "heading",
  "display",
  "this",
  "the",
  "a",
  "our",
  "base",
  "custom",
  "web",
]);

/**
 * A leading line that names the document rather than the brand. Treating
 * "Acme brand guidelines" as the brand name would put a document type into
 * every generated asset.
 */
const NON_NAME_HEADINGS =
  /\b(?:brand|content|style|voice|visual|design|marketing|media|product|editorial|logo|term|terms|usage|asset|assets)\s+(?:guidelines?|guide|style|guidebook|kit|manual|policy|policies|system|standards?|reference|playbook|deck|brief|document|notes?)\b/i;
