import { describe, expect, it } from "vitest";
import {
  canonicalizeLocale,
  directionFromLocale,
  isValidLocale,
} from "../domain/locale";
import {
  extractPlaceholders,
  extraPlaceholders,
  missingPlaceholders,
  placeholdersMatch,
} from "../domain/placeholders";
import { glossaryViolations, pinnedTerms } from "../domain/glossary";
import {
  assertEditable,
  assertTransition,
  canTransition,
  isEditable,
} from "../domain/state-machine";
import { assertProviderCoverage, parseProviderOutput } from "../domain/schema";
import { validateSegments } from "../domain/validation";
import { evaluateReadiness } from "../domain/readiness";
import { createSegment, segmentIdForPath } from "../domain/segment";
import {
  localizationHash,
  parseStoredJson,
  serializeLocalizationJson,
  sha256Hex,
} from "../serialization/canonical";
import {
  normalizeSourceText,
  translationMemoryKey,
} from "../services/translation-memory";
import {
  LOCAL_RULES_PROVIDER,
  LocalizationRulesProvider,
  createLocalizationProviderRegistry,
} from "../services/localization-provider";
import { SourceExtractor, hashDrafts } from "../services/source-extractor";
import { MaterializationService } from "../services/materialization-service";
import { LocalizationError, isLocalizationError } from "../errors";
import type { LocalizationSourceAdapter } from "../integrations/ports";
import type {
  LocalizationJobRecord,
  LocalizationSegment,
  LocalizationSnapshot,
  LocalizationSourceType,
} from "../domain/types";

function segment(
  overrides: Partial<LocalizationSegment> & { sourceText: string },
): LocalizationSegment {
  return {
    id: overrides.id ?? segmentIdForPath(overrides.path ?? "field"),
    kind: overrides.kind ?? "BODY",
    path: overrides.path ?? "field",
    sourceText: overrides.sourceText,
    targetText: overrides.targetText ?? null,
    placeholders:
      overrides.placeholders ?? extractPlaceholders(overrides.sourceText),
    glossary: overrides.glossary ?? {},
    metadata: overrides.metadata ?? {},
  };
}

describe("locale", () => {
  it("canonicalizes case and region subtags", () => {
    expect(canonicalizeLocale("pt-br")).toBe("pt-BR");
    expect(canonicalizeLocale("PT-br")).toBe("pt-BR");
    expect(canonicalizeLocale("en")).toBe("en");
    expect(canonicalizeLocale(" zh-hant-tw ")).toBe("zh-Hant-TW");
  });

  it("refuses a tag that is not BCP-47", () => {
    expect(() => canonicalizeLocale("not a locale!")).toThrow(LocalizationError);
    expect(() => canonicalizeLocale("")).toThrow(LocalizationError);
    expect(isValidLocale("pt-br")).toBe(true);
    expect(isValidLocale("###")).toBe(false);
  });

  it("resolves direction from the locale's trust data, not the language name", () => {
    expect(directionFromLocale("ar")).toBe("RTL");
    expect(directionFromLocale("he")).toBe("RTL");
    expect(directionFromLocale("en")).toBe("LTR");
  });
});

describe("placeholders", () => {
  it("extracts every token family in sorted order", () => {
    const found = extractPlaceholders(
      "Hi {name}, {count} of {{total}} ${unit} %s %d",
    );
    expect(found).toEqual([
      "${unit}",
      "%d",
      "%s",
      "{count}",
      "{name}",
      "{{total}}",
    ]);
  });

  it("reports missing and added tokens", () => {
    expect(missingPlaceholders("Hi {name}", "Hola")).toEqual(["{name}"]);
    expect(missingPlaceholders("Hi {name}", "Hola {name}")).toEqual([]);
    expect(extraPlaceholders("Plain", "Extra %s")).toEqual(["%s"]);
    expect(placeholdersMatch("Hi {name}", "Hola {name}")).toBe(true);
    expect(placeholdersMatch("Hi {name}", "Hola")).toBe(false);
    expect(placeholdersMatch("a {x} {y}", "b {x} {y}")).toBe(true);
  });
});

describe("glossary", () => {
  it("flags a pinned term rendered in the wrong form", () => {
    const entries = [
      { term: "World", translation: "Mundo", doNotTranslate: false },
    ];
    expect(glossaryViolations("Hello World", "Hola Mundo", entries)).toEqual([]);
    expect(glossaryViolations("Hello World", "Hola World", entries)).toEqual([
      { term: "World", expected: "Mundo" },
    ]);
  });

  it("requires a doNotTranslate term to survive verbatim", () => {
    const entries = [
      { term: "Northwind", translation: "ignored", doNotTranslate: true },
    ];
    expect(glossaryViolations("Use Northwind", "Use Northwind", entries)).toEqual(
      [],
    );
    expect(
      glossaryViolations("Hello World", "Hello X", [
        { term: "World", translation: "Mundo", doNotTranslate: false },
      ]),
    ).toEqual([{ term: "World", expected: "Mundo" }]);
  });

  it("does not flag a missing target (validation owns that)", () => {
    const entries = [
      { term: "World", translation: "Mundo", doNotTranslate: false },
    ];
    expect(glossaryViolations("Hello World", "", entries)).toEqual([]);
  });

  it("pins the terms a source actually contains", () => {
    expect(
      pinnedTerms("Use Northwind daily", [
        { term: "Northwind", translation: "Vendaval", doNotTranslate: false },
        { term: "absent", translation: "nope", doNotTranslate: false },
      ]),
    ).toEqual({ Northwind: "Vendaval" });
  });

  it("pins a doNotTranslate term to itself", () => {
    expect(
      pinnedTerms("Use Northwind", [
        { term: "Northwind", translation: "Vendaval", doNotTranslate: true },
      ]),
    ).toEqual({ Northwind: "Northwind" });
  });
});

describe("state machine", () => {
  it("allows only the mapped transitions", () => {
    expect(canTransition("READY_TO_LOCALIZE", "PROCESSING")).toBe(true);
    expect(canTransition("APPROVED", "APPLIED")).toBe(true);
    expect(canTransition("APPLIED", "PROCESSING")).toBe(false);
    expect(canTransition("DRAFT", "APPLIED")).toBe(false);
    expect(() => assertTransition("DRAFT", "APPLIED")).toThrow(
      LocalizationError,
    );
  });

  it("knows which states are editable", () => {
    expect(isEditable("NEEDS_REVIEW")).toBe(true);
    expect(isEditable("CHANGES_REQUESTED")).toBe(true);
    expect(isEditable("APPROVED")).toBe(false);
    expect(() => assertEditable("APPLIED")).toThrow(LocalizationError);
  });
});

describe("provider schema", () => {
  it("parses only the documented shape", () => {
    expect(
      parseProviderOutput([{ segmentId: "seg_1", targetText: "hola" }]),
    ).toEqual([{ segmentId: "seg_1", targetText: "hola" }]);
    expect(() => parseProviderOutput({})).toThrow(LocalizationError);
    expect(() => parseProviderOutput([{ segmentId: 1 }])).toThrow(
      LocalizationError,
    );
  });

  it("requires exactly-once coverage", () => {
    const segments = [
      segment({ id: "seg_1", sourceText: "a" }),
      segment({ id: "seg_2", sourceText: "b" }),
    ];
    expect(() =>
      assertProviderCoverage(
        [{ segmentId: "seg_1" }, { segmentId: "seg_2" }],
        segments,
      ),
    ).not.toThrow();
    expect(() =>
      assertProviderCoverage([{ segmentId: "seg_1" }], segments),
    ).toThrow(LocalizationError);
    expect(() =>
      assertProviderCoverage(
        [{ segmentId: "seg_1" }, { segmentId: "seg_1" }],
        segments,
      ),
    ).toThrow(LocalizationError);
    expect(() =>
      assertProviderCoverage(
        [{ segmentId: "seg_9" }, { segmentId: "seg_2" }],
        segments,
      ),
    ).toThrow(LocalizationError);
  });
});

describe("validation and readiness", () => {
  it("flags each class of problem", () => {
    const codes = validateSegments(
      [
        segment({ sourceText: "Hello", targetText: null }),
        segment({ sourceText: "World", targetText: "" }),
        segment({ sourceText: "Same", targetText: "Same" }),
        segment({ sourceText: "Hi {name}", targetText: "Hola" }),
        segment({ sourceText: "Plain", targetText: "Extra %s" }),
      ],
      { entries: [], targetDirection: "LTR" },
    ).map((finding) => finding.code);

    expect(codes).toContain("MISSING_TRANSLATION");
    expect(codes).toContain("EMPTY_TRANSLATION");
    expect(codes).toContain("UNCHANGED_TRANSLATION");
    expect(codes).toContain("PLACEHOLDER_MISSING");
    expect(codes).toContain("PLACEHOLDER_ADDED");
  });

  it("flags a glossary violation as an error", () => {
    const findings = validateSegments(
      [segment({ sourceText: "Ship fast", targetText: "Enviar rapido" })],
      {
        entries: [{ term: "Ship", translation: "Lanzar", doNotTranslate: false }],
        targetDirection: "LTR",
      },
    );
    expect(
      findings.some((finding) => finding.code === "GLOSSARY_VIOLATION"),
    ).toBe(true);
  });

  it("flags a duplicate segment id", () => {
    const findings = validateSegments(
      [
        segment({ id: "seg_1", sourceText: "a", targetText: "b" }),
        segment({ id: "seg_1", sourceText: "c", targetText: "d" }),
      ],
      { entries: [], targetDirection: "LTR" },
    );
    expect(findings.some((finding) => finding.code === "DUPLICATE_SEGMENT_ID")).toBe(
      true,
    );
  });

  it("marks a translation with blocking findings as not ready", () => {
    const segments = [segment({ sourceText: "Hello", targetText: null })];
    const findings = validateSegments(segments, {
      entries: [],
      targetDirection: "LTR",
    });
    const readiness = evaluateReadiness(segments, findings);
    expect(readiness.ready).toBe(false);
    expect(
      readiness.findings.some((finding) => finding.severity === "ERROR"),
    ).toBe(true);
  });

  it("is ready when the only findings are warnings", () => {
    const segments = [segment({ sourceText: "Same", targetText: "Same" })];
    const findings = validateSegments(segments, {
      entries: [],
      targetDirection: "LTR",
    });
    expect(
      findings.every((finding) => finding.severity === "WARNING"),
    ).toBe(true);
    expect(evaluateReadiness(segments, findings).ready).toBe(true);
  });

  it("flags an empty source as a readiness error", () => {
    const readiness = evaluateReadiness([], []);
    expect(readiness.ready).toBe(false);
    expect(readiness.findings[0]?.code).toBe("NO_SEGMENTS");
  });
});

describe("segment identity", () => {
  it("derives a stable id from the path and records placeholders", () => {
    expect(segmentIdForPath("body:p1")).toBe(segmentIdForPath("body:p1"));
    expect(segmentIdForPath("body:p1")).not.toBe(segmentIdForPath("body:p2"));
    const created = createSegment({
      path: "headline",
      kind: "HEADLINE",
      sourceText: "Save {amount} now",
    });
    expect(created.id).toBe(segmentIdForPath("headline"));
    expect(created.id.startsWith("seg_")).toBe(true);
    expect(created.targetText).toBeNull();
    expect(created.placeholders).toEqual(["{amount}"]);
  });
});

describe("canonical serialization", () => {
  it("hashes equal values to the same digest regardless of key order", () => {
    expect(localizationHash({ a: 1, b: 2 })).toBe(localizationHash({ b: 2, a: 1 }));
    expect(localizationHash({ a: 1 })).not.toBe(localizationHash({ a: 2 }));
    expect(sha256Hex("x")).toHaveLength(64);
  });

  it("refuses to repair a corrupt stored row", () => {
    expect(parseStoredJson<{ a: number }>('{"a":1}', "snapshot")).toEqual({ a: 1 });
    expect(() => parseStoredJson("not json", "snapshot")).toThrow();
    expect(() => parseStoredJson("[]", "snapshot")).toThrow();
  });
});

describe("translation memory", () => {
  it("normalizes whitespace before hashing", () => {
    expect(normalizeSourceText("  a   b\tc  ")).toBe("a b c");
    expect(translationMemoryKey("a   b")).toBe(translationMemoryKey("a b"));
    expect(translationMemoryKey("a b")).not.toBe(translationMemoryKey("a c"));
  });
});

describe("localization provider", () => {
  it("substitutes non-pinned glossary terms and leaves the rest", async () => {
    const provider = new LocalizationRulesProvider();
    const result = await provider.localize({
      strategy: "TRANSLATE",
      sourceLocale: "en",
      targetLocale: "es",
      segments: [
        segment({ id: "seg_1", sourceText: "Hello World" }),
        segment({ id: "seg_2", sourceText: "Use Northwind daily" }),
      ],
      glossary: [
        { term: "World", translation: "Mundo", doNotTranslate: false },
        { term: "Northwind", translation: "Vendaval", doNotTranslate: true },
      ],
    });
    expect(result.provider).toBe(LOCAL_RULES_PROVIDER);
    expect(result.segments).toContainEqual({
      segmentId: "seg_1",
      targetText: "Hello Mundo",
    });
    expect(result.segments).toContainEqual({
      segmentId: "seg_2",
      targetText: "Use Northwind daily",
    });
  });

  it("refuses an unknown provider name", () => {
    const registry = createLocalizationProviderRegistry();
    expect(registry.get("local-rules").name).toBe(LOCAL_RULES_PROVIDER);
    expect(() => registry.get("machine-magic")).toThrow();
  });
});

describe("source extractor", () => {
  function adapter(
    sourceType: LocalizationSourceType,
    drafts: { path: string; kind: "BODY"; sourceText: string }[],
  ): LocalizationSourceAdapter {
    return {
      sourceType,
      async extract() {
        return { sourceRevision: "r1", sourceLocale: "en", drafts };
      },
    };
  }

  it("hashes drafts independently of order", () => {
    const a = hashDrafts([
      { path: "b", kind: "BODY", sourceText: "two" },
      { path: "a", kind: "BODY", sourceText: "one" },
    ]);
    const b = hashDrafts([
      { path: "a", kind: "BODY", sourceText: "one" },
      { path: "b", kind: "BODY", sourceText: "two" },
    ]);
    expect(a).toBe(b);
    expect(a).not.toBe(
      hashDrafts([
        { path: "a", kind: "BODY", sourceText: "one" },
        { path: "b", kind: "BODY", sourceText: "two!" },
      ]),
    );
  });

  it("extracts segments and refuses an unregistered source type", async () => {
    const extractor = new SourceExtractor([
      adapter("WRITING_DOCUMENT", [
        { path: "body:0", kind: "BODY", sourceText: "Launch" },
      ]),
    ]);
    const result = await extractor.extract({
      projectId: "p1",
      sourceType: "WRITING_DOCUMENT",
      sourceId: "w1",
      sourceLocale: "en",
    });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.sourceText).toBe("Launch");

    await expect(
      extractor.extract({
        projectId: "p1",
        sourceType: "CAMPAIGN",
        sourceId: "c1",
        sourceLocale: "en",
      }),
    ).rejects.toBeInstanceOf(LocalizationError);
  });

  it("treats a missing source as not found", async () => {
    const missing: LocalizationSourceAdapter = {
      sourceType: "WRITING_DOCUMENT",
      async extract() {
        return null;
      },
    };
    const extractor = new SourceExtractor([missing]);
    await expect(
      extractor.extract({
        projectId: "p1",
        sourceType: "WRITING_DOCUMENT",
        sourceId: "nope",
        sourceLocale: "en",
      }),
    ).rejects.toBeInstanceOf(LocalizationError);
  });
});

describe("materialization", () => {
  it("carries only text and hashes, never storage keys", () => {
    const job: LocalizationJobRecord = {
      id: "loc_1",
      projectId: "p1",
      sourceType: "WRITING_DOCUMENT",
      sourceId: "w1",
      sourceRevision: "v1",
      sourceHash: "hash",
      sourceLocale: "en",
      targetLocale: "es",
      strategy: "TRANSLATE",
      status: "APPLIED",
      provider: "local-rules",
      headRevisionNumber: 5,
      approvalRevisionNumber: 5,
      approvedById: "u1",
      approvedAt: "2026-01-01T00:00:00.000Z",
      appliedAt: "2026-01-01T00:00:00.000Z",
      errorCode: null,
      errorMessage: null,
      createdById: "u1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const snapshot: LocalizationSnapshot = {
      request: {
        sourceType: "WRITING_DOCUMENT",
        sourceId: "w1",
        sourceLocale: "en",
        targetLocale: "es",
        strategy: "TRANSLATE",
      },
      sourceRevision: "v1",
      sourceHash: "hash",
      provider: "local-rules",
      providerModel: "local-rules-1",
      segments: [
        segment({
          id: "seg_1",
          path: "body:0",
          sourceText: "Hello",
          targetText: "Hola",
        }),
      ],
      findings: [],
      readiness: { ready: true, findings: [] },
    };

    const service = new MaterializationService();
    const artifact = service.build({
      job,
      snapshot,
      localizationRevision: 5,
      provenance: { provider: "local-rules", providerModel: null },
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.localizationRevision).toBe(5);
    expect(artifact.segments[0]?.targetText).toBe("Hola");
    const json = serializeLocalizationJson(artifact);
    expect(json).not.toContain("storageKey");
    expect(json).not.toContain("outputStorageKey");
    expect(artifact.targetHash).toHaveLength(64);
  });
});

describe("errors", () => {
  it("carries a code and an HTTP status", () => {
    const error = new LocalizationError(
      "LOCALIZATION_REVISION_CONFLICT",
      "conflict",
    );
    expect(error.status).toBe(409);
    expect(isLocalizationError(error)).toBe(true);
    expect(isLocalizationError(new Error("nope"))).toBe(false);
  });
});
