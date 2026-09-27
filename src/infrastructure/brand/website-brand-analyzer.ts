import { brandEvidenceKey, normalizeHexColor } from "../../lib/brand-normalization";
import type {
  BrandAnalyzerInput,
  BrandAnalyzerResult,
  BrandColorCandidate,
  BrandEvidenceDraft,
} from "../../core/ports/brand-analyzer";
import { emptyBrandAnalyzerResult } from "../../core/ports/brand-analyzer";
import { CTA_TERMS, VOICE_SIGNAL_LEXICON } from "./brand-lexicon";
import type { Source } from "../../core/domain/source";
import type { EvidenceKind } from "../../core/domain/intelligence";

const META_DESCRIPTION_LIMIT = 400;
const TERM_LIMIT = 8;
const COLOR_LIMIT = 12;
const FONT_LIMIT = 6;
const GUIDELINE_LIMIT = 6;

const CTA_LOCATIONS = [
  "header",
  "hero",
  "cta",
  "button",
  "banner",
  "nav",
  "footer",
  "main",
  "section",
  "div",
  "a",
  "p",
  "span",
  "h1",
  "h2",
  "h3",
  "li",
  "strong",
  "em",
];

const BRAND_HINT =
  /\b(?:brand|identity|style guide|styleguide|guidelines?|voice|tone|typography|palette|colours?|colors?|logo|mascot|personality|positioning|tagline|we are|our mission|about us|designed by|design system|do not|don't|never use|avoid|we believe|our story)\b/i;

const IDENTITY_CLASS =
  /\b(?:logo|wordmark|brandmark|site-?logo|brand-?logo|header-?logo|navbar-?logo|footer-?logo)\b/i;

const LOGO_HINT =
  /\b(?:logo|wordmark|brandmark|brand-?logo|site-?logo|header-?logo|navbar-?logo|footer-?logo)\b/i;

const SKIP_TAG = /^(?:script|style|noscript|template|svg|head)$/i;

const VOICE_TONE_RULES: { kind: string; test: RegExp }[] = [
  { kind: "TONE", test: /\b(?:confident|assertive|bold|decisive|unapologetic|authoritative|commanding)\b/i },
  { kind: "TONE", test: /\b(?:friendly|warm|welcoming|approachable|caring|human|empathetic)\b/i },
  { kind: "TONE", test: /\b(?:playful|witty|humorous|quirky|humourous|cheeky|clever)\b/i },
  { kind: "TONE", test: /\b(?:professional|formal|polished|credible|trustworthy|reliable|enterprise)\b/i },
  { kind: "TONE", test: /\b(?:technical|engineer|precise|rigorous|detailed|developer|dev-?focused)\b/i },
  { kind: "TONE", test: /\b(?:minimal|concise|direct|plain|to the point|efficient)\b/i },
  { kind: "TONE", test: /\b(?:innovative|forward|visionary|cutting edge|modern|next gen|future)\b/i },
  { kind: "TONE", test: /\b(?:calm|clear|steady|thoughtful|measured)\b/i },
];

const VOICE_PRONOUN_RULES: { kind: string; test: RegExp }[] = [
  { kind: "PRONOUN", test: /\b(?:we|our|us)\b/i },
  { kind: "PRONOUN", test: /\b(?:you|your|yours)\b/i },
];

const IDENTITY_HINT =
  /\b(?:we build|we make|we create|we help|our mission|our vision|we are|we're|our platform|introducing|welcome to|built for|designed for|trusted by|used by|for teams who|helps?)\b/i;

const LOCATION_TOKEN = /data-[\w-]*(?:section|placement|position|context|slot)["'\s:=]+([\w-]+)/i;

export class WebsiteBrandAnalyzer {
  readonly id = "brand-website";

  supports(input: BrandAnalyzerInput): boolean {
    if (input.source?.type !== "WEBSITE" && input.source?.type !== "WEB_APP") return false;
    return input.html !== null;
  }

  async analyze(input: BrandAnalyzerInput): Promise<BrandAnalyzerResult> {
    const result = emptyBrandAnalyzerResult();
    const source = input.source;
    const html = input.html;
    if (!source || !html) return result;

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

    const title = this.extractTitle(html);
    if (title) {
      const key = addEvidence("URL_SECTION", "html:title", title);
      result.text.push({
        field: "name",
        value: title,
        confidence: "HIGH",
        origin: "EXTRACTED",
        basis: "GENERAL_EXTRACTION",
        evidenceKeys: [key],
      });
    }

    const siteName = this.extractMetaContent(html, /(?:property|name)\s*=\s*["']og:site_name["']/i);
    if (siteName && siteName !== title) {
      const key = addEvidence("EXTRACTED_METADATA", "html:meta:og:site_name", siteName);
      result.text.push({
        field: "name",
        value: siteName,
        confidence: "MEDIUM",
        origin: "EXTRACTED",
        basis: "RECOGNIZED_ASSET",
        evidenceKeys: [key],
      });
    }

    const description = this.extractMetaContent(
      html,
      /(?:property|name)\s*=\s*["'](?:og:description|description|twitter:description)["']/i,
    );
    if (description) {
      const key = addEvidence("EXTRACTED_METADATA", "html:meta:description", description);
      result.text.push({
        field: "positioning",
        value: this.sentence(description),
        confidence: "MEDIUM",
        origin: "EXTRACTED",
        basis: "GENERAL_EXTRACTION",
        evidenceKeys: [key],
      });
    }

    const keywords = this.extractMetaContent(
      html,
      /(?:property|name)\s*=\s*["'](?:keywords|news_keywords)["']/i,
    );
    if (keywords) {
      const key = addEvidence("EXTRACTED_METADATA", "html:meta:keywords", keywords);
      for (const term of keywords
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, TERM_LIMIT)) {
        result.terms.push({
          term,
          category: "INDUSTRY_TERM",
          preference: "PREFERRED",
          confidence: "LOW",
          origin: "EXTRACTED",
          basis: "GENERAL_EXTRACTION",
          evidenceKeys: [key],
        });
      }
    }

    const visibleText = this.extractVisibleText(html);
    const layoutText = this.extractLayoutText(html);

    if (visibleText) {
      const key = addEvidence(
        "SOURCE_FRAGMENT",
        "html:visible-text",
        visibleText.slice(0, 2_000),
      );
      this.extractGuidelineLines(visibleText, key, result, sourceId, addEvidence);
      this.extractVoiceSignals(`${title ?? ""} ${description ?? ""} ${visibleText}`, key, result);
      this.extractTermsFromText(visibleText, key, result);
      this.extractCtaTerms(layoutText, key, result);
      this.extractIdentity(visibleText, key, result);
    }

    this.extractColors(html, addEvidence, result);
    this.extractFonts(html, addEvidence, result);
    this.extractLogoCue(html, addEvidence, result, source);

    result.evidence = [...evidence.values()];
    result.notes.push(`website analyzer read ${layoutText.length} text nodes`);
    return result;
  }

  private extractTitle(html: string): string | null {
    const match = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(html);
    if (!match) return null;
    const value = this.decode(match[1]).replace(/\s+/g, " ").trim();
    if (!value || value.length > 120) return null;
    return value;
  }

  private extractMetaContent(html: string, pattern: RegExp): string | null {
    const metaPattern = new RegExp(
      `<meta[^>]*${pattern.source}[^>]*>`,
      "i",
    );
    const tag = metaPattern.exec(html)?.[0];
    if (!tag) return null;
    const content = /content\s*=\s*["']([^"']{1,1000})["']/i.exec(tag)?.[1];
    if (!content) return null;
    const value = this.decode(content).replace(/\s+/g, " ").trim();
    if (!value) return null;
    return value.slice(0, 1_200);
  }

  private extractVisibleText(html: string): string {
    const stripped = html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, "\n");
    return this.decode(stripped)
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  }

  private extractLayoutText(html: string): string[] {
    const lines: string[] = [];
    const pattern = /<([a-z][a-z0-9]*)\b([^>]*)>([^<]{1,300})/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      const tag = match[1].toLowerCase();
      if (SKIP_TAG.test(tag)) continue;
      const attributes = match[2] ?? "";
      const text = this.decode(match[3] ?? "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const classes = `${attributes} ${LOCATION_TOKEN.exec(attributes)?.[1] ?? ""}`;
      if (!CTA_LOCATIONS.includes(tag) && !BRAND_HINT.test(classes) && !BRAND_HINT.test(text)) {
        continue;
      }
      lines.push(text.slice(0, 240));
      if (lines.length >= 400) break;
    }
    return lines;
  }

  private extractColors(
    html: string,
    addEvidence: (kind: EvidenceKind, locator: string, excerpt: string, metadata?: Record<string, unknown> | null) => string,
    result: BrandAnalyzerResult,
  ): void {
    const seen = new Set<string>();
    const styleBlocks = [
      ...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi),
    ].map((match) => match[1] ?? "");

    const variablePattern =
      /--[\w-]*(?:brand|primary|secondary|accent|color|colour|bg|background|surface|text|muted|border|success|warning|danger)[\w-]*\s*:\s*([^;{}]{1,80})/gi;
    for (const block of styleBlocks) {
      let match: RegExpExecArray | null;
      while ((match = variablePattern.exec(block))) {
        const variable = (match[0].split(":")[0] ?? "").trim();
        const hex = normalizeHexColor(match[1] ?? "");
        if (!hex || seen.has(hex)) continue;
        seen.add(hex);
        const locator = `html:css-var:${variable}`;
        const key = addEvidence("SOURCE_FRAGMENT", locator, `${variable}: ${match[1].trim()}`, {
          variable,
          value: hex,
        });
        result.colors.push({
          role: this.roleForVariable(variable),
          name: this.nameForVariable(variable),
          hex,
          confidence: "HIGH",
          origin: "EXTRACTED",
          basis: "DESIGN_TOKEN",
          evidenceKeys: [key],
          notes: `Declared as ${variable}`,
        });
        if (result.colors.length >= COLOR_LIMIT) return;
      }
    }

    const hexPattern = /#[0-9a-fA-F]{6}\b/g;
    for (const block of styleBlocks) {
      let match: RegExpExecArray | null;
      while ((match = hexPattern.exec(block))) {
        const hex = normalizeHexColor(match[0]);
        if (!hex || seen.has(hex)) continue;
        if (this.isLowInformation(hex)) continue;
        seen.add(hex);
        const key = addEvidence("SOURCE_FRAGMENT", `html:css-color:${hex}`, `${hex}`);
        result.colors.push({
          role: this.roleForFrequency(hex),
          name: `Brand color ${hex}`,
          hex,
          confidence: "LOW",
          origin: "EXTRACTED",
          basis: "GENERAL_EXTRACTION",
          evidenceKeys: [key],
          notes: "Observed in stylesheet",
        });
        if (result.colors.length >= COLOR_LIMIT) return;
      }
    }

    for (const match of html.matchAll(
      /<(?:meta|link)[^>]*(?:name|property|rel)\s*=\s*["'](?:theme-color|msapplication-TileColor)["'][^>]*>/gi,
    )) {
      const content = /content\s*=\s*["'](#[0-9a-fA-F]{3,8})["']/i.exec(match[0])?.[1];
      const hex = content ? normalizeHexColor(content) : null;
      if (!hex || seen.has(hex)) continue;
      seen.add(hex);
      const key = addEvidence("EXTRACTED_METADATA", `html:meta:${hex}`, `theme-color ${hex}`);
      result.colors.push({
        role: "PRIMARY",
        name: "Theme color",
        hex,
        confidence: "MEDIUM",
        origin: "EXTRACTED",
        basis: "RECOGNIZED_ASSET",
        evidenceKeys: [key],
        notes: "Declared as theme-color",
      });
    }
  }

  private isLowInformation(hex: string): boolean {
    if (hex === "#000000" || hex === "#ffffff") return true;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return Math.max(r, g, b) - Math.min(r, g, b) < 12;
  }

  private extractFonts(
    html: string,
    addEvidence: (kind: EvidenceKind, locator: string, excerpt: string, metadata?: Record<string, unknown> | null) => string,
    result: BrandAnalyzerResult,
  ): void {
    const byFamily = new Map<string, BrandAnalyzerResult["fonts"][number]>();
    const styleBlocks = [
      ...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi),
    ].map((match) => match[1] ?? "");
    const blocks = [...styleBlocks, html];

    const declaredPattern = /font-family\s*:\s*([^;}]{1,160})/gi;
    const weightPattern = /font-weight\s*:\s*(\d{3}|bold|normal|lighter|bolder)/i;

    for (const block of blocks) {
      let match: RegExpExecArray | null;
      while ((match = declaredPattern.exec(block))) {
        const families = (match[1] ?? "")
          .split(",")
          .map((family) => family.replace(/["']/g, "").replace(/\s+/g, " ").trim())
          .filter(Boolean);
        const first = families.find((family) => !this.isGenericFont(family)) ?? families[0];
        if (!first) continue;
        const canonical = first.toLowerCase();
        if (byFamily.has(canonical)) continue;
        const tail = block.slice(match.index + match[0].length, match.index + match[0].length + 200);
        const weight = weightPattern.exec(`${match[0]}${tail}`)?.[1] ?? null;
        const locator = `html:font-family:${canonical}`;
        const key = addEvidence("SOURCE_FRAGMENT", locator, `font-family: ${families.join(", ")}`, {
          family: first,
          weight,
        });
        const entry: BrandAnalyzerResult["fonts"][number] = {
          role: this.roleForFont(block, match.index),
          family: first,
          weight,
          style: null,
          sourceUrl: this.fontSourceUrl(block),
          confidence: "MEDIUM",
          origin: "EXTRACTED",
          basis: "DESIGN_TOKEN",
          evidenceKeys: [key],
          notes: "Declared in font-family",
        };
        byFamily.set(canonical, entry);
        result.fonts.push(entry);
        if (result.fonts.length >= FONT_LIMIT) return;
      }
    }

    const preloadPattern =
      /<link[^>]*rel\s*=\s*["']preload["'][^>]*as\s*=\s*["']font["'][^>]*>/gi;
    for (const match of html.matchAll(preloadPattern)) {
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(match[0])?.[1];
      if (!href) continue;
      const family = this.familyFromFontUrl(href);
      if (!family) continue;
      const key = addEvidence("EXTRACTED_METADATA", `html:preload-font:${href}`, href);
      const known = byFamily.get(family.toLowerCase());
      if (known) {
        known.sourceUrl = known.sourceUrl ?? href;
        known.evidenceKeys = [...new Set([...known.evidenceKeys, key])];
        continue;
      }
      const entry: BrandAnalyzerResult["fonts"][number] = {
        role: "BODY",
        family,
        weight: null,
        style: null,
        sourceUrl: href,
        confidence: "LOW",
        origin: "EXTRACTED",
        basis: "RECOGNIZED_ASSET",
        evidenceKeys: [key],
        notes: "Preloaded font asset",
      };
      byFamily.set(family.toLowerCase(), entry);
      result.fonts.push(entry);
    }
  }

  private isGenericFont(family: string): boolean {
    return GENERIC_FONTS.has(family.toLowerCase());
  }

  private familyFromFontUrl(href: string): string | null {
    const file = /([^/?#]+)\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i.exec(href)?.[1];
    if (!file) return null;
    return file
      .replace(/[-_]+/g, " ")
      .replace(/\d{2,}$/, "")
      .replace(/\b(v\d+|var|variable|web|regular|bold|italic|medium|semibold|light|black|thin)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim() || null;
  }

  private fontSourceUrl(block: string): string | null {
    return /url\(\s*["']?(https?:[^)"']+\.(?:woff2?|ttf|otf))["']?\s*\)/i.exec(block)?.[1] ?? null;
  }

  private roleForFont(block: string, index: number): "HEADING" | "BODY" {
    const before = block.slice(0, index);
    const open = before.lastIndexOf("{");
    const close = before.lastIndexOf("}");
    const selector = before.slice(close + 1, open + 1);
    return /\b(?:h1|h2|h3|heading|title|headline|display|hero|logo|caption)\b/i.test(selector)
      ? "HEADING"
      : "BODY";
  }

  private extractLogoCue(
    html: string,
    addEvidence: (kind: EvidenceKind, locator: string, excerpt: string, metadata?: Record<string, unknown> | null) => string,
    result: BrandAnalyzerResult,
    source: Source,
  ): void {
    const ogImage = this.extractMetaContent(html, /(?:property|name)\s*=\s*["']og:image["']/i);
    if (ogImage && LOGO_HINT.test(html.slice(0, Math.max(0, html.indexOf(ogImage)) + ogImage.length + 200))) {
      const key = addEvidence("EXTRACTED_METADATA", "html:meta:og:image", ogImage);
      result.notes.push(
        `og:image ${ogImage} looks logo-like; confirm with an uploaded logo asset before trusting it as a brand asset`,
      );
      void key;
    }

    const favicon = /<link[^>]*rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/i.exec(html)?.[0];
    if (favicon) {
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(favicon)?.[1] ?? null;
      const key = addEvidence(
        "EXTRACTED_METADATA",
        `html:favicon:${href ?? "unknown"}`,
        `favicon ${href ?? "unknown"}`,
        { href, sourceId: source.id },
      );
      result.notes.push(
        "Favicon detected; it is recorded as evidence and can be promoted to a brand asset only through the project asset library",
      );
      void key;
    }

    const logoImage = /<img\b[^>]*>/gi;
    for (const match of html.matchAll(logoImage)) {
      const tag = match[0];
      const src = /src\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? null;
      const alt = /alt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? null;
      const identitySignal =
        IDENTITY_CLASS.test(tag) ||
        (alt !== null && LOGO_HINT.test(alt)) ||
        (src !== null && LOGO_HINT.test(src));
      if (!identitySignal) continue;
      const key = addEvidence(
        "IMAGE_REGION",
        `html:img:${src ?? "unknown"}`,
        `img src=${src ?? "unknown"} alt=${alt ?? ""}`,
        { src, alt, assetId: null },
      );
      result.notes.push(
        `Website references a logo-like image (${src ?? "unknown"}); the deterministic analyzer does not attach remote images, import it as a project asset to include it`,
      );
      void key;
    }
  }

  private extractGuidelineLines(
    text: string,
    textKey: string,
    result: BrandAnalyzerResult,
    sourceId: string,
    addEvidence: (kind: EvidenceKind, locator: string, excerpt: string, metadata?: Record<string, unknown> | null) => string,
  ): void {
    const lines = text.split("\n");
    for (let index = 0; index < lines.length && result.guidelines.length < GUIDELINE_LIMIT; index += 1) {
      const line = lines[index] ?? "";
      const prefix = /^(brand|voice|tone|style|typography|color|colour|logo|positioning|tagline|mission|values?|guidelines?|do not|don't|never|avoid|always|use)\b\s*[:\-–]\s*(.+)$/i.exec(line);
      if (!prefix) continue;
      const keyword = prefix[1] ?? "";
      const detail = (prefix[2] ?? "").trim();
      if (detail.length < 4) continue;
      const basis = /^explicit\b|guideline|voice|tone|typography|palette/i.test(keyword)
        ? "EXPLICIT_GUIDELINE"
        : "GENERAL_EXTRACTION";
      const key = addEvidence("SOURCE_FRAGMENT", `text:line:${index + 1}`, line.slice(0, 400), {
        sourceId,
      });
      result.guidelines.push({
        title: keyword.charAt(0).toUpperCase() + keyword.slice(1).toLowerCase(),
        detail: detail.slice(0, 400),
        origin: "EXTRACTED",
        basis,
        evidenceKeys: [key, textKey],
      });
    }
  }

  private extractVoiceSignals(
    text: string,
    key: string,
    result: BrandAnalyzerResult,
  ): void {
    const seen = new Set<string>();
    for (const rule of VOICE_TONE_RULES) {
      if (!rule.test.test(text)) continue;
      const kind = rule.kind;
      if (seen.has(kind)) continue;
      seen.add(kind);
      result.voiceSignals.push({
        kind,
        value: this.labelForVoiceRule(rule),
        confidence: "MEDIUM",
        origin: "EXTRACTED",
        basis: "GENERAL_EXTRACTION",
        evidenceKeys: [key],
      });
    }
    for (const rule of VOICE_PRONOUN_RULES) {
      if (!rule.test.test(text)) continue;
      if (seen.has(rule.kind)) continue;
      seen.add(rule.kind);
      result.voiceSignals.push({
        kind: rule.kind,
        value: rule.kind === "PRONOUN" ? "first-person plural" : "second person",
        confidence: "MEDIUM",
        origin: "EXTRACTED",
        basis: "GENERAL_EXTRACTION",
        evidenceKeys: [key],
      });
    }
  }

  private labelForVoiceRule(rule: { kind: string; test: RegExp }): string {
    const source = rule.test.source;
    const first = /^\(\?:([a-z\-]+)/.exec(source)?.[1] ?? source;
    return first.split("|")[0] ?? source;
  }

  private extractTermsFromText(
    text: string,
    key: string,
    result: BrandAnalyzerResult,
  ): void {
    const seen = new Set<string>();
    for (const entry of VOICE_SIGNAL_LEXICON.terms) {
      if (seen.size >= TERM_LIMIT) break;
      if (!entry.pattern.test(text)) continue;
      if (seen.has(entry.term)) continue;
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
      if (seen.size >= TERM_LIMIT + 4) break;
      if (!entry.pattern.test(text)) continue;
      if (seen.has(entry.term)) continue;
      seen.add(entry.term);
      result.terms.push({
        term: entry.term,
        category: "INDUSTRY_TERM",
        preference: "AVOID",
        confidence: entry.explicit ? "MEDIUM" : "LOW",
        origin: "EXTRACTED",
        basis: entry.explicit ? "EXPLICIT_GUIDELINE" : "GENERAL_EXTRACTION",
        evidenceKeys: [key],
      });
    }
  }

  private extractCtaTerms(
    layoutText: readonly string[],
    key: string,
    result: BrandAnalyzerResult,
  ): void {
    const haystack = layoutText.join(" \n ");
    for (const entry of CTA_TERMS) {
      if (result.terms.length >= TERM_LIMIT + 4) break;
      if (!entry.pattern.test(haystack)) continue;
      if (result.terms.some((term) => term.term.toLowerCase() === entry.term.toLowerCase())) {
        continue;
      }
      result.terms.push({
        term: entry.term,
        category: "CALL_TO_ACTION",
        preference: "PREFERRED",
        confidence: entry.generic ? "LOW" : "MEDIUM",
        origin: "EXTRACTED",
        basis: "GENERAL_EXTRACTION",
        evidenceKeys: [key],
        notes: "Observed in a link, button or call to action",
      });
    }
  }

  private extractIdentity(
    text: string,
    key: string,
    result: BrandAnalyzerResult,
  ): void {
    const sentence = this.identitySentence(text);
    if (!sentence) return;
    if (result.text.some((candidate) => candidate.field === "positioning")) return;
    result.text.push({
      field: "positioning",
      value: sentence,
      confidence: "LOW",
      origin: "EXTRACTED",
      basis: "GENERAL_EXTRACTION",
      evidenceKeys: [key],
    });
  }

  private identitySentence(text: string): string | null {
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!IDENTITY_HINT.test(line)) continue;
      if (line.length < 24 || line.length > 400) continue;
      return this.sentence(line);
    }
    return null;
  }

  private sentence(value: string): string {
    const cleaned = value.replace(/\s+/g, " ").trim();
    if (cleaned.length <= META_DESCRIPTION_LIMIT) {
      return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
    }
    return `${cleaned.slice(0, META_DESCRIPTION_LIMIT - 1).trimEnd()}…`;
  }

  private roleForVariable(variable: string): BrandColorCandidate["role"] {
    const name = variable.toLowerCase();
    if (/(^|-)primary/.test(name)) return "PRIMARY";
    if (/(^|-)secondary/.test(name)) return "SECONDARY";
    if (/(^|-)accent/.test(name)) return "ACCENT";
    if (/background|bg-/.test(name)) return "BACKGROUND";
    if (/surface|card|panel/.test(name)) return "SURFACE";
    if (/(^|-)text|foreground|fg-/.test(name)) return "TEXT";
    if (/muted/.test(name)) return "MUTED";
    if (/border|outline/.test(name)) return "BORDER";
    if (/success|positive/.test(name)) return "SUCCESS";
    if (/warning|caution/.test(name)) return "WARNING";
    if (/danger|error|critical|negative/.test(name)) return "DANGER";
    if (/neutral|gray|grey/.test(name)) return "NEUTRAL";
    return "PRIMARY";
  }

  private nameForVariable(variable: string): string {
    const cleaned = variable.replace(/^--/, "").replace(/[-_]/g, " ").trim();
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  private roleForFrequency(hex: string): BrandColorCandidate["role"] {
    return hex === "#ffffff" ? "SURFACE" : "PRIMARY";
  }

  private decode(value: string): string {
    return value
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));
  }
}

const GENERIC_FONTS = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "-apple-system",
  "blinkmacsystemfont",
  "inherit",
  "initial",
  "unset",
  "revert",
  "none",
]);
