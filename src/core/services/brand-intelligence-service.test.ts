import { describe, expect, it, vi } from "vitest";
import { BrandIntelligenceService } from "./brand-intelligence-service";
import {
  BrandError,
  emptyBrandProfile,
  type BrandProfile,
  type BrandSourceState,
} from "../domain/brand";
import {
  BrandAnalyzerRegistry,
  emptyBrandAnalyzerResult,
  type BrandAnalyzerInput,
  type BrandAnalyzerResult,
  type BrandEvidenceDraft,
} from "../ports/brand-analyzer";
import { brandEvidenceKey } from "../../lib/brand-normalization";
import { CreativeBrandAnalyzer } from "../../infrastructure/brand/creative-brand-analyzer";
import type { BrandSourceStateValues, UpdateBrandInput } from "../ports/brand-repository";
import type { EvidenceValues, IntelligenceRepository } from "../ports/intelligence-repository";
import type { Source } from "../domain/source";
import type { Asset } from "../domain/asset";
import type { BrandSignal, Evidence } from "../domain/intelligence";
import type {
  BrandInterpretationProvider,
  BrandInterpretationRequest,
  BrandInterpretationResult,
} from "../ports/brand-interpretation-provider";

const USER_ID = "usr_1";
const PROJECT_ID = "prj_1";
const NOW = "2026-02-01T00:00:00.000Z";

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: "src_1",
    projectId: PROJECT_ID,
    type: "WEBSITE",
    name: "Acme",
    uri: "https://acme.test",
    metadata: null,
    status: "READY",
    mimeType: "text/html",
    sizeBytes: 100,
    contentHash: "hash_1",
    storageKey: "key_1",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "ast_1",
    projectId: PROJECT_ID,
    type: "LOGO",
    name: "acme-primary-logo.svg",
    uri: "https://cdn.test/acme-primary-logo.svg",
    metadata: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

class FakeBrandRepository {
  profiles = new Map<string, BrandProfile>();
  states: BrandSourceStateValues[] = [];
  saves = 0;
  updates = 0;

  save(_projectId: string, profile: BrandProfile): Promise<BrandProfile> {
    this.saves += 1;
    this.profiles.set(profile.projectId, profile);
    return Promise.resolve(profile);
  }

  update(projectId: string, profile: BrandProfile): Promise<BrandProfile> {
    this.updates += 1;
    this.profiles.set(projectId, profile);
    return Promise.resolve(profile);
  }

  getByProjectId(projectId: string): Promise<BrandProfile | null> {
    return Promise.resolve(this.profiles.get(projectId) ?? null);
  }

  setLocked(projectId: string, locked: boolean, updatedAt: string): Promise<BrandProfile | null> {
    const profile = this.profiles.get(projectId);
    if (!profile) return Promise.resolve(null);
    const next = { ...profile, locked, updatedAt };
    this.profiles.set(projectId, next);
    return Promise.resolve(next);
  }

  listSourceStates(projectId: string): Promise<BrandSourceState[]> {
    void projectId;
    return Promise.resolve(this.states);
  }

  saveSourceStates(_projectId: string, states: BrandSourceStateValues[]): Promise<void> {
    for (const state of states) {
      this.states = this.states.filter((item) => item.sourceId !== state.sourceId);
      this.states.push(state);
    }
    return Promise.resolve();
  }

  deleteByProjectId(projectId: string): Promise<void> {
    this.profiles.delete(projectId);
    this.states = [];
    return Promise.resolve();
  }
}

class FakeIntelligence {
  /** Makes the evidence read fail, the way an unavailable store would. */
  failEvidenceRead = false;
  readonly recorded: EvidenceValues[] = [];
  stored: Evidence[] = [];
  readonly brandSignals: BrandSignal[] = [];

  readonly repository: Pick<
    IntelligenceRepository,
    "recordEvidence" | "listEvidence" | "listBrandSignals"
  > = {
    recordEvidence: async (projectId, values) => {
      this.recorded.push(...values);
      // The real store keeps these rows, and a later analysis needs them to
      // tell which source produced a stored value.
      for (const value of values) {
        const existing = this.stored.find((item) => item.id === value.id);
        const row = {
          projectId,
          createdAt: "2026-01-01T00:00:00.000Z",
          ...value,
        };
        if (existing) Object.assign(existing, row);
        else this.stored.push(row);
      }
    },
    listEvidence: async () => {
      if (this.failEvidenceRead) throw new Error("evidence store unavailable");
      return [...this.stored];
    },
    listBrandSignals: async () => this.brandSignals,
  };
}

/**
 * A website analysis rich enough to read as a real brand: identity, narrative,
 * color, typography and language. That is what a READY profile is measured on.
 */
function websiteResult(): BrandAnalyzerResult {
  const result = emptyBrandAnalyzerResult();

  const titleKey = brandEvidenceKey("src_1", "URL_SECTION", "html:title");
  result.evidence.push(draft(titleKey, "src_1", "URL_SECTION", "html:title", "Acme"));
  result.text.push({
    field: "name",
    value: "Acme",
    confidence: "HIGH",
    origin: "EXTRACTED",
    basis: "GENERAL_EXTRACTION",
    evidenceKeys: [titleKey],
  });

  const metaKey = brandEvidenceKey("src_1", "EXTRACTED_METADATA", "html:meta:description");
  result.evidence.push(
    draft(
      metaKey,
      "src_1",
      "EXTRACTED_METADATA",
      "html:meta:description",
      "The content operating system for regulated teams",
    ),
  );
  result.text.push({
    field: "positioning",
    value: "The content operating system for regulated teams",
    confidence: "MEDIUM",
    origin: "EXTRACTED",
    basis: "GENERAL_EXTRACTION",
    evidenceKeys: [metaKey],
  });

  const tokenKey = brandEvidenceKey("src_1", "SOURCE_FRAGMENT", "html:css:brand-primary");
  result.evidence.push(
    draft(tokenKey, "src_1", "SOURCE_FRAGMENT", "html:css:brand-primary", "--brand-primary: #4f46e5"),
  );
  result.colors.push({
    role: "PRIMARY",
    name: "Brand primary",
    hex: "#4f46e5",
    confidence: "HIGH",
    origin: "EXTRACTED",
    basis: "DESIGN_TOKEN",
    evidenceKeys: [tokenKey],
  });

  const fontKey = brandEvidenceKey("src_1", "SOURCE_FRAGMENT", "html:font:heading");
  result.evidence.push(
    draft(fontKey, "src_1", "SOURCE_FRAGMENT", "html:font:heading", "font-family: Inter, sans-serif"),
  );
  result.fonts.push({
    role: "HEADING",
    family: "Inter",
    confidence: "HIGH",
    origin: "EXTRACTED",
    basis: "DESIGN_TOKEN",
    evidenceKeys: [fontKey],
  });

  const termKey = brandEvidenceKey("src_1", "SOURCE_FRAGMENT", "text:line:3");
  result.evidence.push(draft(termKey, "src_1", "SOURCE_FRAGMENT", "text:line:3", "content operations"));
  result.terms.push({
    term: "content operations",
    category: "INDUSTRY_TERM",
    preference: "PREFERRED",
    confidence: "MEDIUM",
    origin: "EXTRACTED",
    basis: "GENERAL_EXTRACTION",
    evidenceKeys: [termKey],
  });

  const voiceKey = brandEvidenceKey("src_1", "SOURCE_FRAGMENT", "text:line:5");
  result.evidence.push(
    draft(voiceKey, "src_1", "SOURCE_FRAGMENT", "text:line:5", "confident, plain spoken"),
  );
  result.voiceSignals.push({
    kind: "TONE",
    value: "confident",
    confidence: "MEDIUM",
    origin: "EXTRACTED",
    basis: "RECOGNIZED_ASSET",
    evidenceKeys: [voiceKey],
  });

  const guidelineKey = brandEvidenceKey("src_1", "SOURCE_FRAGMENT", "text:line:9");
  result.evidence.push(
    draft(guidelineKey, "src_1", "SOURCE_FRAGMENT", "text:line:9", "Lead with the compliance benefit"),
  );
  result.guidelines.push({
    title: "Lead with the compliance benefit",
    detail: "Every landing page opens with the audit outcome, not the feature list.",
    origin: "EXTRACTED",
    basis: "EXPLICIT_GUIDELINE",
    evidenceKeys: [guidelineKey],
  });

  return result;
}

/** Name plus positioning only: enough to be useful, too thin to be READY. */
function sparseResult(): BrandAnalyzerResult {
  const result = emptyBrandAnalyzerResult();
  const key = brandEvidenceKey("src_1", "URL_SECTION", "html:title");
  result.evidence.push(draft(key, "src_1", "URL_SECTION", "html:title", "Acme"));
  result.text.push({
    field: "name",
    value: "Acme",
    confidence: "HIGH",
    origin: "EXTRACTED",
    basis: "GENERAL_EXTRACTION",
    evidenceKeys: [key],
  });
  result.text.push({
    field: "positioning",
    value: "Content operations for regulated teams",
    confidence: "LOW",
    origin: "EXTRACTED",
    basis: "GENERAL_EXTRACTION",
    evidenceKeys: [key],
  });
  return result;
}

function draft(
  key: string,
  sourceId: string,
  kind: BrandEvidenceDraft["kind"],
  locator: string,
  excerpt: string,
): BrandEvidenceDraft {
  return { key, sourceId, kind, locator, excerpt, metadata: null };
}

function colorOnly(
  hex: string,
  basis: "DESIGN_TOKEN" | "GENERAL_EXTRACTION",
  sourceId = "src_1",
): BrandAnalyzerResult {
  const result = emptyBrandAnalyzerResult();
  const key = brandEvidenceKey(sourceId, "SOURCE_FRAGMENT", `html:css:${hex}`);
  result.evidence.push(draft(key, sourceId, "SOURCE_FRAGMENT", `html:css:${hex}`, hex));
  result.colors.push({
    role: "PRIMARY",
    name: `Brand color ${hex}`,
    hex,
    confidence: basis === "DESIGN_TOKEN" ? "HIGH" : "LOW",
    origin: "EXTRACTED",
    basis,
    evidenceKeys: [key],
  });
  return result;
}

type AnalyzerStub = {
  id: string;
  supports: (input: BrandAnalyzerInput) => boolean;
  analyze: (input: BrandAnalyzerInput) => Promise<BrandAnalyzerResult>;
};

function buildService(options: {
  analyzer?: AnalyzerStub;
  repository?: FakeBrandRepository;
  intelligence?: FakeIntelligence;
  interpretationProvider?: BrandInterpretationProvider | null;
  sources?: Source[];
  assets?: Asset[];
}) {
  const repository = options.repository ?? new FakeBrandRepository();
  const intelligence = options.intelligence ?? new FakeIntelligence();
  const sources = options.sources ?? [source()];
  const analyzer: AnalyzerStub = options.analyzer ?? {
    id: "brand-website",
    supports: (input) => input.source !== null,
    analyze: async () => websiteResult(),
  };

  const service = new BrandIntelligenceService({
    projectService: {
      getAuthorized: async () => ({ id: PROJECT_ID, name: "Acme", status: "ACTIVE" }) as never,
    },
    sourceRepository: { listByProject: async () => sources },
    assetRepository: { listByProject: async () => options.assets ?? [] },
    storageProvider: { get: async () => new TextEncoder().encode("<html></html>") },
    analyzers: new BrandAnalyzerRegistry([analyzer, new CreativeBrandAnalyzer()]),
    repository,
    intelligence: intelligence.repository,
    interpretationProvider: options.interpretationProvider ?? null,
    now: () => new Date(NOW),
    createId: (prefix) => `${prefix}_test`,
  });

  return { service, repository, intelligence, sources };
}

/**
 * Mirrors how the real analyzers divide work: a source analyzer claims a source,
 * and the asset pass falls through to the creative analyzer because the source
 * analyzer declines an input that carries no source.
 */
function updatingAnalyzer(analyze: AnalyzerStub["analyze"], id = "brand-website"): AnalyzerStub {
  return { id, supports: (input) => input.source !== null, analyze };
}

describe("BrandIntelligenceService analysis", () => {
  it("builds a ready profile from a website alone and never needs AI", async () => {
    const { service, repository } = buildService({});

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.profile.name).toBe("Acme");
    expect(report.profile.positioning).toBe("The content operating system for regulated teams");
    expect(report.profile.status).toBe("READY");
    expect(report.profile.confidence).toBe("HIGH");
    expect(report.profile.version).toBe(1);
    expect(report.aiApplied).toBe(false);
    expect(report.notes.join(" ")).toContain("AI interpretation disabled");
    expect(repository.saves).toBe(1);
  });

  it("stays usable but draft when the sources only yield identity and narrative", async () => {
    const { service } = buildService({
      analyzer: updatingAnalyzer(async () => sparseResult()),
    });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.profile.name).toBe("Acme");
    expect(report.profile.positioning).toBe("Content operations for regulated teams");
    expect(report.profile.status).toBe("DRAFT");
  });

  it("records evidence through the CP06 evidence table with real source ids", async () => {
    const { service, intelligence } = buildService({});

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(intelligence.recorded.length).toBeGreaterThan(0);
    for (const value of intelligence.recorded) {
      expect(value.sourceId).toBe("src_1");
      expect(value.excerpt).toBeTruthy();
    }
    expect(report.profile.textOrigins.name).toBe("EXTRACTED");
  });

  it("never records evidence against a source the project does not own", async () => {
    const rogue: AnalyzerStub = {
      id: "brand-rogue",
      supports: (input) => input.source !== null,
      analyze: async () => {
        const result = emptyBrandAnalyzerResult();
        result.evidence.push(
          draft("rogue:1", "prj_other", "SOURCE_FRAGMENT", "x", "leaked"),
        );
        return result;
      },
    };
    const { service, intelligence } = buildService({ analyzer: rogue });

    await service.analyze(PROJECT_ID, USER_ID);

    expect(intelligence.recorded).toHaveLength(0);
  });

  it("refuses to analyze a project with no readable source", async () => {
    const { service } = buildService({ sources: [source({ status: "FAILED" })] });

    await expect(service.analyze(PROJECT_ID, USER_ID)).rejects.toMatchObject({
      code: "BRAND_NO_SOURCES",
    });
  });

  it("leaves a source unmarked when no analyzer can read it", async () => {
    const { service, repository } = buildService({
      analyzer: {
        id: "brand-website",
        supports: () => false,
        analyze: async () => emptyBrandAnalyzerResult(),
      },
    });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.notes.join(" ")).toContain("No brand analyzer supports");
    expect(repository.states).toHaveLength(0);
  });

  it("records the analyzer that actually produced the state", async () => {
    const { service, repository } = buildService({
      analyzer: updatingAnalyzer(async () => websiteResult(), "brand-creative"),
    });

    await service.analyze(PROJECT_ID, USER_ID);

    expect(repository.states[0]?.analyzerId).toBe("brand-creative");
  });

  it("classifies uploaded assets without inventing an evidence source", async () => {
    const { service, intelligence } = buildService({
      assets: [asset()],
    });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.profile.assets[0]?.assetId).toBe("ast_1");
    expect(report.profile.assets[0]?.role).toBe("PRIMARY_LOGO");
    for (const value of intelligence.recorded) expect(value.sourceId).toBe("src_1");
  });

  it("carries CP06 brand signals in as the weakest rank", async () => {
    const intelligence = new FakeIntelligence();
    intelligence.brandSignals.push({
      id: "bs_1",
      projectId: PROJECT_ID,
      kind: "COLOR",
      label: "Primary color",
      value: "#0ea5e9",
      confidence: "HIGH",
      assertionKind: "INFERENCE",
      userLocked: false,
      canonicalKey: "color:primary",
      provenance: {
        sourceIds: ["src_1"],
        evidenceIds: ["evd_1"],
        method: "DETERMINISTIC",
        extractedAt: "2026-01-01T00:00:00.000Z",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const { service } = buildService({ intelligence });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    const carried = report.profile.colors.find((color) => color.hex === "#0ea5e9");
    expect(carried?.origin).toBe("EXTRACTED");
    expect(carried?.evidenceIds).toEqual(["evd_1"]);
  });
});

describe("BrandIntelligenceService precedence and conflicts", () => {
  it("prefers a design token over a weaker extraction of the same color", async () => {
    let call = 0;
    const { service } = buildService({
      analyzer: updatingAnalyzer(async () => {
        call += 1;
        return call === 1
          ? colorOnly("#4f46e5", "GENERAL_EXTRACTION")
          : colorOnly("#4f46e5", "DESIGN_TOKEN");
      }),
    });

    const first = await service.analyze(PROJECT_ID, USER_ID);
    expect(first.profile.colors[0]?.confidence).toBe("LOW");

    const reanalyzed = await service.analyze(PROJECT_ID, USER_ID, { force: true });
    const color = reanalyzed.profile.colors.find((entry) => entry.hex === "#4f46e5");
    expect(color?.confidence).toBe("HIGH");
    expect(reanalyzed.profile.conflicts).toHaveLength(0);
  });

  it("keeps two competing primaries and reports the disagreement", async () => {
    // Two sources that each name their own primary. A re-read replaces what a
    // source said last time, but it must not silence the other source, or the
    // profile would quietly pick a winner instead of reporting a disagreement.
    const { service } = buildService({
      sources: [
        source({ id: "src_1", contentHash: "hash_1" }),
        source({
          id: "src_2",
          name: "Design tokens",
          uri: "https://acme.test/tokens.json",
          type: "TEXT",
          mimeType: "application/json",
          contentHash: "hash_2",
          storageKey: "key_2",
        }),
      ],
      analyzer: updatingAnalyzer(async (input) =>
        colorOnly(input.source?.id === "src_2" ? "#111111" : "#4f46e5", "DESIGN_TOKEN", input.source?.id ?? "src_1"),
      ),
    });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.profile.colors).toHaveLength(2);
    expect(report.profile.conflicts).toHaveLength(1);
    expect(report.profile.conflicts[0]?.field).toBe("color:primary");
    expect(report.profile.conflicts[0]?.retained).toBe("#4f46e5");
    expect(report.profile.conflicts[0]?.competing).toBe("#111111");
    expect(report.profile.conflicts[0]?.resolvedBy).toBe("DESIGN_TOKEN");
  });

  it("reports a term both preferred and avoided", async () => {
    const termResult = (preference: "PREFERRED" | "AVOID", sourceId: string): BrandAnalyzerResult => {
      const result = emptyBrandAnalyzerResult();
      const key = brandEvidenceKey(sourceId, "SOURCE_FRAGMENT", "text:vocabulary");
      result.evidence.push(draft(key, sourceId, "SOURCE_FRAGMENT", "text:vocabulary", "content operations"));
      result.terms.push({
        term: "content operations",
        category: "FEATURE",
        preference,
        confidence: "MEDIUM",
        origin: "EXTRACTED",
        basis: preference === "AVOID" ? "EXPLICIT_GUIDELINE" : "GENERAL_EXTRACTION",
        evidenceKeys: [key],
        notes: null,
      });
      return result;
    };

    const { service } = buildService({
      sources: [
        source({ id: "src_1", contentHash: "hash_1" }),
        source({
          id: "src_2",
          name: "Voice guide",
          uri: null,
          type: "TEXT",
          mimeType: "text/plain",
          contentHash: "hash_2",
          storageKey: "key_2",
        }),
      ],
      analyzer: updatingAnalyzer(async (input) =>
        input.source?.id === "src_2"
          ? termResult("AVOID", "src_2")
          : termResult("PREFERRED", "src_1"),
      ),
    });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.profile.conflicts.some((conflict) => conflict.field === "term:content operations")).toBe(true);
  });
});

describe("BrandIntelligenceService user corrections", () => {
  it("keeps a user correction across a refresh", async () => {
    const { service, repository } = buildService({});

    await service.analyze(PROJECT_ID, USER_ID);
    const updated = await service.update(PROJECT_ID, USER_ID, {
      name: "Acme Holdings",
      colors: [{ name: "Ink", hex: "#101010", role: "TEXT" }],
    });

    expect(updated.name).toBe("Acme Holdings");
    expect(updated.textOrigins.name).toBe("USER");
    expect(updated.colors.find((color) => color.hex === "#101010")?.origin).toBe("USER");

    // Nothing changed upstream, so a refresh rewrites nothing at all.
    const unchanged = await service.refresh(PROJECT_ID, USER_ID);
    expect(unchanged.skipped).toBe("UP_TO_DATE");
    expect(unchanged.profile.version).toBe(1);

    const report = await service.analyze(PROJECT_ID, USER_ID, { force: true });
    expect(report.profile.name).toBe("Acme Holdings");
    expect(report.profile.textOrigins.name).toBe("USER");
    expect(report.profile.positioning).toBe("The content operating system for regulated teams");
    expect(report.profile.version).toBe(2);
    expect(repository.updates).toBeGreaterThan(0);
  });

  it("keeps the value a user displaced in the same slot visible as a conflict", async () => {
    const { service } = buildService({ analyzer: updatingAnalyzer(async () => colorOnly("#4f46e5", "DESIGN_TOKEN")) });

    await service.analyze(PROJECT_ID, USER_ID);
    const updated = await service.update(PROJECT_ID, USER_ID, {
      colors: [{ name: "Ink", hex: "#111111", role: "PRIMARY" }],
    });

    expect(updated.colors.map((color) => color.hex)).toEqual(["#111111"]);

    const conflict = updated.conflicts.find((item) => item.field === "color:primary");
    expect(conflict?.retained).toContain("#111111");
    expect(conflict?.competing).toContain("#4f46e5");
    expect(conflict?.resolvedBy).toBe("USER");
    // The displaced value carried evidence, so the conflict must point at it.
    expect(conflict?.evidenceIds.length).toBeGreaterThan(0);
  });

  it("keeps a recorded conflict when an unrelated field is edited next", async () => {
    const { service } = buildService({ analyzer: updatingAnalyzer(async () => colorOnly("#4f46e5", "DESIGN_TOKEN")) });

    await service.analyze(PROJECT_ID, USER_ID);
    const paletteEdit = await service.update(PROJECT_ID, USER_ID, {
      colors: [{ name: "Ink", hex: "#111111", role: "PRIMARY" }],
    });
    expect(paletteEdit.conflicts.map((item) => item.field)).toEqual(["color:primary"]);

    // The name edit replaces nothing, but the displaced color is no longer an
    // entry, so recomputing from entries alone would quietly forget the clash.
    const nameEdit = await service.update(PROJECT_ID, USER_ID, { name: "Acme Holdings" });

    const conflict = nameEdit.conflicts.find((item) => item.field === "color:primary");
    expect(conflict?.retained).toContain("#111111");
    expect(conflict?.competing).toContain("#4f46e5");
    expect(conflict?.resolvedBy).toBe("USER");
  });

  it("refuses to edit a locked profile", async () => {
    const { service } = buildService({});

    await service.analyze(PROJECT_ID, USER_ID);
    await service.setLock(PROJECT_ID, USER_ID, true);

    await expect(
      service.update(PROJECT_ID, USER_ID, { name: "Something else" }),
    ).rejects.toMatchObject({ code: "BRAND_LOCKED" });
    await expect(
      service.update(PROJECT_ID, USER_ID, {
        colors: [{ name: "Ink", hex: "#111111", role: "PRIMARY" }],
      }),
    ).rejects.toMatchObject({ code: "BRAND_LOCKED" });
  });

  it("retracts an extracted value a re-read no longer supports", async () => {
    let round = 0;
    const { service } = buildService({
      analyzer: updatingAnalyzer(async () => {
        round += 1;
        return round === 1
          ? colorOnly("#1d4ed8", "DESIGN_TOKEN")
          : emptyBrandAnalyzerResult();
      }),
    });

    const first = await service.analyze(PROJECT_ID, USER_ID);
    expect(first.profile.colors.map((color) => color.hex)).toEqual(["#1d4ed8"]);

    // Force a re-read with the document unchanged. The analyzer no longer finds
    // the color, so keeping the stored copy would leave a value in the profile
    // that nothing in the source supports.
    const reread = await service.analyze(PROJECT_ID, USER_ID, { force: true });
    expect(reread.profile.colors).toHaveLength(0);
  });

  it("re-reads a source whose recorded analyzer revision is out of date", async () => {
    const analyzeSpy = vi.fn(async () => websiteResult());
    const { service, repository } = buildService({ analyzer: updatingAnalyzer(analyzeSpy) });

    await service.analyze(PROJECT_ID, USER_ID);
    expect(analyzeSpy).toHaveBeenCalledTimes(1);

    // Pretend the profile was last read by an earlier version of the analyzer.
    const states = await repository.listSourceStates(PROJECT_ID);
    await repository.saveSourceStates(
      PROJECT_ID,
      states.map((state) => ({ ...state, analyzerRevision: "an-ancient-revision" })),
    );

    const afterUpgrade = await service.analyze(PROJECT_ID, USER_ID);
    // An extraction fix has to reach profiles whose documents never changed.
    expect(afterUpgrade.skipped).toBe("NONE");
    expect(analyzeSpy).toHaveBeenCalledTimes(2);
  });

  it("retracts a value whose source was deleted", async () => {
    let round = 0;
    const intelligence = new FakeIntelligence();
    const { service } = buildService({
      intelligence,
      analyzer: updatingAnalyzer(async () => {
        round += 1;
        return round === 1
          ? colorOnly("#1d4ed8", "DESIGN_TOKEN")
          : emptyBrandAnalyzerResult();
      }),
    });

    await service.analyze(PROJECT_ID, USER_ID);
    expect((await service.getProfile(PROJECT_ID, USER_ID)).profile?.colors).toHaveLength(1);

    // Deleting a source deletes its evidence rows. A value whose evidence is
    // gone has lost its basis, so it must not outlive the document.
    intelligence.stored.length = 0;
    const reread = await service.analyze(PROJECT_ID, USER_ID, { force: true });
    expect(reread.profile.colors).toHaveLength(0);
  });

  it("does not report up to date when a value has lost its source", async () => {
    let round = 0;
    const intelligence = new FakeIntelligence();
    const { service } = buildService({
      intelligence,
      analyzer: updatingAnalyzer(async () => {
        round += 1;
        return round === 1
          ? colorOnly("#1d4ed8", "DESIGN_TOKEN")
          : emptyBrandAnalyzerResult();
      }),
    });

    await service.analyze(PROJECT_ID, USER_ID);
    expect((await service.refresh(PROJECT_ID, USER_ID)).skipped).toBe("UP_TO_DATE");

    intelligence.stored.length = 0;

    // Deleting a source deletes its evidence. The document is unchanged, so
    // nothing looks stale, but the profile is no longer up to date: it still
    // holds a value nothing supports.
    const afterDeletion = await service.refresh(PROJECT_ID, USER_ID);
    expect(afterDeletion.skipped).toBe("NONE");
    expect(afterDeletion.profile.colors).toHaveLength(0);
  });

  it("recomputes from the surviving sources after one is deleted", async () => {
    const repository = new FakeBrandRepository();
    const intelligence = new FakeIntelligence();
    const both = buildService({
      repository,
      intelligence,
      sources: [source(), source({ id: "src_2", name: "Design tokens", contentHash: "hash_2" })],
      analyzer: updatingAnalyzer(async (input) =>
        colorOnly(input.source?.id === "src_2" ? "#111111" : "#1d4ed8", "DESIGN_TOKEN", input.source?.id ?? "src_1"),
      ),
    });
    await both.service.analyze(PROJECT_ID, USER_ID);
    expect((await both.service.getProfile(PROJECT_ID, USER_ID)).profile?.colors).toHaveLength(2);

    // The second source is deleted, taking its evidence rows with it, which is
    // what the store does on delete. Retracting the orphaned value is not enough
    // on its own: the profile has to be read again from what is left, or it
    // would end up describing only the deletion.
    intelligence.stored = intelligence.stored.filter((item) => item.sourceId !== "src_2");

    const surviving = buildService({
      repository,
      intelligence,
      sources: [source()],
      analyzer: updatingAnalyzer(async () => colorOnly("#1d4ed8", "DESIGN_TOKEN")),
    });

    const after = await surviving.service.refresh(PROJECT_ID, USER_ID);
    expect(after.skipped).toBe("NONE");
    expect(after.profile.colors.map((color) => color.hex)).toEqual(["#1d4ed8"]);
  });

  it("keeps the profile when the evidence read fails", async () => {
    const intelligence = new FakeIntelligence();
    const { service } = buildService({
      intelligence,
      analyzer: updatingAnalyzer(async () => colorOnly("#1d4ed8", "DESIGN_TOKEN")),
    });

    await service.analyze(PROJECT_ID, USER_ID);
    expect((await service.getProfile(PROJECT_ID, USER_ID)).profile?.colors).toHaveLength(1);

    // A repository that cannot be read is not a project without evidence.
    // Retracting on this alone would empty every profile whenever the store
    // hiccups.
    intelligence.failEvidenceRead = true;

    const afterFailure = await service.refresh(PROJECT_ID, USER_ID);
    expect(afterFailure.profile.colors.map((color) => color.hex)).toEqual(["#1d4ed8"]);
  });

  it("keeps a user correction through a re-read that retracts the old value", async () => {
    let round = 0;
    const { service } = buildService({
      analyzer: updatingAnalyzer(async () => {
        round += 1;
        return round === 1
          ? colorOnly("#1d4ed8", "DESIGN_TOKEN")
          : emptyBrandAnalyzerResult();
      }),
    });

    await service.analyze(PROJECT_ID, USER_ID);
    const corrected = await service.update(PROJECT_ID, USER_ID, {
      colors: [{ name: "Ink", hex: "#0b1220", role: "PRIMARY" }],
    });
    expect(corrected.colors.map((color) => color.hex)).toEqual(["#0b1220"]);

    const reread = await service.analyze(PROJECT_ID, USER_ID, { force: true });
    // The user asserted this value; a re-read retracts readings, not assertions.
    expect(reread.profile.colors.map((color) => color.hex)).toEqual(["#0b1220"]);
    expect(reread.profile.colors[0]?.origin).toBe("USER");
  });

  it("does not record a conflict for a slot the user left alone", async () => {
    const { service } = buildService({ analyzer: updatingAnalyzer(async () => colorOnly("#4f46e5", "DESIGN_TOKEN")) });

    await service.analyze(PROJECT_ID, USER_ID);
    const updated = await service.update(PROJECT_ID, USER_ID, { name: "Acme Holdings" });

    expect(updated.conflicts).toHaveLength(0);
  });

  it("replaces only the sections a patch carries", async () => {
    const { service } = buildService({});

    await service.analyze(PROJECT_ID, USER_ID);
    await service.update(PROJECT_ID, USER_ID, {
      colors: [
        { name: "Ink", hex: "#101010", role: "TEXT" },
        { name: "Paper", hex: "#fefefe", role: "BACKGROUND" },
      ],
      terms: [{ term: "governance", category: "INDUSTRY_TERM", preference: "PREFERRED" }],
    });

    const afterTermEdit = await service.update(PROJECT_ID, USER_ID, {
      terms: [{ term: "audit trail", category: "INDUSTRY_TERM", preference: "PREFERRED" }],
    });

    expect(afterTermEdit.terms.map((term) => term.term)).toEqual(["audit trail"]);
    expect(afterTermEdit.colors).toHaveLength(2);
    expect(afterTermEdit.colors.every((color) => color.origin === "USER")).toBe(true);
    expect(afterTermEdit.version).toBe(1);
  });

  it("keeps a detected text field when a user clears one they never touched", async () => {
    const { service } = buildService({});

    await service.analyze(PROJECT_ID, USER_ID);
    const cleared = await service.update(PROJECT_ID, USER_ID, { name: null });

    expect(cleared.name).toBe("Acme");
    expect(cleared.textOrigins.name).toBe("EXTRACTED");
  });

  it("empties an override on clear and brings the detected value back on refresh", async () => {
    const { service } = buildService({});

    await service.analyze(PROJECT_ID, USER_ID);
    await service.update(PROJECT_ID, USER_ID, { name: "Acme Holdings" });
    const cleared = await service.update(PROJECT_ID, USER_ID, { name: null });

    expect(cleared.name).toBeNull();
    expect(cleared.textOrigins.name).toBeUndefined();

    // The detected value lives in the source, not in the profile, so it can
    // only return once the source is read again.
    const unchanged = await service.refresh(PROJECT_ID, USER_ID);
    expect(unchanged.skipped).toBe("UP_TO_DATE");
    expect(unchanged.profile.name).toBeNull();

    const reanalyzed = await service.analyze(PROJECT_ID, USER_ID, { force: true });
    expect(reanalyzed.profile.name).toBe("Acme");
    expect(reanalyzed.profile.textOrigins.name).toBe("EXTRACTED");
  });

  it("rejects an invalid user color instead of storing it", async () => {
    const { service } = buildService({});
    await service.analyze(PROJECT_ID, USER_ID);

    await expect(
      service.update(PROJECT_ID, USER_ID, {
        colors: [{ name: "Nope", hex: "#fff", role: "PRIMARY" }],
      } as UpdateBrandInput),
    ).rejects.toBeInstanceOf(BrandError);
  });

  it("rejects a user edit before a profile exists", async () => {
    const { service } = buildService({});
    await expect(service.update(PROJECT_ID, USER_ID, { name: "x" })).rejects.toMatchObject({
      code: "BRAND_NOT_FOUND",
    });
  });
});

describe("BrandIntelligenceService locking", () => {
  it("records evidence while locked but leaves the canonical profile alone", async () => {
    const { service, repository, intelligence } = buildService({});

    await service.analyze(PROJECT_ID, USER_ID);
    await service.setLock(PROJECT_ID, USER_ID, true);
    const updatesBefore = repository.updates;
    intelligence.recorded.length = 0;

    const report = await service.analyze(PROJECT_ID, USER_ID, { force: true });

    expect(report.skipped).toBe("LOCKED");
    expect(report.profile.locked).toBe(true);
    expect(report.profile.version).toBe(1);
    expect(report.profile.name).toBe("Acme");
    expect(repository.updates).toBe(updatesBefore);
    expect(intelligence.recorded.length).toBeGreaterThan(0);
  });

  it("keeps a user correction while locked", async () => {
    const { service } = buildService({});

    await service.analyze(PROJECT_ID, USER_ID);
    await service.update(PROJECT_ID, USER_ID, { name: "Acme Holdings" });
    await service.setLock(PROJECT_ID, USER_ID, true);
    const report = await service.analyze(PROJECT_ID, USER_ID, { force: true });

    expect(report.skipped).toBe("LOCKED");
    expect(report.profile.name).toBe("Acme Holdings");
  });

  it("rejects locking a project without a brand", async () => {
    const { service } = buildService({});
    await expect(service.setLock(PROJECT_ID, USER_ID, true)).rejects.toMatchObject({
      code: "BRAND_NOT_FOUND",
    });
  });
});

describe("BrandIntelligenceService incremental analysis", () => {
  it("skips unchanged sources on both analyze and refresh, and re-runs on force", async () => {
    const analyzeSpy = vi.fn(async () => websiteResult());
    const { service } = buildService({ analyzer: updatingAnalyzer(analyzeSpy) });

    await service.analyze(PROJECT_ID, USER_ID);
    expect(analyzeSpy).toHaveBeenCalledTimes(1);

    const second = await service.analyze(PROJECT_ID, USER_ID);
    expect(second.skipped).toBe("UP_TO_DATE");
    expect(second.profile.version).toBe(1);
    expect(analyzeSpy).toHaveBeenCalledTimes(1);

    // A refresh is incremental: it re-reads only new or changed sources, so a
    // scheduled refresh cannot rewrite an unchanged profile.
    const refreshed = await service.refresh(PROJECT_ID, USER_ID);
    expect(refreshed.skipped).toBe("UP_TO_DATE");
    expect(refreshed.profile.version).toBe(1);
    expect(analyzeSpy).toHaveBeenCalledTimes(1);

    const forced = await service.analyze(PROJECT_ID, USER_ID, { force: true });
    expect(forced.profile.version).toBe(2);
    expect(analyzeSpy).toHaveBeenCalledTimes(2);
  });

  it("re-analyzes only the source whose content changed", async () => {
    const repository = new FakeBrandRepository();
    const intelligence = new FakeIntelligence();
    const first = buildService({
      repository,
      intelligence,
      sources: [source(), source({ id: "src_2", name: "Acme docs", contentHash: "hash_2" })],
    });
    await first.service.analyze(PROJECT_ID, USER_ID);

    const seenSources: (string | undefined)[] = [];
    const spy = vi.fn(async (input: BrandAnalyzerInput) => {
      seenSources.push(input.source?.id);
      return websiteResult();
    });
    const changed = buildService({
      repository,
      intelligence,
      sources: [source(), source({ id: "src_2", name: "Acme docs", contentHash: "hash_changed" })],
      analyzer: updatingAnalyzer(spy),
    });
    const report = await changed.service.analyze(PROJECT_ID, USER_ID);

    expect(seenSources).toEqual(["src_2"]);
    expect(report.analyzedSourceIds).toEqual(["src_2"]);
  });

  it("marks a profile stale when a source changes after analysis", async () => {
    const repository = new FakeBrandRepository();
    const first = buildService({ repository });
    await first.service.analyze(PROJECT_ID, USER_ID);

    const changed = buildService({
      repository,
      sources: [source({ contentHash: "hash_changed" })],
    });
    const view = await changed.service.getProfile(PROJECT_ID, USER_ID);

    expect(view.profile?.status).toBe("STALE");
    expect(view.execution?.status).toBe("STALE");
  });

  it("does not treat a failed source as making the brand stale", async () => {
    const repository = new FakeBrandRepository();
    const intelligence = new FakeIntelligence();
    const first = buildService({ repository, intelligence });
    await first.service.analyze(PROJECT_ID, USER_ID);

    const broken = buildService({
      repository,
      intelligence,
      sources: [source(), source({ id: "src_2", status: "FAILED" })],
    });
    const view = await broken.service.getProfile(PROJECT_ID, USER_ID);

    expect(view.profile?.status).toBe("READY");
  });

  it("returns no profile for a project that was never analyzed", async () => {
    const { service } = buildService({});
    const view = await service.getProfile(PROJECT_ID, USER_ID);
    expect(view.profile).toBeNull();
    expect(view.execution).toBeNull();
  });
});

describe("BrandIntelligenceService AI interpretation", () => {
  const evidenceKey = brandEvidenceKey("src_1", "URL_SECTION", "html:title");

  function interpretingProvider(
    build: (request: BrandInterpretationRequest) => BrandInterpretationResult,
  ): BrandInterpretationProvider {
    return { id: "fake", interpret: async (request) => build(request) };
  }

  it("accepts evidence-backed voice and keeps deterministic facts out of reach", async () => {
    const { service } = buildService({
      interpretationProvider: interpretingProvider(() => ({
        provider: "fake",
        model: "fake-1",
        text: [
          {
            field: "voiceSummary",
            value: "Plain spoken and confident.",
            confidence: "MEDIUM",
            evidenceKeys: [evidenceKey],
          },
        ],
        voiceSignals: [
          { kind: "TONE", value: "confident", confidence: "MEDIUM", evidenceKeys: [evidenceKey] },
        ],
        terms: [
          {
            term: "governance",
            category: "INDUSTRY_TERM",
            preference: "PREFERRED",
            confidence: "LOW",
            evidenceKeys: [evidenceKey],
          },
        ],
        notes: [],
      })),
    });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.aiApplied).toBe(true);
    expect(report.profile.voiceSummary).toBe("Plain spoken and confident.");
    expect(report.profile.textOrigins.voiceSummary).toBe("INFERRED");
    expect(report.profile.textOrigins.name).toBe("EXTRACTED");
    expect(report.profile.colors.map((color) => color.hex)).toEqual(["#4f46e5"]);
  });

  it("tells the model which fields are already decided", async () => {
    const request: BrandInterpretationRequest[] = [];
    const { service } = buildService({
      interpretationProvider: interpretingProvider((received) => {
        request.push(received);
        return { provider: "fake", model: "fake-1", text: [], voiceSignals: [], terms: [], notes: [] };
      }),
    });

    await service.analyze(PROJECT_ID, USER_ID);

    expect(request).toHaveLength(1);
    expect(request[0]?.deterministicFields).toContain("name");
    expect(request[0]?.deterministicFields).toContain("positioning");
    expect(request[0]?.evidence.length).toBeGreaterThan(0);
  });

  it("keeps the deterministic profile when the model fails", async () => {
    const { service } = buildService({
      interpretationProvider: {
        id: "fake",
        interpret: async () => {
          throw new BrandError("BRAND_AI_INVALID_OUTPUT", "model invented a color");
        },
      },
    });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.aiApplied).toBe(false);
    expect(report.aiErrorCode).toBe("BRAND_AI_INVALID_OUTPUT");
    expect(report.profile.name).toBe("Acme");
    expect(report.notes.join(" ")).toContain("model invented a color");
  });

  it("reports an unavailable model separately from invalid output", async () => {
    const { service } = buildService({
      interpretationProvider: {
        id: "fake",
        interpret: async () => {
          throw new Error("socket hang up");
        },
      },
    });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.aiErrorCode).toBe("BRAND_AI_UNAVAILABLE");
  });

  it("never lets an inferred value outrank a user correction", async () => {
    const { service } = buildService({
      interpretationProvider: interpretingProvider(() => ({
        provider: "fake",
        model: "fake-1",
        text: [
          {
            field: "voiceSummary",
            value: "Loud and playful.",
            confidence: "HIGH",
            evidenceKeys: [evidenceKey],
          },
        ],
        voiceSignals: [],
        terms: [],
        notes: [],
      })),
    });

    await service.analyze(PROJECT_ID, USER_ID);
    await service.update(PROJECT_ID, USER_ID, { voiceSummary: "Measured and factual." });
    const report = await service.refresh(PROJECT_ID, USER_ID);

    expect(report.profile.voiceSummary).toBe("Measured and factual.");
    expect(report.profile.textOrigins.voiceSummary).toBe("USER");
  });
});

describe("BrandIntelligenceService execution profile", () => {
  it("derives a downstream contract from the canonical profile", async () => {
    const { service } = buildService({ assets: [asset()] });

    const report = await service.analyze(PROJECT_ID, USER_ID);

    expect(report.execution.name).toBe("Acme");
    expect(report.execution.visual.colors[0]).toEqual({
      role: "PRIMARY",
      name: "Brand primary",
      hex: "#4f46e5",
    });
    expect(report.execution.terms.preferred).toContain("content operations");
    expect(report.execution.terms.avoid).toEqual([]);
    expect(report.execution.visual.assets[0]?.assetId).toBe("ast_1");
    expect(report.execution.version).toBe(1);
  });

  it("starts an empty project as a draft with no text origins", () => {
    const base = emptyBrandProfile("prj", "brp_1", NOW);
    expect(base.status).toBe("DRAFT");
    expect(base.confidence).toBe("LOW");
    expect(base.textOrigins).toEqual({});
  });

  it("keeps every material kind reachable from the execution contract", async () => {
    const { service } = buildService({ assets: [asset()] });
    const report = await service.analyze(PROJECT_ID, USER_ID);

    const sections: { field: string; count: number }[] = [
      { field: "colors", count: report.profile.colors.length },
      { field: "fonts", count: report.profile.fonts.length },
      { field: "assets", count: report.profile.assets.length },
      { field: "terms", count: report.profile.terms.length },
      { field: "voiceSignals", count: report.profile.voiceSignals.length },
      { field: "guidelines", count: report.profile.guidelines.length },
    ];
    for (const section of sections) {
      expect(section.count, `expected ${section.field} to be populated`).toBeGreaterThan(0);
    }
  });
});
