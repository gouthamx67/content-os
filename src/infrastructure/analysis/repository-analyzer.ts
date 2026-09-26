import type { Source } from "../../core/domain/source";
import type {
  SourceAnalysisContext,
  SourceAnalysisResult,
  SourceAnalyzer,
} from "../../core/ports/source-analyzer";
import type { IntelligenceDraft } from "../../core/domain/intelligence-draft";
import { addDraftEvidence, emptyIntelligenceDraft } from "../../core/domain/intelligence-draft";
import { canonicalEntityKey, isDuplicateEntity } from "../../core/domain/intelligence-canonical";
import { splitSentences, truncate } from "./text";
import { extractClaims, importanceForFeature, looksLikeFeatureLabel } from "./heuristics";
import { applyInsightExtraction } from "./insight-wiring";
import { inspectRepositorySource } from "./archive-reader";

const MAX_README_FEATURES = 30;
const MAX_TECH_FEATURES = 40;
const MAX_PROSE_EVIDENCE_FILES = 4;

const TECHNOLOGY_FEATURES: { pattern: RegExp; name: string; description: string; category: "AI_GENERATION" | "AUTHENTICATION" | "INTEGRATION" | "AUTOMATION" | "ANALYTICS" | "COLLABORATION" | "CONTENT_MANAGEMENT" | "EXPORT" | "DASHBOARD" }[] = [
  { pattern: /^(?:next|nuxt|remix|@remix-run\/\w+|gatsby|vite)$/, name: "Web application runtime", description: "Ships a web application runtime", category: "DASHBOARD" },
  { pattern: /^@prisma\//, name: "PostgreSQL persistence", description: "Persists project data in PostgreSQL through Prisma", category: "INTEGRATION" },
  { pattern: /^(?:pg|postgres|@vercel\/postgres|@neondatabase\/\w+)$/, name: "PostgreSQL database", description: "Uses PostgreSQL as its primary datastore", category: "INTEGRATION" },
  { pattern: /^(?:openai|@anthropic-ai\/\w+|ai|@ai-sdk\/\w+|langchain|@langchain\/\w+|ollama)$/, name: "AI model integration", description: "Integrates an AI model provider", category: "AI_GENERATION" },
  { pattern: /^(?:next-auth|@auth\/\w+|@clerk\/\w+|lucia|bcrypt|argon2)$/, name: "Authentication", description: "Implements user authentication", category: "AUTHENTICATION" },
  { pattern: /^(?:vitest|jest|mocha|playwright|@playwright\/test|cypress)$/, name: "Automated test suite", description: "Runs automated tests in the repository", category: "AUTOMATION" },
  { pattern: /^(?:yauzl|archiver|tar|jszip)$/, name: "Archive handling", description: "Reads and validates archives", category: "AUTOMATION" },
  { pattern: /^(?:tailwindcss|styled-components|@emotion\/\w+|sass)$/, name: "Design system styling", description: "Styles the interface with a design system", category: "DASHBOARD" },
  { pattern: /^(?:zod|valibot)$/, name: "Runtime input validation", description: "Validates untrusted input at runtime", category: "AUTHENTICATION" },
];

interface PackageManifest {
  name?: string;
  description?: string;
  keywords?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function parsePackageManifest(text: string): PackageManifest | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as PackageManifest;
  } catch {
    return null;
  }
}

interface ReadmeSection {
  heading: string | null;
  body: string;
}

/**
 * Markdown headings with the prose beneath them. README features come from
 * headings, and the narrative families come from the prose that sits under each
 * one, so both are read from the same structure.
 */
function readmeSections(markdown: string): ReadmeSection[] {
  const sections: ReadmeSection[] = [];
  let heading: string | null = null;
  let body: string[] = [];
  let inFence = false;

  const flush = () => {
    const joined = body.join(" ").replace(/\s+/g, " ").trim();
    if (heading !== null || joined.length > 0) sections.push({ heading, body: joined });
    body = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s{0,3}(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      body.push(line);
      continue;
    }
    const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      flush();
      heading = match[2].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim();
      continue;
    }
    body.push(line);
  }
  flush();
  return sections;
}

function readmeHeadings(markdown: string): string[] {
  return readmeSections(markdown)
    .map((section) => section.heading)
    .filter((heading): heading is string => heading !== null)
    .filter((heading) => looksLikeFeatureLabel(heading, 3, 120));
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, " ")
    .replace(/^\s*[-+*]\s+/gm, " ");
}

/** Inline markdown only, because the section structure is already resolved. */
function stripMarkdownInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>]/g, " ");
}

function addEvidence(
  draft: IntelligenceDraft,
  sourceId: string,
  kind: "REPOSITORY_FILE" | "DOCUMENT_SECTION",
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

export class RepositoryAnalyzer implements SourceAnalyzer {
  readonly id = "repository";

  supports(source: Source): boolean {
    return (
      source.type === "GITHUB" ||
      source.type === "GITLAB" ||
      source.type === "ZIP" ||
      source.type === "LOCAL_PROJECT"
    );
  }

  async analyze(context: SourceAnalysisContext): Promise<SourceAnalysisResult> {
    const draft = emptyIntelligenceDraft();
    const notes: string[] = [];
    const { source } = context;

    if (!context.bytes) {
      notes.push("Repository content was not stored locally, so only source metadata was analyzed");
      return { draft, notes };
    }

    let inspection: Awaited<ReturnType<typeof inspectRepositorySource>>;
    try {
      inspection = await inspectRepositorySource(context.bytes, source.mimeType);
    } catch {
      notes.push("The repository archive could not be read safely, so it was not analyzed");
      return { draft, notes };
    }
    notes.push(...inspection.notes);

    const files = inspection.files;
    if (files.length === 0) {
      notes.push("No README, manifest or documentation files were readable in the repository");
      return { draft, notes };
    }

    const manifestFile = files.find((file) => /(^|\/)package\.json$/.test(file.path));
    const readmeFile = files.find((file) => /readme(?:\.\w+)?$/i.test(file.path));
    const proseFiles = files
      .filter((file) => !/package\.json$/.test(file.path))
      .filter((file) => /\.(?:md|txt|rst)$/i.test(file.path))
      .slice(0, MAX_PROSE_EVIDENCE_FILES);

    const manifest = manifestFile ? parsePackageManifest(manifestFile.text) : null;
    if (manifestFile && manifest === null) {
      notes.push("package.json could not be parsed and was skipped");
    }

    const productName =
      (typeof manifest?.name === "string" && manifest.name.trim().length > 0 ? manifest.name.trim() : null) ??
      readmeFile?.path.split("/").pop()?.replace(/^readme(?:\.\w+)?$/i, "").trim() ??
      source.name;
    const productDescription =
      typeof manifest?.description === "string" && manifest.description.trim().length > 0
        ? manifest.description.trim()
        : null;

    const productEvidenceLocator = manifestFile ? `file:${manifestFile.path}` : `file:${readmeFile?.path ?? source.name}`;
    const productEvidence = addEvidence(
      draft,
      source.id,
      manifestFile ? "REPOSITORY_FILE" : "DOCUMENT_SECTION",
      productEvidenceLocator,
      productDescription ?? productName,
    );

    draft.product = {
      name: truncate(productName, 200),
      shortDescription: productDescription ? truncate(productDescription, 300) : null,
      longDescription: null,
      category: null,
      purpose: productDescription,
      valueProposition: productDescription,
      targetUserSummary: null,
      confidence: manifestFile ? "HIGH" : "MEDIUM",
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

    const dependencies: string[] = [
      ...Object.keys(manifest?.dependencies ?? {}),
      ...Object.keys(manifest?.devDependencies ?? {}),
    ];
    const manifestEvidence = manifestFile
      ? addEvidence(draft, source.id, "REPOSITORY_FILE", `file:${manifestFile.path}`, dependencies.slice(0, 20).join(", "))
      : productEvidence;

    let techCount = 0;
    for (const dependency of dependencies) {
      if (techCount >= MAX_TECH_FEATURES) break;
      const technology = TECHNOLOGY_FEATURES.find((entry) => entry.pattern.test(dependency));
      if (!technology) continue;
      const key = canonicalEntityKey("FEATURE", technology.name);
      if (draft.features.some((feature) => feature.key === key)) continue;
      draft.features.push({
        key,
        name: technology.name,
        description: `${technology.description} (${dependency})`,
        category: technology.category,
        importance: "SECONDARY",
        confidence: "HIGH",
        assertionKind: "FACT",
        sourceIds: [source.id],
        evidenceKeys: [manifestEvidence],
      });
      draft.relationships.push({
        type: "FEATURE_SUPPORTED_BY_EVIDENCE",
        fromType: "FEATURE",
        fromKey: key,
        toType: "EVIDENCE",
        toKey: manifestEvidence,
        confidence: "HIGH",
      });
      techCount += 1;
    }

    for (const dependency of manifest?.keywords ?? []) {
      if (typeof dependency !== "string" || !looksLikeFeatureLabel(dependency, 3, 60)) continue;
      const key = canonicalEntityKey("FEATURE", dependency);
      if (draft.features.some((feature) => feature.key === key)) continue;
      if (draft.features.some((feature) => isDuplicateEntity(dependency, feature.name))) continue;
      draft.features.push({
        key,
        name: truncate(dependency, 200),
        description: "Declared as a package keyword",
        category: "OTHER",
        importance: "TERTIARY",
        confidence: "MEDIUM",
        assertionKind: "FACT",
        sourceIds: [source.id],
        evidenceKeys: [manifestEvidence],
      });
      draft.relationships.push({
        type: "FEATURE_SUPPORTED_BY_EVIDENCE",
        fromType: "FEATURE",
        fromKey: key,
        toType: "EVIDENCE",
        toKey: manifestEvidence,
        confidence: "MEDIUM",
      });
    }

    /** Feature heading text, for section-scoped narrative linkage. */
    const featureSections = new Map<string, string>();

    if (readmeFile) {
      let headingCount = 0;
      for (const heading of readmeFile ? readmeHeadings(readmeFile.text) : []) {
        if (headingCount >= MAX_README_FEATURES) break;
        if (isDuplicateEntity(heading, productName)) continue;
        const key = canonicalEntityKey("FEATURE", heading);
        if (draft.features.some((feature) => feature.key === key)) continue;
        if (draft.features.some((feature) => isDuplicateEntity(heading, feature.name))) continue;
        const evidenceKey = addEvidence(
          draft,
          source.id,
          "DOCUMENT_SECTION",
          `file:${readmeFile.path}#${headingCount}`,
          heading,
        );
        draft.features.push({
          key,
          name: truncate(heading, 200),
          description: null,
          category: "OTHER",
          importance: importanceForFeature(heading, "heading"),
          confidence: "LOW",
          assertionKind: "INFERENCE",
          sourceIds: [source.id],
          evidenceKeys: [evidenceKey],
        });
        draft.relationships.push({
          type: "FEATURE_SUPPORTED_BY_EVIDENCE",
          fromType: "FEATURE",
          fromKey: key,
          toType: "EVIDENCE",
          toKey: evidenceKey,
          confidence: "LOW",
        });
        featureSections.set(key, heading);
        headingCount += 1;
      }

      // README prose is the only place a repository states the pain it removes
      // or the flow it supports, so it is read section by section.
      applyInsightExtraction(draft, {
        sourceId: source.id,
        evidenceKind: "DOCUMENT_SECTION",
        confidence: "LOW",
        featureSections,
        candidates: readmeSections(readmeFile.text).flatMap((section, index) =>
          splitSentences(stripMarkdownInline(section.body)).map((text) => ({
            text,
            section: section.heading,
            locator: `readme:${index}:${section.heading?.slice(0, 40) ?? "body"}:${text.slice(0, 40)}`,
          })),
        ),
      });
    }

    for (const file of proseFiles) {
      const prose = stripMarkdown(file.text);
      const evidenceKey = addEvidence(draft, source.id, "DOCUMENT_SECTION", `file:${file.path}`, prose.slice(0, 400));
      for (const claim of extractClaims([prose], 20)) {
        const key = canonicalEntityKey("CLAIM", claim.text);
        if (draft.claims.some((existing) => existing.key === key)) continue;
        draft.claims.push({
          key,
          text: claim.text,
          claimType: claim.claimType,
          sourceId: source.id,
          confidence: "LOW",
          assertionKind: claim.marketing ? "MARKETING_CLAIM" : "INFERENCE",
          sourceIds: [source.id],
          evidenceKeys: [evidenceKey],
        });
        draft.relationships.push({
          type: "CLAIM_SUPPORTED_BY_EVIDENCE",
          fromType: "CLAIM",
          fromKey: key,
          toType: "EVIDENCE",
          toKey: evidenceKey,
          confidence: "LOW",
        });
      }
    }

    if (draft.features.length === 0) {
      notes.push("No technical features could be confirmed from the repository manifest or README");
    }
    return { draft, notes };
  }
}
