import { brandEvidenceKey, normalizeHexColor, normalizeFontFamily } from "../../lib/brand-normalization";
import type { BrandColorRole, BrandFontRole } from "../../core/domain/brand";
import type {
  BrandAnalyzerInput,
  BrandAnalyzerResult,
  BrandEvidenceDraft,
} from "../../core/ports/brand-analyzer";
import { emptyBrandAnalyzerResult } from "../../core/ports/brand-analyzer";
import { inspectRepositorySource } from "../analysis/archive-reader";
import { decodeUtf8, truncate } from "../analysis/text";
import type { Source } from "../../core/domain/source";

const REPO_TYPES: Source["type"][] = ["GITHUB", "GITLAB", "LOCAL_PROJECT", "ZIP"];

const MAX_FILES = 60;
const MAX_EXCERPT = 1_200;

const BRAND_HINT =
  /\b(?:brand|identity|style ?guide|voice|tone|typography|palette|logo|positioning|tagline|guidelines?|design system)\b/i;

const PALETTE_ASSIGNMENT =
  /--[\w-]*(?:primary|secondary|accent|background|surface|text|muted|border|success|warning|danger)[\w-]*\s*:\s*(#[0-9a-fA-F]{6})\b/gi;

const FONT_ASSIGNMENT = /font-family\s*:\s*([^;}]{1,160})/gi;

const GENERIC_FONTS = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "inherit",
  "initial",
  "unset",
  "none",
  "-apple-system",
  "blinkmacsystemfont",
]);

export class RepositoryBrandAnalyzer {
  readonly id = "brand-repository";

  supports(input: BrandAnalyzerInput): boolean {
    if (!input.source) return false;
    return REPO_TYPES.includes(input.source.type);
  }

  async analyze(input: BrandAnalyzerInput): Promise<BrandAnalyzerResult> {
    const result = emptyBrandAnalyzerResult();
    const source = input.source;
    if (!source) return result;

    const sourceId = source.id;
    const evidence = new Map<string, BrandEvidenceDraft>();
    const addEvidence = (locator: string, excerpt: string) => {
      const key = brandEvidenceKey(sourceId, "REPOSITORY_FILE", locator);
      if (!evidence.has(key)) {
        evidence.set(key, {
          key,
          sourceId,
          kind: "REPOSITORY_FILE",
          locator,
          excerpt,
          metadata: null,
        });
      }
      return key;
    };

    const files = await this.readFiles(input);
    if (files.length === 0) {
      result.notes.push("Repository snapshot has no readable text files");
      return result;
    }

    const seenColors = new Set<string>();
    const seenFonts = new Set<string>();
    let scanned = 0;

    for (const file of files) {
      if (scanned >= MAX_FILES) break;
      const styleFile = /\.(?:css|scss|less|html?|svg)$/i.test(file.path);
      if (!styleFile && !BRAND_HINT.test(file.path) && !BRAND_HINT.test(file.text)) {
        continue;
      }
      scanned += 1;

      const key = addEvidence(`file:${file.path}`, truncate(file.text.replace(/\s+/g, " "), MAX_EXCERPT));
      if (BRAND_HINT.test(file.text)) {
        result.notes.push(`${file.path} mentions brand guidance`);
      }

      for (const match of file.text.matchAll(PALETTE_ASSIGNMENT)) {
        if (result.colors.length >= 8) break;
        const hex = normalizeHexColor(match[1] ?? "");
        const variable = (match[0].split(":")[0] ?? "").trim();
        if (!hex || seenColors.has(hex)) continue;
        seenColors.add(hex);
        result.colors.push({
          role: this.roleForVariable(variable),
          name: variable.replace(/^--/, "").replace(/[-_]/g, " "),
          hex,
          confidence: "HIGH",
          origin: "EXTRACTED",
          basis: "DESIGN_TOKEN",
          evidenceKeys: [key],
          notes: `Declared as ${variable} in ${file.path}`,
        });
      }

      for (const match of file.text.matchAll(FONT_ASSIGNMENT)) {
        if (result.fonts.length >= 6) break;
        const family = (match[1] ?? "")
          .split(",")
          .map((value) => normalizeFontFamily(value))
          .find((value) => value && !GENERIC_FONTS.has(value.toLowerCase()));
        if (!family) continue;
        const canonical = family.toLowerCase();
        if (seenFonts.has(canonical)) continue;
        seenFonts.add(canonical);
        result.fonts.push({
          role: this.roleForFile(file.path),
          family,
          weight: null,
          style: null,
          sourceUrl: null,
          confidence: "MEDIUM",
          origin: "EXTRACTED",
          basis: "DESIGN_TOKEN",
          evidenceKeys: [key],
          notes: `Declared in ${file.path}`,
        });
      }
    }

    result.evidence = [...evidence.values()];
    result.notes.push(`repository analyzer scanned ${scanned} of ${files.length} files`);
    return result;
  }

  private async readFiles(
    input: BrandAnalyzerInput,
  ): Promise<{ path: string; text: string }[]> {
    if (input.text && input.text.length > 0) {
      return [{ path: input.source?.name ?? "source.txt", text: input.text }];
    }
    const bytes = input.bytes;
    if (!bytes || bytes.length === 0) return [];
    if (
      input.source?.type === "ZIP" ||
      input.source?.type === "LOCAL_PROJECT" ||
      input.source?.type === "GITHUB" ||
      input.source?.type === "GITLAB"
    ) {
      const inspection = await inspectRepositorySource(bytes, input.source?.mimeType ?? null);
      return inspection.files.slice(0, MAX_FILES).map((file) => ({
        path: file.path,
        text: file.text,
      }));
    }
    return [{ path: input.source?.name ?? "source", text: decodeUtf8(bytes.subarray(0, 200_000)) }];
  }

  private roleForVariable(variable: string): BrandColorRole {
    const name = variable.toLowerCase();
    if (/(^|-)primary/.test(name)) return "PRIMARY";
    if (/(^|-)secondary/.test(name)) return "SECONDARY";
    if (/(^|-)accent/.test(name)) return "ACCENT";
    if (/background|bg-/.test(name)) return "BACKGROUND";
    if (/surface|card|panel/.test(name)) return "SURFACE";
    if (/(^|-)text|foreground/.test(name)) return "TEXT";
    if (/muted/.test(name)) return "MUTED";
    if (/border|outline/.test(name)) return "BORDER";
    if (/success|positive/.test(name)) return "SUCCESS";
    if (/warning|caution/.test(name)) return "WARNING";
    if (/danger|error|critical/.test(name)) return "DANGER";
    return "NEUTRAL";
  }

  private roleForFile(path: string): BrandFontRole {
    return /heading|header|title|display|hero/i.test(path) ? "HEADING" : "BODY";
  }
}
