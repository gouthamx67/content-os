import { describe, expect, it } from "vitest";
import { WebsiteBrandAnalyzer } from "./website-brand-analyzer";
import { TextBrandAnalyzer } from "./text-brand-analyzer";
import { RepositoryBrandAnalyzer } from "./repository-brand-analyzer";
import { CreativeBrandAnalyzer } from "./creative-brand-analyzer";
import type { BrandAnalyzerInput } from "../../core/ports/brand-analyzer";
import type { Source } from "../../core/domain/source";
import type { Asset } from "../../core/domain/asset";

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: "src_1",
    projectId: "prj_1",
    type: "WEBSITE",
    name: "Example",
    uri: "https://example.com",
    metadata: null,
    status: "READY",
    mimeType: "text/html",
    sizeBytes: 1_024,
    contentHash: "hash_1",
    storageKey: null,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function input(overrides: Partial<BrandAnalyzerInput> = {}): BrandAnalyzerInput {
  return {
    projectId: "prj_1",
    source: source(),
    bytes: null,
    text: null,
    html: null,
    existingAssetIds: [],
    existingAssets: [],
    ...overrides,
  };
}

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "ast_1",
    projectId: "prj_1",
    type: "LOGO",
    name: "logo-primary.svg",
    uri: "content-os-storage://local/brand/logo-primary.svg",
    metadata: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const HTML = `<!doctype html>
<html>
  <head>
    <title>Acme Content OS</title>
    <meta name="description" content="Acme is the content operating system for regulated teams." />
    <meta name="keywords" content="content operations, governance, compliance" />
    <meta property="og:site_name" content="Acme" />
    <link rel="icon" href="/favicon.ico" />
    <link rel="preload" as="font" href="/fonts/inter-var.woff2" />
    <style>
      :root {
        --brand-primary: #4F46E5;
        --brand-secondary: #0EA5E9;
        --color-accent: #F59E0B;
        --text-color: #111827;
      }
      h1 { font-family: "Sora", sans-serif; font-weight: 700; }
      body { font-family: Inter, system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <a href="/signup">Start free trial</a>
    <p>Never say revolutionary. Use single source of truth instead.</p>
    <h1>We build the content operating system for teams.</h1>
  </body>
</html>`;

describe("WebsiteBrandAnalyzer", () => {
  const analyzer = new WebsiteBrandAnalyzer();

  it("supports only website sources that carry html", () => {
    expect(analyzer.supports(input({ html: HTML }))).toBe(true);
    expect(analyzer.supports(input({ html: null }))).toBe(false);
    expect(
      analyzer.supports(input({ source: source({ type: "TEXT" }), html: HTML })),
    ).toBe(false);
  });

  it("reads the title, meta description and keywords as evidence", async () => {
    const result = await analyzer.analyze(input({ html: HTML }));
    const name = result.text.find((candidate) => candidate.field === "name");
    expect(name?.value).toBe("Acme Content OS");
    expect(name?.confidence).toBe("HIGH");
    const positioning = result.text.find((candidate) => candidate.field === "positioning");
    expect(positioning?.value).toContain("content operating system");
    const keywords = result.terms.filter((term) => term.category === "INDUSTRY_TERM");
    expect(keywords.map((term) => term.term)).toContain("governance");
    expect(result.evidence.some((item) => item.locator === "html:title")).toBe(true);
    expect(result.evidence.every((item) => item.excerpt !== null && item.excerpt.length > 0)).toBe(
      true,
    );
  });

  it("treats css variables as design tokens and hex literals as low confidence", async () => {
    const result = await analyzer.analyze(input({ html: HTML }));
    const primary = result.colors.find((color) => color.hex === "#4f46e5");
    expect(primary?.role).toBe("PRIMARY");
    expect(primary?.basis).toBe("DESIGN_TOKEN");
    expect(primary?.confidence).toBe("HIGH");
    expect(result.colors.every((color) => /^#[0-9a-f]{6}$/.test(color.hex))).toBe(true);
    expect(
      result.colors.every(
        (color) => color.basis === "DESIGN_TOKEN" || color.confidence === "LOW",
      ),
    ).toBe(true);
  });

  it("never claims a primary color when the site declares no palette", async () => {
    const bare = "<html><head><title>Bare</title></head><body>Hello</body></html>";
    const result = await analyzer.analyze(input({ html: bare }));
    expect(result.colors).toHaveLength(0);
  });

  it("reads font families with their role and weight", async () => {
    const result = await analyzer.analyze(input({ html: HTML }));
    const heading = result.fonts.find((font) => font.family === "Sora");
    expect(heading?.role).toBe("HEADING");
    expect(heading?.weight).toBe("700");
    const body = result.fonts.find((font) => font.family === "Inter");
    expect(body?.role).toBe("BODY");
    const preloaded = result.fonts.find((font) => font.sourceUrl?.includes("inter-var"));
    expect(preloaded?.family).toBe("Inter");
  });

  it("records favicon and logo-like image references as evidence without inventing assets", async () => {
    const result = await analyzer.analyze(input({ html: HTML }));
    expect(result.assets).toHaveLength(0);
    expect(result.evidence.some((item) => item.locator.startsWith("html:favicon:"))).toBe(true);
  });

  it("extracts voice signals, avoid terms and guideline lines", async () => {
    const result = await analyzer.analyze(input({ html: HTML }));
    expect(result.voiceSignals.length).toBeGreaterThan(0);
    expect(result.terms.some((term) => term.preference === "AVOID")).toBe(true);
    expect(
      result.terms.some((term) => term.category === "CALL_TO_ACTION" && term.term === "Start free trial"),
    ).toBe(true);
  });

  it("gives the same evidence key for repeated runs", async () => {
    const first = await analyzer.analyze(input({ html: HTML }));
    const second = await analyzer.analyze(input({ html: HTML }));
    expect(first.evidence.map((item) => item.key)).toEqual(
      second.evidence.map((item) => item.key),
    );
  });
});

describe("TextBrandAnalyzer", () => {
  const analyzer = new TextBrandAnalyzer();

  const brandGuide = `Acme brand guidelines
Voice: confident and plain spoken
Tone: friendly, never sarcastic
Colors
Primary color #4f46e5 is the Acme primary color
Accent color #f59e0b
Typography
Sora font is the heading font
Avoid revolutionary, game-changing, synergy
Do not use web3 language
Tagline: The content operating system for regulated teams
Book a demo to see Acme automation in action
`;

  it("supports document, pdf, text and other sources", () => {
    expect(analyzer.supports(input({ source: source({ type: "DOCUMENT" }), text: "x" }))).toBe(true);
    expect(analyzer.supports(input({ source: source({ type: "PDF" }), text: "x" }))).toBe(true);
    expect(analyzer.supports(input({ source: source({ type: "TEXT" }), text: "x" }))).toBe(true);
    expect(analyzer.supports(input({ source: source({ type: "WEBSITE" }), text: "x" }))).toBe(false);
  });

  it("reads a brand guide into colors, fonts, terms, guidelines and tagline", async () => {
    const result = await analyzer.analyze(
      input({ source: source({ type: "TEXT" }), text: brandGuide }),
    );
    expect(result.colors.map((color) => color.hex)).toEqual(["#4f46e5", "#f59e0b"]);
    expect(result.colors[0]?.role).toBe("PRIMARY");
    expect(result.colors[0]?.basis).toBe("EXPLICIT_GUIDELINE");
    expect(result.fonts.map((font) => font.family)).toContain("Sora");
    expect(result.fonts[0]?.role).toBe("HEADING");
    expect(result.terms.filter((term) => term.preference === "AVOID").map((term) => term.term)).toEqual(
      expect.arrayContaining(["revolutionary", "game-changing", "synergy"]),
    );
    expect(result.text.find((candidate) => candidate.field === "tagline")?.value).toBe(
      "The content operating system for regulated teams",
    );
    expect(result.guidelines.length).toBeGreaterThan(0);
    expect(
      result.guidelines.every((guideline) => guideline.basis === "EXPLICIT_GUIDELINE"),
    ).toBe(true);
  });

  it("produces nothing for an unreadable pdf", async () => {
    const result = await analyzer.analyze(
      input({
        source: source({ type: "PDF", mimeType: "application/pdf" }),
        text: null,
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
      }),
    );
    expect(result.colors).toHaveLength(0);
    expect(result.notes[0]).toContain("No readable brand text");
  });

  it("reads a plain brief that never labels itself", async () => {
    const brief = [
      "# Northwind Analytics",
      "",
      "Northwind Analytics is the content operating system for regulated teams.",
      "",
      "Primary color: #1D4ED8",
      "Heading font: Sora",
      "Body font: Inter",
    ].join("\n");

    const result = await analyzer.analyze(
      input({ source: source({ type: "TEXT" }), text: brief }),
    );

    const field = (name: string) => result.text.find((item) => item.field === name);
    expect(field("name")?.value).toBe("Northwind Analytics");
    // A heading is weaker evidence than a labelled field, so it never claims more
    // than an extraction.
    expect(field("name")?.basis).toBe("GENERAL_EXTRACTION");
    expect(field("name")?.confidence).toBe("MEDIUM");
    expect(field("positioning")?.value).toBe(
      "Northwind Analytics is the content operating system for regulated teams",
    );
    expect(result.fonts.map((font) => font.family).sort()).toEqual(["Inter", "Sora"]);
    expect(result.colors.map((color) => color.hex)).toContain("#1d4ed8");
    expect(result.text.every((item) => item.evidenceKeys.length > 0)).toBe(true);
  });

  it("prefers a labelled identity field over the document heading", async () => {
    const result = await analyzer.analyze(
      input({
        source: source({ type: "TEXT" }),
        text: ["# Draft notes", "", "Brand name: Acme Cloud", "Tagline: Ship on Friday"].join("\n"),
      }),
    );

    expect(result.text.find((item) => item.field === "name")?.value).toBe("Acme Cloud");
    expect(result.text.find((item) => item.field === "name")?.basis).toBe("EXPLICIT_GUIDELINE");
    expect(result.text.some((item) => item.value === "Draft notes")).toBe(false);
  });

  it("does not mistake a document title for the brand name", async () => {
    const result = await analyzer.analyze(
      input({
        source: source({ type: "TEXT" }),
        text: ["Acme brand guidelines", "Tagline: The content operating system"].join("\n"),
      }),
    );

    expect(result.text.some((item) => item.field === "name")).toBe(false);
  });

  it("does not invent a positioning sentence from ordinary prose", async () => {
    const result = await analyzer.analyze(
      input({
        source: source({ type: "TEXT" }),
        text: ["Quarterly notes", "The team shipped the new pipeline last week."].join("\n"),
      }),
    );

    expect(result.text.some((item) => item.field === "positioning")).toBe(false);
  });
});

describe("RepositoryBrandAnalyzer", () => {
  const analyzer = new RepositoryBrandAnalyzer();

  it("only supports repository shaped sources", () => {
    expect(analyzer.supports(input({ source: source({ type: "GITHUB" }) }))).toBe(true);
    expect(analyzer.supports(input({ source: source({ type: "ZIP" }) }))).toBe(true);
    expect(analyzer.supports(input({ source: source({ type: "WEBSITE" }) }))).toBe(false);
  });

  it("reads design tokens out of a stylesheet", async () => {
    const result = await analyzer.analyze(
      input({
        source: source({ type: "GITHUB", name: "acme-web", mimeType: "text/plain" }),
        text: ":root{--brand-primary:#4f46e5;--brand-accent:#f59e0b}h1{font-family:\"Sora\",sans-serif}",
      }),
    );
    expect(result.colors.map((color) => color.hex)).toEqual(["#4f46e5", "#f59e0b"]);
    expect(result.colors.every((color) => color.basis === "DESIGN_TOKEN")).toBe(true);
    expect(result.fonts.map((font) => font.family)).toEqual(["Sora"]);
    expect(result.evidence.some((item) => item.kind === "REPOSITORY_FILE")).toBe(true);
  });
});

describe("CreativeBrandAnalyzer", () => {
  const analyzer = new CreativeBrandAnalyzer();

  it("classifies an uploaded logo by name tokens rather than list order", async () => {
    const result = await analyzer.analyze(
      input({
        source: null,
        existingAssets: [
          asset({ id: "ast_2", name: "photo-team-offsite.png", type: "IMAGE" }),
          asset({ id: "ast_1", name: "logo-primary.svg", type: "LOGO" }),
          asset({ id: "ast_3", name: "favicon-32.png", type: "IMAGE" }),
        ],
      }),
    );
    const primary = result.assets.find((candidate) => candidate.assetId === "ast_1");
    expect(primary?.role).toBe("PRIMARY_LOGO");
    expect(primary?.confidence).toBe("HIGH");
    const favicon = result.assets.find((candidate) => candidate.assetId === "ast_3");
    expect(favicon?.role).toBe("FAVICON");
    const photo = result.assets.find((candidate) => candidate.assetId === "ast_2");
    expect(photo?.role).toBe("PHOTOGRAPHY_STYLE");
  });

  it("reports when no asset could be classified", async () => {
    const result = await analyzer.analyze(
      input({ source: null, existingAssets: [asset({ name: "notes.txt", type: "DOCUMENT" })] }),
    );
    expect(result.assets).toHaveLength(0);
    expect(result.notes.join(" ")).toContain("No uploaded asset");
  });
});
