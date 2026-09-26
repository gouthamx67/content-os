import { describe, expect, it } from "vitest";
import type { Source } from "../../core/domain/source";
import { DocumentAnalyzer } from "./document-analyzer";
import { MediaAnalyzer, probeImage, probeIsoMedia, probeMp3, probeWav } from "./media-analyzer";
import { ReferenceAnalyzer } from "./reference-analyzer";
import { RepositoryAnalyzer } from "./repository-analyzer";
import { WebsiteAnalyzer } from "./website-analyzer";
import { parseHtmlDocument } from "./html";
import { decodeHtmlEntities, splitSentences } from "./text";
import { extractAudienceSignals, extractClaims } from "./heuristics";

const projectId = "project-1";

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: "source-1",
    projectId,
    type: "TEXT",
    name: "Input",
    uri: null,
    metadata: null,
    status: "READY",
    mimeType: "text/plain; charset=utf-8",
    sizeBytes: 10,
    contentHash: "hash-a",
    storageKey: `projects/${projectId}/inputs/hash-a/original`,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    ...overrides,
  };
}

function bytesOf(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

const MARKETING_HTML = `<!doctype html>
<html>
  <head>
    <title>Content OS — AI video generation for marketers</title>
    <meta name="description" content="Content OS turns briefs into launch videos in seconds." />
    <meta property="og:site_name" content="Content OS" />
    <style>:root { color: #0b1220; font-family: Inter, sans-serif; }</style>
    <script>console.log("ignore me");</script>
  </head>
  <body>
    <h1>Content OS</h1>
    <p>Content OS is a content operations platform built for marketing teams.</p>
    <h2>AI Video Generation</h2>
    <p>Generate launch videos from a brief without any code.</p>
    <h2>Launch Analytics</h2>
    <ul>
      <li>Track every launch in one dashboard</li>
      <li>Export results as CSV</li>
    </ul>
    <a href="/signup">Start free trial</a>
    <button>Generate a video</button>
    <img src="/static/dashboard-analytics.png" alt="Launch analytics dashboard" width="1200" height="800" />
    <img src="/static/brand-logo.svg" alt="Content OS logo" width="160" height="32" />
  </body>
</html>`;

describe("text helpers", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeHtmlEntities("A &amp; B &mdash; &#8212; &#x2014; &unknown;")).toBe("A & B — — — &unknown;");
  });

  it("splits sentences but keeps decimals and abbreviations intact", () => {
    expect(splitSentences("Version 1.5 shipped. Latency dropped 40% today.")).toEqual([
      "Version 1.5 shipped.",
      "Latency dropped 40% today.",
    ]);
  });
});

describe("parseHtmlDocument", () => {
  it("extracts structure, metadata, design tokens and ignores scripts", () => {
    const document = parseHtmlDocument(MARKETING_HTML);
    expect(document.title).toBe("Content OS — AI video generation for marketers");
    expect(document.meta.find((item) => item.name === "og:site_name")?.content).toBe("Content OS");
    expect(document.headings.map((heading) => heading.text)).toEqual([
      "Content OS",
      "AI Video Generation",
      "Launch Analytics",
    ]);
    expect(document.listItems).toEqual([
      "Track every launch in one dashboard",
      "Export results as CSV",
    ]);
    expect(document.links[0].text).toBe("Start free trial");
    expect(document.buttons).toEqual(["Generate a video"]);
    expect(document.colors).toContain("#0b1220");
    expect(document.fonts[0]).toContain("Inter");
    expect(document.paragraphs.join(" ")).not.toContain("ignore me");
  });

  it("survives malformed markup without throwing", () => {
    const document = parseHtmlDocument("<h1>Broken<p>text<img src='a.png' <h2>next");
    expect(document.headings.map((heading) => heading.text)).toEqual(["Broken", "next"]);
  });

  it("returns an empty document for empty input", () => {
    const document = parseHtmlDocument("");
    expect(document.title).toBeNull();
    expect(document.headings).toEqual([]);
  });
});

describe("heuristics", () => {
  it("extracts capability claims and classifies their type", () => {
    const claims = extractClaims([
      "Content OS can generate launch videos in seconds.",
      "Subscribe to a plan and manage billing in one place.",
      "Export every launch as a CSV file.",
      "The weather is nice today.",
    ]);
    expect(claims[0].claimType).toBe("CAPABILITY");
    expect(claims[0].marketing).toBe(true);
    expect(claims.map((claim) => claim.claimType)).toContain("PRICING");
    expect(claims.map((claim) => claim.claimType)).toContain("FORMAT");
    expect(claims.some((claim) => claim.text.includes("weather"))).toBe(false);
  });

  it("detects explicit and contextual audiences", () => {
    const audiences = extractAudienceSignals([
      "Content OS is a platform built for marketing teams.",
      "Perfect for designers and small businesses.",
    ]);
    const segments = audiences.map((audience) => audience.segment);
    expect(segments).toContain("marketing teams");
    expect(segments).toContain("small businesses");
    expect(audiences.some((audience) => audience.kind === "EXPLICIT_SEGMENT")).toBe(true);
  });

  it("deduplicates audience segments", () => {
    const audiences = extractAudienceSignals(["For developers.", "for developers"]);
    expect(audiences).toHaveLength(1);
  });
});

describe("WebsiteAnalyzer", () => {
  const analyzer = new WebsiteAnalyzer();

  it("supports website and web app sources only", () => {
    expect(analyzer.supports(source({ type: "WEBSITE" }))).toBe(true);
    expect(analyzer.supports(source({ type: "WEB_APP" }))).toBe(true);
    expect(analyzer.supports(source({ type: "GITHUB" }))).toBe(false);
  });

  it("derives a product, features, claims, brand signals and assets with evidence", async () => {
    const result = await analyzer.analyze({
      projectId,
      source: source({ type: "WEBSITE", name: "content-os.example" }),
      bytes: bytesOf(MARKETING_HTML),
    });
    const { draft } = result;

    expect(draft.product?.name).toBe("Content OS");
    expect(draft.product?.shortDescription).toBe("Content OS turns briefs into launch videos in seconds.");

    const featureNames = draft.features.map((feature) => feature.name);
    expect(featureNames).toContain("AI Video Generation");
    expect(featureNames).toContain("Launch Analytics");
    expect(featureNames).toContain("Track every launch in one dashboard");

    const aiFeature = draft.features.find((feature) => feature.name === "AI Video Generation");
    expect(aiFeature?.category).toBe("AI_GENERATION");
    expect(aiFeature?.assertionKind).toBe("FACT");
    expect(aiFeature?.evidenceKeys.length).toBeGreaterThan(0);

    expect(draft.claims.length).toBeGreaterThan(0);
    expect(draft.claims.every((claim) => claim.sourceId === "source-1")).toBe(true);

    const brandKinds = draft.brandSignals.map((signal) => signal.kind);
    expect(brandKinds).toContain("BRAND_NAME");
    expect(brandKinds).toContain("TAGLINE");
    expect(brandKinds).toContain("COLOR");
    expect(brandKinds).toContain("LOGO");

    const dashboard = draft.assets.find((asset) => asset.name.includes("dashboard"));
    expect(dashboard?.width).toBe(1200);
    expect(dashboard?.height).toBe(800);
    expect(dashboard?.relatedFeatureKeys.length).toBeGreaterThan(0);

    const relationshipTypes = new Set(draft.relationships.map((relationship) => relationship.type));
    expect(relationshipTypes).toContain("PRODUCT_SUPPORTED_BY_EVIDENCE");
    expect(relationshipTypes).toContain("FEATURE_SUPPORTED_BY_EVIDENCE");
    expect(relationshipTypes).toContain("CLAIM_SUPPORTED_BY_EVIDENCE");
    expect(relationshipTypes).toContain("AUDIENCE_SUPPORTED_BY_EVIDENCE");
    expect(relationshipTypes).toContain("BRAND_SUPPORTED_BY_EVIDENCE");
    expect(relationshipTypes).toContain("ASSET_REPRESENTS_FEATURE");
  });

  it("attaches evidence that resolves to recorded evidence rows", async () => {
    const { draft } = await analyzer.analyze({
      projectId,
      source: source({ type: "WEBSITE" }),
      bytes: bytesOf(MARKETING_HTML),
    });
    const known = new Set(draft.evidence.map((item) => item.key));
    for (const feature of draft.features) {
      for (const key of feature.evidenceKeys) expect(known.has(key)).toBe(true);
    }
    for (const relationship of draft.relationships) {
      if (relationship.toType === "EVIDENCE") expect(known.has(relationship.toKey)).toBe(true);
    }
  });

  it("returns an empty draft with a note when no bytes are stored", async () => {
    const result = await analyzer.analyze({ projectId, source: source({ type: "WEBSITE" }), bytes: null });
    expect(result.draft.features).toEqual([]);
    expect(result.notes[0]).toMatch(/not stored locally/);
  });

  it("notes when the markup has no readable structure", async () => {
    const result = await analyzer.analyze({
      projectId,
      source: source({ type: "WEBSITE" }),
      bytes: bytesOf("<div></div>"),
    });
    expect(result.notes[0]).toMatch(/No readable headings/);
  });
});

describe("RepositoryAnalyzer", () => {
  const analyzer = new RepositoryAnalyzer();

  it("supports repository and archive source types", () => {
    expect(analyzer.supports(source({ type: "GITHUB" }))).toBe(true);
    expect(analyzer.supports(source({ type: "GITLAB" }))).toBe(true);
    expect(analyzer.supports(source({ type: "ZIP" }))).toBe(true);
    expect(analyzer.supports(source({ type: "LOCAL_PROJECT" }))).toBe(true);
    expect(analyzer.supports(source({ type: "WEBSITE" }))).toBe(false);
  });

  it("records a note instead of throwing when bytes are missing", async () => {
    const result = await analyzer.analyze({ projectId, source: source({ type: "GITHUB" }), bytes: null });
    expect(result.draft.claims).toEqual([]);
    expect(result.notes[0]).toMatch(/not stored locally/);
  });

  it("notes when the archive cannot be read", async () => {
    const result = await analyzer.analyze({
      projectId,
      source: source({ type: "ZIP", mimeType: "application/zip" }),
      bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    });
    expect(result.notes.some((note) => /could not be read safely/.test(note))).toBe(true);
    expect(result.draft.features).toEqual([]);
  });
});

describe("DocumentAnalyzer", () => {
  const analyzer = new DocumentAnalyzer();

  it("supports text, document and pdf sources", () => {
    expect(analyzer.supports(source({ type: "TEXT" }))).toBe(true);
    expect(analyzer.supports(source({ type: "DOCUMENT" }))).toBe(true);
    expect(analyzer.supports(source({ type: "PDF" }))).toBe(true);
    expect(analyzer.supports(source({ type: "VIDEO" }))).toBe(false);
  });

  it("extracts a product, features and claims from a markdown document", async () => {
    const markdown = [
      "# Content OS",
      "",
      "Content OS is a content operations platform for marketing teams.",
      "",
      "## Launch Analytics",
      "",
      "Track every launch from one dashboard and export results as CSV.",
      "",
      "## AI Video Generation",
      "",
      "The roadmap will generate videos automatically.",
      "",
      "```js",
      "generateVideo() // should be ignored as a heading",
      "```",
    ].join("\n");

    const { draft } = await analyzer.analyze({
      projectId,
      source: source({ type: "TEXT", name: "product-brief.md" }),
      bytes: bytesOf(markdown),
    });

    expect(draft.product?.name).toBe("Content OS");
    const featureNames = draft.features.map((feature) => feature.name);
    expect(featureNames).toContain("Launch Analytics");
    expect(featureNames).toContain("AI Video Generation");
    expect(featureNames).not.toContain("generateVideo() // should be ignored as a heading");
    expect(draft.claims.some((claim) => claim.text.includes("export results as CSV"))).toBe(true);
    expect(draft.audienceSignals.map((signal) => signal.segment)).toContain("marketing teams");
  });

  it("still extracts claims from a long markdown document", async () => {
    const markdown = [
      "# Northwind Analytics",
      "",
      "Northwind Analytics turns raw product data into live dashboards in minutes.",
      "",
      "## Real-time dashboards",
      "",
      "Every metric refreshes continuously, with no scheduled rebuild.",
      "",
      "## Slack integration",
      "",
      "Alerts and digests post straight into Slack channels.",
      "",
      "## CSV export",
      "",
      "Export any dashboard to CSV for offline analysis.",
    ].join("\n");

    expect(markdown.length).toBeGreaterThan(300);

    const { draft } = await analyzer.analyze({
      projectId,
      source: source({ type: "TEXT", name: "long-brief.md" }),
      bytes: bytesOf(markdown),
    });

    expect(draft.product?.name).toBe("Northwind Analytics");
    expect(draft.features).toHaveLength(3);

    const claimTexts = draft.claims.map((claim) => claim.text);
    expect(claimTexts.some((text) => text.includes("Export any dashboard to CSV"))).toBe(true);
    expect(claimTexts.some((text) => text.includes("Slack integration"))).toBe(true);

    expect(draft.relationships.length).toBeGreaterThan(draft.features.length);
  });

  it("notes when a pdf has no extractable text", async () => {
    const notAPdf = bytesOf("%PDF-1.7\nnothing to see here\n");
    const result = await analyzer.analyze({
      projectId,
      source: source({ type: "PDF", mimeType: "application/pdf" }),
      bytes: notAPdf,
    });
    expect(result.notes.some((note) => /No readable text/.test(note))).toBe(true);
    expect(result.draft.features).toEqual([]);
  });
});

describe("media probes", () => {
  it("reads PNG dimensions and colour type", () => {
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
    const view = new DataView(png.buffer);
    view.setUint32(16, 1920, false);
    view.setUint32(20, 1080, false);
    png[24] = 8;
    png[25] = 6;

    const probe = probeImage(png);
    expect(probe.format).toBe("png");
    expect(probe.width).toBe(1920);
    expect(probe.height).toBe(1080);
    expect(probe.quality.hasAlpha).toBe(true);
  });

  it("reads GIF dimensions", () => {
    const gif = new Uint8Array(13);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
    gif[6] = 320 & 0xff;
    gif[7] = 320 >> 8;
    gif[8] = 240 & 0xff;
    gif[9] = 240 >> 8;
    const probe = probeImage(gif);
    expect(probe.format).toBe("gif");
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(240);
  });

  it("returns an empty probe for unknown bytes", () => {
    expect(probeImage(new Uint8Array(4)).format).toBeNull();
  });

  it("reads mp4 duration and track dimensions from the atom tree", () => {
    function atom(type: string, payload: Uint8Array): Uint8Array {
      const out = new Uint8Array(8 + payload.byteLength);
      new DataView(out.buffer).setUint32(0, out.byteLength, false);
      for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
      out.set(payload, 8);
      return out;
    }

    const mvhd = new Uint8Array(20);
    new DataView(mvhd.buffer).setUint32(12, 1000, false);
    new DataView(mvhd.buffer).setUint32(16, 30_000, false);

    const tkhdPayload = new Uint8Array(96);
    const tkhdView = new DataView(tkhdPayload.buffer);
    tkhdView.setUint32(76, 1920 * 65536, false);
    tkhdView.setUint32(80, 1080 * 65536, false);

    const bytes = new Uint8Array([
      ...atom("ftyp", new TextEncoder().encode("isom")),
      ...atom("moov", new Uint8Array([...atom("mvhd", mvhd), ...atom("trak", atom("tkhd", tkhdPayload))])),
    ]);

    const probe = probeIsoMedia(bytes);
    expect(probe.format).toBe("isom");
    expect(probe.durationMs).toBe(30_000);
    expect(probe.width).toBe(1920);
    expect(probe.height).toBe(1080);
  });

  it("computes wav duration from the byte rate", () => {
    const audioBytes = 176_400;
    const wav = new Uint8Array(44 + audioBytes);
    const view = new DataView(wav.buffer);
    const writeTag = (offset: number, tag: string) => {
      for (let index = 0; index < 4; index += 1) wav[offset + index] = tag.charCodeAt(index);
    };
    writeTag(0, "RIFF");
    writeTag(8, "WAVE");
    writeTag(12, "fmt ");
    writeTag(36, "data");
    view.setUint32(4, 36 + audioBytes, true);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 44_100, true);
    view.setUint32(28, 176_400, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 32, true);
    view.setUint32(40, audioBytes, true);

    const probe = probeWav(wav);
    expect(probe.format).toBe("wav");
    expect(probe.durationMs).toBe(1000);
  });

  it("estimates mp3 duration from the first frame header", () => {
    const mp3 = new Uint8Array(16_000);
    mp3[0] = 0xff;
    mp3[1] = 0xfb;
    mp3[2] = 0x90;
    const probe = probeMp3(mp3);
    expect(probe.format).toBe("mp3");
    expect(probe.quality.sampleRate).toBe(44100);
    expect(probe.durationMs).toBeGreaterThan(0);
  });
});

describe("MediaAnalyzer", () => {
  const analyzer = new MediaAnalyzer();

  it("supports image, video and audio sources", () => {
    expect(analyzer.supports(source({ type: "IMAGE" }))).toBe(true);
    expect(analyzer.supports(source({ type: "VIDEO" }))).toBe(true);
    expect(analyzer.supports(source({ type: "AUDIO" }))).toBe(true);
    expect(analyzer.supports(source({ type: "TEXT" }))).toBe(false);
  });

  it("records technical signals for a recognisable image", async () => {
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
    const view = new DataView(png.buffer);
    view.setUint32(16, 800, false);
    view.setUint32(20, 600, false);
    png[24] = 8;
    png[25] = 2;

    const { draft } = await analyzer.analyze({
      projectId,
      source: source({ type: "IMAGE", name: "hero.png", mimeType: "image/png" }),
      bytes: png,
    });

    expect(draft.assets).toHaveLength(1);
    expect(draft.assets[0].width).toBe(800);
    expect(draft.assets[0].height).toBe(600);
    expect(draft.assets[0].confidence).toBe("HIGH");
    expect(draft.assets[0].storageKey).toBe(`projects/${projectId}/inputs/hash-a/original`);
  });

  it("notes when the header cannot be recognised", async () => {
    const result = await analyzer.analyze({
      projectId,
      source: source({ type: "VIDEO", name: "clip.bin" }),
      bytes: new Uint8Array(64),
    });
    expect(result.notes[0]).toMatch(/header could not be recognised/);
    expect(result.draft.assets).toEqual([]);
  });
});

describe("ReferenceAnalyzer", () => {
  const analyzer = new ReferenceAnalyzer();

  it("records an unresolved reference without fetching anything", async () => {
    const { draft, notes } = await analyzer.analyze({
      projectId,
      source: source({ type: "FIGMA", name: "design-system", uri: "https://figma.example/file/abc" }),
      bytes: null,
    });

    expect(draft.assets).toHaveLength(1);
    expect(draft.assets[0].confidence).toBe("LOW");
    expect(draft.assets[0].qualitySignals).toContain('"resolved":false');
    expect(notes[0]).toMatch(/not fetched/);
  });
});

describe("narrative extraction from real source content", () => {
  const LAUNCH_BRIEF = [
    "# Launchboard",
    "",
    "Launchboard is a content operations platform for marketing teams.",
    "",
    "## Platform-specific drafts",
    "",
    "Marketing teams currently spend hours manually rewriting the same launch announcement for every channel.",
    "",
    "## Campaign workspace",
    "",
    "To publish, create a campaign, generate platform-specific drafts, review the drafts, then publish the final versions.",
    "",
    "## One brief per channel",
    "",
    "Launchboard adapts one campaign for every platform, so you can publish everywhere from a single brief.",
    "",
    "It cuts the manual work per launch and keeps every channel consistent.",
  ].join("\n");

  it("derives problems, benefits and workflows from a markdown brief", async () => {
    const { draft } = await new DocumentAnalyzer().analyze({
      projectId,
      source: source({ type: "TEXT", name: "launch-brief.md" }),
      bytes: bytesOf(LAUNCH_BRIEF),
    });

    expect(draft.problems.length).toBeGreaterThan(0);
    expect(draft.benefits.length).toBeGreaterThan(0);
    expect(draft.workflows.length).toBeGreaterThan(0);

    const featureNames = draft.features.map((feature) => feature.name);
    for (const problem of draft.problems) {
      expect(problem.name.length).toBeGreaterThan(3);
      expect(featureNames).not.toContain(problem.name);
      expect(problem.evidenceKeys).toHaveLength(1);
      expect(problem.sourceIds).toEqual(["source-1"]);
    }
    for (const benefit of draft.benefits) {
      expect(benefit.name.length).toBeGreaterThan(3);
      expect(featureNames).not.toContain(benefit.name);
      expect(benefit.evidenceKeys).toHaveLength(1);
    }
    for (const workflow of draft.workflows) {
      expect(workflow.steps.length).toBeGreaterThanOrEqual(3);
      expect(workflow.steps.map((step) => step.order)).toEqual(
        workflow.steps.map((_step, index) => index + 1),
      );
      expect(workflow.evidenceKeys).toHaveLength(1);
    }
  });

  it("records evidence whose excerpt exists in the source", async () => {
    const { draft } = await new DocumentAnalyzer().analyze({
      projectId,
      source: source({ type: "TEXT", name: "launch-brief.md" }),
      bytes: bytesOf(LAUNCH_BRIEF),
    });

    const excerpts = draft.evidence.map((item) => item.excerpt ?? "");
    for (const problem of draft.problems) {
      for (const key of problem.evidenceKeys) {
        const evidence = draft.evidence.find((item) => item.key === key);
        expect(evidence?.sourceId).toBe("source-1");
        expect(excerpts.some((excerpt) => excerpt.length > 0 && LAUNCH_BRIEF.includes(excerpt))).toBe(true);
      }
    }
  });

  it("links features to the problems, benefits and workflows they belong to", async () => {
    const { draft } = await new DocumentAnalyzer().analyze({
      projectId,
      source: source({ type: "TEXT", name: "launch-brief.md" }),
      bytes: bytesOf(LAUNCH_BRIEF),
    });

    const byType = (type: string) =>
      draft.relationships.filter((relationship) => relationship.type === type);
    expect(byType("FEATURE_SOLVES_PROBLEM").length).toBeGreaterThan(0);
    expect(byType("FEATURE_PROVIDES_BENEFIT").length).toBeGreaterThan(0);
    expect(byType("WORKFLOW_USES_FEATURE").length).toBeGreaterThan(0);

    const featureKeys = new Set(draft.features.map((feature) => feature.key));
    const problemKeys = new Set(draft.problems.map((problem) => problem.key));
    const benefitKeys = new Set(draft.benefits.map((benefit) => benefit.key));
    const workflowKeys = new Set(draft.workflows.map((workflow) => workflow.key));
    for (const relationship of byType("FEATURE_SOLVES_PROBLEM")) {
      expect(featureKeys.has(relationship.fromKey)).toBe(true);
      expect(problemKeys.has(relationship.toKey)).toBe(true);
    }
    for (const relationship of byType("FEATURE_PROVIDES_BENEFIT")) {
      expect(featureKeys.has(relationship.fromKey)).toBe(true);
      expect(benefitKeys.has(relationship.toKey)).toBe(true);
    }
    for (const relationship of byType("WORKFLOW_USES_FEATURE")) {
      expect(workflowKeys.has(relationship.fromKey)).toBe(true);
      expect(featureKeys.has(relationship.toKey)).toBe(true);
    }
  });

  it("emits nothing narrative when the source states no pain, outcome or flow", async () => {
    const plain = [
      "# Ledger",
      "",
      "Ledger stores invoices in Postgres.",
      "",
      "## Invoices",
      "",
      "Each invoice has a number, a total and a due date.",
    ].join("\n");
    const { draft } = await new DocumentAnalyzer().analyze({
      projectId,
      source: source({ type: "TEXT", name: "ledger.md" }),
      bytes: bytesOf(plain),
    });
    expect(draft.problems).toEqual([]);
    expect(draft.benefits).toEqual([]);
    expect(draft.workflows).toEqual([]);
  });
});

describe("narrative extraction from a repository README", () => {
  function localBundle(files: Record<string, string>): Uint8Array {
    const encoded = Object.fromEntries(
      Object.entries(files).map(([path, text]) => [path, Buffer.from(text, "utf8").toString("base64")]),
    );
    return bytesOf(
      JSON.stringify({
        files: Object.entries(files).map(([path]) => ({
          path,
          content: encoded[path],
          mimeType: "text/markdown",
        })),
      }),
    );
  }

  it("reads problems, benefits and workflows out of README prose", async () => {
    const readme = [
      "# Launchboard",
      "",
      "Launchboard is a content operations platform for marketing teams.",
      "",
      "## Platform-specific drafts",
      "",
      "Marketing teams currently spend hours manually rewriting the same launch announcement for every channel.",
      "",
      "## Campaign workspace",
      "",
      "To publish, create a campaign, generate platform-specific drafts, review the drafts, then publish the final versions.",
      "",
      "## One brief per channel",
      "",
      "Launchboard adapts one campaign for every platform, so you can publish everywhere from a single brief.",
    ].join("\n");

    const { draft } = await new RepositoryAnalyzer().analyze({
      projectId,
      source: source({
        type: "GITHUB",
        name: "launchboard",
        mimeType: "application/vnd.content-os.local-project+json",
      }),
      bytes: localBundle({ "README.md": readme }),
    });

    expect(draft.problems.length).toBeGreaterThan(0);
    expect(draft.benefits.length).toBeGreaterThan(0);
    expect(draft.workflows.length).toBeGreaterThan(0);
    expect(draft.workflows[0]?.steps.length).toBeGreaterThanOrEqual(3);
    const linked = draft.relationships.filter(
      (relationship) =>
        relationship.type === "WORKFLOW_USES_FEATURE" ||
        relationship.type === "FEATURE_SOLVES_PROBLEM" ||
        relationship.type === "FEATURE_PROVIDES_BENEFIT",
    );
    expect(linked.length).toBeGreaterThan(0);
  });
});

describe("narrative extraction from a website", () => {
  const HTML = [
    "<html><head><title>Launchboard</title>",
    '<meta name="description" content="Content operations for marketing teams" />',
    "</head><body>",
    "<h1>Launchboard</h1>",
    "<h2>Platform-specific drafts</h2>",
    "<p>Marketing teams currently spend hours manually rewriting the same launch announcement for every channel.</p>",
    "<h2>Campaign workspace</h2>",
    "<p>To publish, create a campaign, generate platform-specific drafts, review the drafts, then publish the final versions.</p>",
    "<h2>One brief per channel</h2>",
    "<p>Launchboard adapts one campaign for every platform, so you can publish everywhere from a single brief.</p>",
    "<p>It cuts the manual work per launch and keeps every channel consistent.</p>",
    "</body></html>",
  ].join("\n");

  it("reads problems, benefits and workflows out of marketing copy", async () => {
    const { draft } = await new WebsiteAnalyzer().analyze({
      projectId,
      source: source({ type: "WEBSITE", name: "launchboard.com", mimeType: "text/html" }),
      bytes: bytesOf(HTML),
    });

    expect(draft.problems.length).toBeGreaterThan(0);
    expect(draft.benefits.length).toBeGreaterThan(0);
    expect(draft.workflows.length).toBeGreaterThan(0);
    expect(draft.workflows[0]?.steps.length).toBeGreaterThanOrEqual(3);
    for (const problem of draft.problems) {
      expect(problem.sourceIds).toEqual(["source-1"]);
      expect(problem.evidenceKeys).toHaveLength(1);
    }
    const types = draft.relationships.map((relationship) => relationship.type);
    expect(types).toContain("FEATURE_SOLVES_PROBLEM");
    expect(types).toContain("FEATURE_PROVIDES_BENEFIT");
    expect(types).toContain("WORKFLOW_USES_FEATURE");
  });
});
