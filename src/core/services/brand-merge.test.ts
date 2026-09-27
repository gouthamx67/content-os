import { describe, expect, it } from "vitest";
import {
  BRAND_COLOR_ROLES,
  BrandError,
  brandPrecedenceForOrigin,
  brandPrecedenceRank,
  computeBrandConfidence,
  computeBrandStatus,
  emptyBrandProfile,
  isBrandTextField,
  maxBrandPrecedence,
  toBrandExecutionProfile,
  type BrandColor,
  type BrandPrecedence,
  type BrandProfile,
} from "../domain/brand";
import {
  brandEntryId,
  conflictSeverity,
  mergeBrandEntries,
  toBrandColor,
  toBrandConflict,
  toBrandTerm,
  type BrandConflictSeed,
  type BrandMergeEntry,
} from "./brand-merge";
import { normalizeHexColor } from "../../lib/brand-normalization";

function entry(overrides: Partial<BrandMergeEntry> = {}): BrandMergeEntry {
  return {
    kind: "color",
    key: "PRIMARY|#4f46e5",
    value: "Brand primary",
    origin: "EXTRACTED",
    basis: "DESIGN_TOKEN",
    confidence: "HIGH",
    sourceIds: ["src_1"],
    evidenceIds: ["evd_1"],
    data: { role: "PRIMARY", hex: "#4f46e5", notes: null },
    ...overrides,
  };
}

function textEntry(field: string, value: string, overrides: Partial<BrandMergeEntry> = {}): BrandMergeEntry {
  return entry({
    kind: "text",
    key: field,
    value,
    basis: "GENERAL_EXTRACTION",
    confidence: "MEDIUM",
    data: {},
    ...overrides,
  });
}

function termEntry(term: string, preference: string, overrides: Partial<BrandMergeEntry> = {}): BrandMergeEntry {
  return entry({
    kind: "term",
    key: term.toLowerCase(),
    value: term,
    basis: "GENERAL_EXTRACTION",
    confidence: "MEDIUM",
    data: { category: "INDUSTRY_TERM", preference, notes: null },
    ...overrides,
  });
}

describe("brand precedence", () => {
  it("orders the bases weakest to strongest", () => {
    const order: BrandPrecedence[] = [
      "INFERENCE",
      "GENERAL_EXTRACTION",
      "RECOGNIZED_ASSET",
      "DESIGN_TOKEN",
      "EXPLICIT_GUIDELINE",
      "USER",
    ];
    const ranks = order.map(brandPrecedenceRank);
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
  });

  it("maps an origin to its default basis", () => {
    expect(brandPrecedenceForOrigin("USER")).toBe("USER");
    expect(brandPrecedenceForOrigin("INFERRED")).toBe("INFERENCE");
    expect(brandPrecedenceForOrigin("EXTRACTED")).toBe("GENERAL_EXTRACTION");
  });

  it("keeps the stronger basis when two are compared", () => {
    expect(maxBrandPrecedence("DESIGN_TOKEN", "USER")).toBe("USER");
    expect(maxBrandPrecedence("INFERENCE", "RECOGNIZED_ASSET")).toBe("RECOGNIZED_ASSET");
  });

  it("ranks a conflict by the basis that resolved it", () => {
    expect(conflictSeverity({ field: "color:primary", retained: "a", competing: "b", resolvedBy: "USER", sourceIds: [], evidenceIds: [] })).toBeGreaterThan(
      conflictSeverity({ field: "color:primary", retained: "a", competing: "b", resolvedBy: "INFERENCE", sourceIds: [], evidenceIds: [] }),
    );
  });
});

describe("mergeBrandEntries identity", () => {
  it("unions provenance when several sources agree on one color", () => {
    const merged = mergeBrandEntries([
      entry({ sourceIds: ["src_1"], evidenceIds: ["evd_1"] }),
      entry({ sourceIds: ["src_2"], evidenceIds: ["evd_2"], basis: "GENERAL_EXTRACTION" }),
    ]);

    expect(merged.winners).toHaveLength(1);
    expect(merged.winners[0]?.sourceIds).toEqual(["src_1", "src_2"]);
    expect(merged.winners[0]?.evidenceIds).toEqual(["evd_1", "evd_2"]);
    expect(merged.winners[0]?.basis).toBe("DESIGN_TOKEN");
  });

  it("reports no conflict when the sources agree", () => {
    const merged = mergeBrandEntries([
      entry({ value: "Brand primary" }),
      entry({ value: "Brand primary", sourceIds: ["src_2"] }),
    ]);
    expect(merged.conflicts).toHaveLength(0);
  });

  it("lets a user value win over every automatic basis", () => {
    const merged = mergeBrandEntries([
      entry(),
      entry({ origin: "USER", basis: "USER", confidence: "LOW" }),
    ]);
    expect(merged.winners[0]?.origin).toBe("USER");
  });

  it("prefers a design token over a general extraction", () => {
    const merged = mergeBrandEntries([
      entry({ basis: "GENERAL_EXTRACTION", confidence: "HIGH" }),
      entry({ basis: "DESIGN_TOKEN", confidence: "LOW" }),
    ]);
    expect(merged.winners[0]?.basis).toBe("DESIGN_TOKEN");
  });

  it("breaks a rank tie on confidence", () => {
    const merged = mergeBrandEntries([
      entry({ confidence: "LOW" }),
      entry({ confidence: "HIGH" }),
    ]);
    expect(merged.winners[0]?.confidence).toBe("HIGH");
  });

  it("keeps the incumbent value when a re-read ties it, so a refresh cannot flip the brand", () => {
    const first = entry({ key: "PRIMARY|#4f46e5", value: "#4f46e5", data: { role: "PRIMARY", hex: "#4f46e5" } });
    const second = entry({ key: "PRIMARY|#111111", value: "#111111", data: { role: "PRIMARY", hex: "#111111" } });

    const merged = mergeBrandEntries([first, second]);

    expect(merged.winners).toHaveLength(2);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]?.retained).toBe("#4f46e5");
    expect(merged.conflicts[0]?.competing).toBe("#111111");
  });

  it("returns a stable order regardless of the order candidates arrived in", () => {
    const color = entry();
    const font = entry({
      kind: "font",
      key: "HEADING|Inter",
      value: "Inter",
      data: { role: "HEADING", weight: null, style: null, sourceUrl: null, notes: null },
    });
    const term = termEntry("content operations", "PREFERRED");

    const forward = mergeBrandEntries([color, font, term]);
    const reversed = mergeBrandEntries([term, font, color]);

    expect(forward.winners.map((winner) => winner.key)).toEqual(
      reversed.winners.map((winner) => winner.key),
    );
  });

  it("produces the same result on a second identical run", () => {
    const input = [
      entry(),
      entry({ key: "PRIMARY|#111111", value: "#111111", data: { role: "PRIMARY", hex: "#111111" } }),
      termEntry("content operations", "PREFERRED"),
      termEntry("content operations", "AVOID"),
    ];
    const first = mergeBrandEntries(input);
    const second = mergeBrandEntries(input);
    expect(second.winners).toEqual(first.winners);
    expect(second.conflicts).toEqual(first.conflicts);
  });
});

describe("mergeBrandEntries conflicts", () => {
  it("reports two different values for one field", () => {
    const merged = mergeBrandEntries([
      textEntry("positioning", "The content operating system"),
      textEntry("positioning", "A docs tool for writers", { basis: "INFERENCE", origin: "INFERRED" }),
    ]);

    expect(merged.winners).toHaveLength(1);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]?.field).toBe("text:positioning");
    expect(merged.conflicts[0]?.retained).toBe("The content operating system");
    expect(merged.conflicts[0]?.competing).toBe("A docs tool for writers");
    expect(merged.conflicts[0]?.resolvedBy).toBe("GENERAL_EXTRACTION");
  });

  it("keeps both competitors for one slot and records the disagreement", () => {
    const merged = mergeBrandEntries([
      entry({ key: "PRIMARY|#4f46e5", value: "#4f46e5", data: { role: "PRIMARY", hex: "#4f46e5" }, sourceIds: ["src_1"] }),
      entry({ key: "PRIMARY|#111111", value: "#111111", data: { role: "PRIMARY", hex: "#111111" }, sourceIds: ["src_2"] }),
    ]);

    expect(merged.winners).toHaveLength(2);
    expect(merged.conflicts[0]?.field).toBe("color:primary");
    expect(merged.conflicts[0]?.sourceIds).toEqual(["src_2"]);
  });

  it("does not report a conflict between two different roles", () => {
    const merged = mergeBrandEntries([
      entry({ key: "PRIMARY|#4f46e5", value: "#4f46e5", data: { role: "PRIMARY", hex: "#4f46e5" } }),
      entry({ key: "TEXT|#111111", value: "#111111", data: { role: "TEXT", hex: "#111111" } }),
    ]);
    expect(merged.conflicts).toHaveLength(0);
    expect(merged.winners).toHaveLength(2);
  });

  it("reports a term that is both preferred and avoided", () => {
    const merged = mergeBrandEntries([
      termEntry("content operations", "PREFERRED"),
      termEntry("content operations", "AVOID"),
    ]);

    expect(merged.winners).toHaveLength(1);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]?.retained).toBe("content operations (preferred)");
    expect(merged.conflicts[0]?.competing).toBe("content operations (avoid)");
  });

  it("reports two guidelines with the same title but different detail", () => {
    const merged = mergeBrandEntries([
      entry({ kind: "guideline", key: "guideline|voice", value: "Voice", basis: "EXPLICIT_GUIDELINE", data: { detail: "Short sentences." } }),
      entry({ kind: "guideline", key: "guideline|voice", value: "Voice", basis: "EXPLICIT_GUIDELINE", data: { detail: "Long sentences." } }),
    ]);

    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]?.retained).toBe("Short sentences.");
    expect(merged.conflicts[0]?.competing).toBe("Long sentences.");
  });

  it("reports two logos competing for the logo slot", () => {
    const merged = mergeBrandEntries([
      entry({ kind: "asset", key: "ast_1|LOGO", value: "Primary logo", data: { role: "LOGO", assetId: "ast_1" }, basis: "RECOGNIZED_ASSET" }),
      entry({ kind: "asset", key: "ast_2|LOGO", value: "Mark", data: { role: "LOGO", assetId: "ast_2" }, basis: "RECOGNIZED_ASSET" }),
    ]);

    expect(merged.winners).toHaveLength(2);
    expect(merged.conflicts[0]?.field).toBe("asset:logo");
  });

  it("converts a seed into a storable conflict with both provenances", () => {
    const seed: BrandConflictSeed = {
      field: "color:primary",
      retained: "#4f46e5",
      competing: "#111111",
      resolvedBy: "DESIGN_TOKEN",
      sourceIds: ["src_2"],
      evidenceIds: ["evd_2"],
    };
    const conflict = toBrandConflict(seed, 0);
    expect(conflict.id.startsWith("brx_")).toBe(true);
    expect(toBrandConflict(seed, 0)).toEqual(conflict);
    expect(toBrandConflict(seed, 1).id).not.toBe(conflict.id);
    expect(conflict.sourceIds).toEqual(["src_2"]);
    expect(conflict.evidenceIds).toEqual(["evd_2"]);
  });

  it("scopes a derived id to its project so two brands cannot collide", () => {
    const first = brandEntryId("color", "PRIMARY|#4f46e5", "prj_a");
    const second = brandEntryId("color", "PRIMARY|#4f46e5", "prj_b");
    expect(first).not.toBe(second);
    expect(brandEntryId("color", "PRIMARY|#4f46e5", "prj_a")).toBe(first);
  });
});

describe("merge conversions", () => {
  it("gives one value a stable id from its canonical key", () => {
    const id = brandEntryId("color", "PRIMARY|#4f46e5");
    expect(id.startsWith("brc_")).toBe(true);
    expect(brandEntryId("color", "PRIMARY|#4f46e5")).toBe(id);
    expect(brandEntryId("color", "PRIMARY|#111111")).not.toBe(id);
  });

  it("builds a color that keeps its basis and provenance", () => {
    const color: BrandColor = toBrandColor(entry({ basis: "DESIGN_TOKEN" }));
    expect(color.hex).toBe("#4f46e5");
    expect(color.role).toBe("PRIMARY");
    expect(color.basis).toBe("DESIGN_TOKEN");
    expect(color.evidenceIds).toEqual(["evd_1"]);
  });

  it("builds a term with a safe default preference", () => {
    const term = toBrandTerm(
      entry({ kind: "term", key: "ai", value: "AI", data: { category: "INDUSTRY_TERM" } }),
    );
    expect(term.preference).toBe("NEUTRAL");
  });
});

describe("brand status and confidence", () => {
  function profileWith(overrides: Partial<BrandProfile>): BrandProfile {
    return { ...emptyBrandProfile("prj", "brp_1", "2026-01-01T00:00:00.000Z"), ...overrides };
  }

  const color: BrandColor = {
    id: "brc_1",
    name: "Primary",
    hex: "#4f46e5",
    role: "PRIMARY",
    confidence: "HIGH",
    origin: "EXTRACTED",
    basis: "DESIGN_TOKEN",
    sourceIds: [],
    evidenceIds: [],
    notes: null,
  };

  it("starts a profile as a draft", () => {
    const profile = profileWith({});
    expect(computeBrandStatus(profile, { stale: false })).toBe("DRAFT");
    expect(computeBrandConfidence(profile)).toBe("LOW");
  });

  it("stays a draft without an identity", () => {
    const profile = profileWith({ positioning: "Something", colors: [color] });
    expect(computeBrandStatus(profile, { stale: false })).toBe("DRAFT");
  });

  it("reaches medium once three sections are present", () => {
    const profile = profileWith({ name: "Acme", positioning: "Something", colors: [color] });
    expect(computeBrandConfidence(profile)).toBe("MEDIUM");
    expect(computeBrandStatus(profile, { stale: false })).toBe("READY");
  });

  it("never reports ready while a source is stale", () => {
    const profile = profileWith({ name: "Acme", positioning: "Something", colors: [color] });
    expect(computeBrandStatus(profile, { stale: true })).toBe("STALE");
  });

  it("treats a value proposition as narrative", () => {
    const profile = profileWith({ name: "Acme", valueProposition: "Ship on time" });
    expect(computeBrandConfidence(profile)).toBe("LOW");
  });
});

describe("brand execution profile", () => {
  const base = emptyBrandProfile("prj", "brp_1", "2026-01-01T00:00:00.000Z");

  it("sorts colors by role, then confidence", () => {
    const profile = {
      ...base,
      colors: [
        { id: "b", name: "Text", hex: "#111111", role: "TEXT" as const, confidence: "HIGH" as const, origin: "EXTRACTED" as const, basis: "DESIGN_TOKEN" as const, sourceIds: [], evidenceIds: [], notes: null },
        { id: "a", name: "Primary", hex: "#4f46e5", role: "PRIMARY" as const, confidence: "LOW" as const, origin: "EXTRACTED" as const, basis: "GENERAL_EXTRACTION" as const, sourceIds: [], evidenceIds: [], notes: null },
      ],
    };

    const execution = toBrandExecutionProfile(profile);
    expect(execution.visual.colors.map((color) => color.role)).toEqual(["PRIMARY", "TEXT"]);
  });

  it("exposes preferred and avoided terms separately", () => {
    const profile = {
      ...base,
      terms: [
        { id: "t1", term: "content operations", category: "INDUSTRY_TERM" as const, preference: "PREFERRED" as const, confidence: "HIGH" as const, origin: "EXTRACTED" as const, basis: "GENERAL_EXTRACTION" as const, sourceIds: [], evidenceIds: [], notes: null },
        { id: "t2", term: "synergy", category: "INDUSTRY_TERM" as const, preference: "AVOID" as const, confidence: "HIGH" as const, origin: "USER" as const, basis: "USER" as const, sourceIds: [], evidenceIds: [], notes: null },
      ],
    };

    const execution = toBrandExecutionProfile(profile);
    expect(execution.terms.preferred).toEqual(["content operations"]);
    expect(execution.terms.avoid).toEqual(["synergy"]);
  });

  it("carries the canonical identity and status", () => {
    const execution = toBrandExecutionProfile({ ...base, name: "Acme", version: 3 });
    expect(execution.brandId).toBe("brp_1");
    expect(execution.projectId).toBe("prj");
    expect(execution.name).toBe("Acme");
    expect(execution.version).toBe(3);
    expect(execution.locked).toBe(false);
  });
});

describe("brand primitives", () => {
  it("narrows a text field name", () => {
    expect(isBrandTextField("positioning")).toBe(true);
    expect(isBrandTextField("colors")).toBe(false);
  });

  it("normalizes a six digit hex color", () => {
    expect(normalizeHexColor("4F46E5")).toBe("#4f46e5");
    expect(normalizeHexColor("#fff")).toBeNull();
  });

  it("keeps a stable role vocabulary", () => {
    expect(BRAND_COLOR_ROLES).toContain("PRIMARY");
  });

  it("carries a code on a brand error", () => {
    const error = new BrandError("BRAND_LOCKED", "locked");
    expect(error.code).toBe("BRAND_LOCKED");
    expect(error).toBeInstanceOf(Error);
  });

  it("types a basis as the declared precedence union", () => {
    const basis: BrandPrecedence = "DESIGN_TOKEN";
    expect(basis).toBe("DESIGN_TOKEN");
  });
});
