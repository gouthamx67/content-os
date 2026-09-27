import { describe, expect, it } from "vitest";
import {
  parseBrandInterpretation,
  type BrandInterpretationContext,
} from "./brand-interpretation-validation";
import { brandEvidenceKey } from "../../lib/brand-normalization";

const EVIDENCE = brandEvidenceKey("src_1", "URL_SECTION", "html:title");
const OTHER_EVIDENCE = brandEvidenceKey("src_1", "EXTRACTED_METADATA", "html:meta:description");

function context(overrides: Partial<BrandInterpretationContext> = {}): BrandInterpretationContext {
  return {
    allowedEvidenceKeys: new Set([EVIDENCE, OTHER_EVIDENCE]),
    alreadyDetermined: new Set(),
    ...overrides,
  };
}

function parse(parsed: unknown, ctx: BrandInterpretationContext = context()) {
  return parseBrandInterpretation(parsed, ctx);
}

describe("brand interpretation evidence rules", () => {
  it("accepts an assertion backed by a gathered evidence key", () => {
    const result = parse({
      voiceSummary: "Plain spoken and confident.",
      voiceSummaryEvidenceKeys: [EVIDENCE],
      voiceSummaryConfidence: "MEDIUM",
    });

    expect(result.text).toEqual([
      {
        field: "voiceSummary",
        value: "Plain spoken and confident.",
        confidence: "MEDIUM",
        evidenceKeys: [EVIDENCE],
      },
    ]);
  });

  it("rejects an assertion whose keys are all unknown", () => {
    expect(() =>
      parse({ voiceSummary: "Invented.", voiceSummaryEvidenceKeys: ["made:up"] }),
    ).toThrowError(/no evidence/);
  });

  it("rejects an assertion that cites nothing at all", () => {
    expect(() => parse({ voiceSummary: "Invented." })).toThrowError(/no evidence/);
  });

  it("keeps the known keys when only some are unknown", () => {
    const result = parse({
      voiceSummary: "Calm.",
      voiceSummaryEvidenceKeys: ["made:up", EVIDENCE],
    });
    expect(result.text[0]?.evidenceKeys).toEqual([EVIDENCE]);
  });

  it("rejects output when nothing survives", () => {
    expect(() =>
      parse({ preferredTerms: [], avoidTerms: [], voiceSignals: [] }),
    ).toThrowError(/nothing that the gathered evidence supports/);
  });

  it("rejects output that is not an object", () => {
    expect(() => parse("a string")).toThrowError(/JSON object/);
    expect(() => parse(null)).toThrowError(/JSON object/);
    expect(() => parse([1, 2])).toThrowError(/JSON object/);
  });
});

describe("brand interpretation determinism rules", () => {
  it("never lets the model set the brand name", () => {
    const result = parse({
      name: "Acme Corporation",
      nameEvidenceKeys: [EVIDENCE],
      tagline: "Ship with confidence",
      taglineEvidenceKeys: [EVIDENCE],
    });

    expect(result.text.map((item) => item.field)).toEqual(["tagline"]);
  });

  it("ignores a field the analyzers already decided", () => {
    const result = parse(
      {
        positioning: "A different story",
        positioningEvidenceKeys: [EVIDENCE],
        voiceSummary: "Calm.",
        voiceSummaryEvidenceKeys: [EVIDENCE],
      },
      context({ alreadyDetermined: new Set(["positioning"]) }),
    );

    expect(result.text.map((item) => item.field)).toEqual(["voiceSummary"]);
  });

  it("drops a material fact and keeps the rest of the interpretation", () => {
    const result = parse({
      colors: ["#4f46e5", "#111111"],
      logos: ["logo.svg"],
      voiceSummary: "Calm.",
      voiceSummaryEvidenceKeys: [EVIDENCE],
    });

    expect(result.text).toHaveLength(1);
    expect(result.notes.join(" ")).toContain("colors");
    expect(result.notes.join(" ")).toContain("logos");
  });

  it("rejects an over long value instead of truncating it", () => {
    expect(() =>
      parse({ voiceSummary: "x".repeat(401), voiceSummaryEvidenceKeys: [EVIDENCE] }),
    ).toThrowError(/longer than 400/);
  });

  it("collapses whitespace and rejects a blank value", () => {
    const result = parse({
      voiceSummary: "  Plain   spoken  ",
      voiceSummaryEvidenceKeys: [EVIDENCE],
    });
    expect(result.text[0]?.value).toBe("Plain spoken");

    expect(() => parse({ voiceSummary: "   ", voiceSummaryEvidenceKeys: [EVIDENCE] })).toThrowError(
      /nothing that the gathered evidence supports/,
    );
  });

  it("falls back to low confidence for an unknown level", () => {
    const result = parse({
      voiceSummary: "Calm.",
      voiceSummaryEvidenceKeys: [EVIDENCE],
      voiceSummaryConfidence: "VERY_HIGH",
    });
    expect(result.text[0]?.confidence).toBe("LOW");
  });
});

describe("brand interpretation voice and terms", () => {
  it("normalizes a voice signal kind", () => {
    const result = parse({
      voiceSignals: [
        { kind: "tone of voice", value: "confident", evidenceKeys: [EVIDENCE], confidence: "HIGH" },
      ],
    });

    expect(result.voiceSignals[0]).toEqual({
      kind: "TONE_OF_VOICE",
      value: "confident",
      confidence: "HIGH",
      evidenceKeys: [EVIDENCE],
    });
  });

  it("rejects a voice signal with no evidence", () => {
    expect(() =>
      parse({ voiceSignals: [{ kind: "TONE", value: "confident" }] }),
    ).toThrowError(/no evidence/);
  });

  it("reads preferred and avoided term lists", () => {
    const result = parse({
      preferredTerms: [
        { term: "content operations", category: "INDUSTRY_TERM", evidenceKeys: [EVIDENCE] },
        { term: "governance", evidenceKeys: [EVIDENCE] },
      ],
      avoidTerms: [{ term: "synergy", category: "INDUSTRY_TERM", evidenceKeys: [OTHER_EVIDENCE] }],
    });

    expect(result.terms).toHaveLength(3);
    expect(result.terms[0]?.preference).toBe("PREFERRED");
    expect(result.terms[1]?.category).toBe("INDUSTRY_TERM");
    expect(result.terms[2]?.term).toBe("synergy");
    expect(result.terms[2]?.preference).toBe("AVOID");
    expect(result.terms[2]?.confidence).toBe("LOW");
  });

  it("rejects a bare string term because it cannot cite evidence", () => {
    expect(() => parse({ preferredTerms: ["synergy"] })).toThrowError(/no evidence/);
  });

  it("keeps only the first few terms a model returns", () => {
    const result = parse({
      preferredTerms: Array.from({ length: 20 }, (_value, index) => ({
        term: `term ${index}`,
        evidenceKeys: [EVIDENCE],
      })),
    });

    expect(result.terms).toHaveLength(6);
  });

  it("rejects an over long term", () => {
    expect(() =>
      parse({ preferredTerms: [{ term: "x".repeat(61), evidenceKeys: [EVIDENCE] }] }),
    ).toThrowError(/longer than 60/);
  });
});
