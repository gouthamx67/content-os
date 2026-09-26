import { describe, expect, it } from "vitest";
import {
  canonicalEntityKey,
  canonicalEvidenceKey,
  canonicalSlug,
  isDuplicateEntity,
  lexicalDifference,
  mergeProvenance,
  normalizeIntelligenceText,
  strongerConfidence,
  strongestAssertionKind,
} from "./intelligence-canonical";
import { IntelligenceError } from "./intelligence";
import {
  addDraftEvidence,
  collectDraftEntityTypes,
  draftEntityTypeOfKey,
  emptyIntelligenceDraft,
  mergeDrafts,
  type DraftFeature,
} from "./intelligence-draft";
import {
  RELATIONSHIP_ENDPOINTS,
  parseIntelligenceInterpretation,
  type IntelligenceInterpretationContext,
} from "./intelligence-validation";

const projectId = "project-1";
const sourceA = "source-a";
const sourceB = "source-b";

function feature(overrides: Partial<DraftFeature> = {}): DraftFeature {
  return {
    key: canonicalEntityKey("FEATURE", "AI Video Generation"),
    name: "AI Video Generation",
    description: null,
    category: "AI_GENERATION",
    importance: "SECONDARY",
    confidence: "MEDIUM",
    assertionKind: "INFERENCE",
    sourceIds: [sourceA],
    evidenceKeys: [],
    ...overrides,
  };
}

function context(overrides: Partial<IntelligenceInterpretationContext> = {}): IntelligenceInterpretationContext {
  return {
    projectId,
    allowedSourceIds: [sourceA, sourceB],
    baseEntityTypes: new Map([
      ["product", "PRODUCT"],
      ["feature:ai-video-generation", "FEATURE"],
      ["problem:slow-content-production", "PROBLEM"],
    ]),
    baseEvidence: [
      {
        key: "evidence:abc123",
        sourceId: sourceA,
        kind: "SOURCE_FRAGMENT",
        locator: "section:hero",
        excerpt: "AI video generation",
        metadata: null,
      },
    ],
    ...overrides,
  };
}

describe("normalizeIntelligenceText", () => {
  it("strips diacritics, punctuation and case for stable matching", () => {
    expect(normalizeIntelligenceText("Café  Generator — Pro!!")).toBe("cafe generator pro");
  });

  it("bounds very long input so matching stays predictable", () => {
    const long = `${"a".repeat(500)} tail`;
    expect(normalizeIntelligenceText(long).length).toBeLessThanOrEqual(200);
  });
});

describe("canonicalSlug", () => {
  it("joins tokens with hyphens and caps the number of tokens", () => {
    expect(canonicalSlug("AI Video Generation")).toBe("ai-video-generation");
    expect(canonicalSlug("one two three four five six seven eight nine ten eleven twelve thirteen")).toBe(
      "one-two-three-four-five-six-seven-eight-nine-ten-eleven-twelve",
    );
  });

  it("returns an empty slug when no usable characters remain", () => {
    expect(canonicalSlug("***")).toBe("");
  });
});

describe("canonicalEntityKey", () => {
  it("namespaces keys by entity type", () => {
    expect(canonicalEntityKey("FEATURE", "AI Video Generation")).toBe("feature:ai-video-generation");
    expect(canonicalEntityKey("BENEFIT", "Faster publishing")).toBe("benefit:faster-publishing");
  });

  it("uses a stable key for the singleton product", () => {
    expect(canonicalEntityKey("PRODUCT", "Content OS")).toBe("product");
  });

  it("rejects a name that cannot be normalized", () => {
    expect(() => canonicalEntityKey("FEATURE", "***")).toThrow(IntelligenceError);
  });
});

describe("canonicalEvidenceKey", () => {
  it("is deterministic and distinguishes locator, kind and source", () => {
    const key = canonicalEvidenceKey(sourceA, "URL_SECTION", "h1:hero");
    expect(key).toBe(canonicalEvidenceKey(sourceA, "URL_SECTION", "h1:hero"));
    expect(key).not.toBe(canonicalEvidenceKey(sourceA, "URL_SECTION", "h1:footer"));
    expect(key).not.toBe(canonicalEvidenceKey(sourceB, "URL_SECTION", "h1:hero"));
    expect(key).not.toBe(canonicalEvidenceKey(sourceA, "DOCUMENT_SECTION", "h1:hero"));
    expect(key.startsWith("evidence:")).toBe(true);
  });
});

describe("lexicalDifference and isDuplicateEntity", () => {
  it("treats reordered equivalent names as duplicates", () => {
    expect(isDuplicateEntity("AI video generation", "AI Video Generation")).toBe(true);
  });

  it("treats materially different names as distinct", () => {
    expect(isDuplicateEntity("Team dashboards", "AI video generation")).toBe(false);
  });

  it("tolerates small wording drift", () => {
    expect(lexicalDifference("AI video generator", "AI video generation")).toBeLessThanOrEqual(0.18);
    expect(isDuplicateEntity("AI video generator", "AI video generation")).toBe(true);
  });

  it("returns full difference for empty inputs and never matches an empty existing name", () => {
    expect(lexicalDifference("", "")).toBe(0);
    expect(lexicalDifference("", "feature")).toBe(1);
    expect(isDuplicateEntity("Feature", "")).toBe(false);
  });
});

describe("confidence and assertion merge", () => {
  it("keeps the strongest confidence", () => {
    expect(strongerConfidence("LOW", "HIGH")).toBe("HIGH");
    expect(strongerConfidence("HIGH", "LOW")).toBe("HIGH");
    expect(strongerConfidence("MEDIUM", "MEDIUM")).toBe("MEDIUM");
  });

  it("prefers a user correction over derived assertions", () => {
    expect(strongestAssertionKind("INFERENCE", "USER_PROVIDED")).toBe("USER_PROVIDED");
    expect(strongestAssertionKind("USER_PROVIDED", "FACT")).toBe("USER_PROVIDED");
    expect(strongestAssertionKind("FACT", "INFERENCE")).toBe("FACT");
    expect(strongestAssertionKind("MARKETING_CLAIM", "FACT")).toBe("FACT");
  });
});

describe("mergeProvenance", () => {
  it("unions ids and keeps the strongest method and latest timestamp", () => {
    const merged = mergeProvenance(
      {
        sourceIds: [sourceA],
        evidenceIds: ["evidence:abc123"],
        method: "AI_INTERPRETATION",
        extractedAt: "2026-09-25T10:00:00.000Z",
      },
      {
        sourceIds: [sourceB, sourceA],
        evidenceIds: ["evidence:def456"],
        method: "DETERMINISTIC",
        extractedAt: "2026-09-26T10:00:00.000Z",
      },
    );

    expect(merged.sourceIds).toEqual([sourceA, sourceB]);
    expect(merged.evidenceIds).toEqual(["evidence:abc123", "evidence:def456"]);
    expect(merged.method).toBe("DETERMINISTIC");
    expect(merged.extractedAt).toBe("2026-09-26T10:00:00.000Z");
  });
});

describe("addDraftEvidence", () => {
  it("deduplicates evidence by derived key", () => {
    const draft = emptyIntelligenceDraft();
    const first = addDraftEvidence(draft, {
      sourceId: sourceA,
      kind: "URL_SECTION",
      locator: "h1:hero",
      excerpt: "hero",
      metadata: null,
    });
    const second = addDraftEvidence(draft, {
      sourceId: sourceA,
      kind: "URL_SECTION",
      locator: "h1:hero",
      excerpt: "hero again",
      metadata: null,
    });

    expect(draft.evidence).toHaveLength(1);
    expect(second).toBe(first);
  });
});

describe("mergeDrafts", () => {
  it("merges duplicate features instead of appending", () => {
    const base = emptyIntelligenceDraft();
    base.features.push(feature());
    const incoming = emptyIntelligenceDraft();
    incoming.features.push(
      feature({
        description: "Generate videos with a model",
        importance: "PRIMARY",
        confidence: "HIGH",
        assertionKind: "FACT",
        evidenceKeys: ["evidence:def456"],
      }),
    );

    const merged = mergeDrafts(base, incoming);

    expect(merged.features).toHaveLength(1);
    expect(merged.features[0].description).toBe("Generate videos with a model");
    expect(merged.features[0].importance).toBe("PRIMARY");
    expect(merged.features[0].confidence).toBe("HIGH");
    expect(merged.features[0].assertionKind).toBe("FACT");
    expect(merged.features[0].evidenceKeys).toEqual(["evidence:def456"]);
  });

  it("keeps distinct features and deduplicates relationships", () => {
    const base = emptyIntelligenceDraft();
    base.features.push(feature());
    base.problems.push({
      key: "problem:slow-content-production",
      name: "Slow content production",
      description: null,
      confidence: "HIGH",
      assertionKind: "FACT",
      sourceIds: [sourceA],
      evidenceKeys: [],
    });
    base.relationships.push({
      type: "FEATURE_SOLVES_PROBLEM",
      fromType: "FEATURE",
      fromKey: "feature:ai-video-generation",
      toType: "PROBLEM",
      toKey: "problem:slow-content-production",
      confidence: "MEDIUM",
    });

    const incoming = emptyIntelligenceDraft();
    incoming.features.push(feature({ name: "Team Dashboards", key: "feature:team-dashboards" }));
    incoming.relationships.push(base.relationships[0]);

    const merged = mergeDrafts(base, incoming);

    expect(merged.features.map((item) => item.name)).toEqual([
      "AI Video Generation",
      "Team Dashboards",
    ]);
    expect(merged.relationships).toHaveLength(1);
  });
});

describe("draftEntityTypeOfKey", () => {
  it("resolves every namespaced key and rejects unknown prefixes", () => {
    expect(draftEntityTypeOfKey("feature:x")).toBe("FEATURE");
    expect(draftEntityTypeOfKey("audience:marketers")).toBe("AUDIENCE_SIGNAL");
    expect(draftEntityTypeOfKey("brand:color-primary")).toBe("BRAND_SIGNAL");
    expect(draftEntityTypeOfKey("evidence:abc")).toBe("EVIDENCE");
    expect(draftEntityTypeOfKey("nope:x")).toBeNull();
  });
});

describe("collectDraftEntityTypes", () => {
  it("indexes every entity the draft can reference", () => {
    const draft = emptyIntelligenceDraft();
    draft.product = {
      name: "Content OS",
      shortDescription: null,
      longDescription: null,
      category: null,
      purpose: null,
      valueProposition: null,
      targetUserSummary: null,
      confidence: "HIGH",
      assertionKind: "FACT",
      sourceIds: [sourceA],
      evidenceKeys: [],
    };
    draft.features.push(feature());
    addDraftEvidence(draft, {
      sourceId: sourceA,
      kind: "URL_SECTION",
      locator: "h1",
      excerpt: null,
      metadata: null,
    });

    const types = collectDraftEntityTypes(draft);
    expect(types.get("product")).toBe("PRODUCT");
    expect(types.get("feature:ai-video-generation")).toBe("FEATURE");
    expect([...types.values()]).toContain("EVIDENCE");
  });
});

describe("parseIntelligenceInterpretation", () => {
  it("accepts a well-formed interpretation and derives assertion kind", () => {
    const draft = parseIntelligenceInterpretation(
      {
        features: [
          {
            name: "AI Video Generation",
            category: "AI_GENERATION",
            importance: "PRIMARY",
            confidence: "HIGH",
            isMarketingClaim: true,
            sourceIds: [sourceA],
            evidenceKeys: ["evidence:abc123"],
          },
        ],
        problems: [
          {
            name: "Slow content production",
            description: "Teams publish slowly",
            confidence: "MEDIUM",
            sourceIds: [sourceA],
            evidenceKeys: [],
          },
        ],
        relationships: [
          {
            type: "FEATURE_SOLVES_PROBLEM",
            fromType: "FEATURE",
            fromRef: "AI Video Generation",
            toType: "PROBLEM",
            toRef: "Slow content production",
            confidence: "HIGH",
          },
        ],
      },
      context(),
    );

    expect(draft.features[0].assertionKind).toBe("MARKETING_CLAIM");
    expect(draft.features[0].key).toBe("feature:ai-video-generation");
    expect(draft.problems[0].assertionKind).toBe("INFERENCE");
    expect(draft.relationships[0].fromKey).toBe("feature:ai-video-generation");
    expect(draft.relationships[0].toKey).toBe("problem:slow-content-production");
  });

  it("defaults optional confidence and category instead of failing", () => {
    const draft = parseIntelligenceInterpretation(
      { features: [{ name: "Exports" }] },
      context(),
    );
    expect(draft.features[0].confidence).toBe("MEDIUM");
    expect(draft.features[0].category).toBe("OTHER");
    expect(draft.features[0].importance).toBe("SECONDARY");
  });

  it("rejects a non-object payload", () => {
    expect(() => parseIntelligenceInterpretation("not json", context())).toThrow(
      /expected an object/,
    );
    expect(() => parseIntelligenceInterpretation(null, context())).toThrow(IntelligenceError);
    expect(() => parseIntelligenceInterpretation([1, 2], context())).toThrow(/expected an object/);
  });

  it("rejects unknown top-level and item fields", () => {
    expect(() =>
      parseIntelligenceInterpretation({ nonsense: [] }, context()),
    ).toThrow(/unknown field/);
    expect(() =>
      parseIntelligenceInterpretation(
        { features: [{ name: "Exports", surprise: true }] },
        context(),
      ),
    ).toThrow(/unknown field/);
  });

  it("rejects missing or unusable required names", () => {
    expect(() => parseIntelligenceInterpretation({ features: [{}] }, context())).toThrow(
      /features\[0\]\.name/,
    );
    expect(() =>
      parseIntelligenceInterpretation({ features: [{ name: "   " }] }, context()),
    ).toThrow(/non-empty string/);
  });

  it("rejects wrong scalar types and out-of-range enums", () => {
    expect(() =>
      parseIntelligenceInterpretation({ features: [{ name: 7 }] }, context()),
    ).toThrow(/expected a string/);
    expect(() =>
      parseIntelligenceInterpretation(
        { features: [{ name: "Exports", category: "TELEPORTATION" }] },
        context(),
      ),
    ).toThrow(/expected one of/);
    expect(() =>
      parseIntelligenceInterpretation({ features: [{ name: "Exports", confidence: "CERTAIN" }] }, context()),
    ).toThrow(/expected one of/);
    expect(() =>
      parseIntelligenceInterpretation({ features: [{ name: "Exports", isMarketingClaim: "yes" }] }, context()),
    ).toThrow(/expected a boolean/);
  });

  it("rejects arrays that exceed the item bound", () => {
    const features = Array.from({ length: 201 }, (_, index) => ({ name: `Feature ${index}` }));
    expect(() => parseIntelligenceInterpretation({ features }, context())).toThrow(/at most 200 items/);
  });

  it("rejects a source outside the analyzed project", () => {
    expect(() =>
      parseIntelligenceInterpretation(
        { features: [{ name: "Exports", sourceIds: ["source-from-another-workspace"] }] },
        context(),
      ),
    ).toThrow(/not part of project/);
  });

  it("rejects evidence references that do not resolve", () => {
    expect(() =>
      parseIntelligenceInterpretation(
        { features: [{ name: "Exports", evidenceKeys: ["evidence:missing"] }] },
        context(),
      ),
    ).toThrow(/does not resolve/);
  });

  it("rejects unknown relationship types", () => {
    expect(() =>
      parseIntelligenceInterpretation(
        {
          relationships: [
            {
              type: "FEATURE_MAKES_COFFEE",
              fromType: "FEATURE",
              fromRef: "AI Video Generation",
              toType: "PROBLEM",
              toRef: "Slow content production",
            },
          ],
        },
        context(),
      ),
    ).toThrow(/expected one of/);
  });

  it("rejects a relationship whose endpoints do not match its type", () => {
    expect(() =>
      parseIntelligenceInterpretation(
        {
          relationships: [
            {
              type: "FEATURE_SOLVES_PROBLEM",
              fromType: "BENEFIT",
              fromRef: "AI Video Generation",
              toType: "PROBLEM",
              toRef: "Slow content production",
            },
          ],
        },
        context(),
      ),
    ).toThrow(/fromType/);
  });

  it("rejects relationship references that do not resolve to a known entity", () => {
    expect(() =>
      parseIntelligenceInterpretation(
        {
          relationships: [
            {
              type: "FEATURE_SOLVES_PROBLEM",
              fromType: "FEATURE",
              fromRef: "Nonexistent Feature",
              toType: "PROBLEM",
              toRef: "Slow content production",
            },
          ],
        },
        context(),
      ),
    ).toThrow(/does not resolve to a known FEATURE/);
  });

  it("accepts AI-produced evidence and references it", () => {
    const draft = parseIntelligenceInterpretation(
      {
        evidence: [
          {
            sourceId: sourceB,
            kind: "REPOSITORY_FILE",
            locator: "README.md:features",
            excerpt: "Video generation",
          },
        ],
        claims: [
          {
            text: "Generates videos with a model",
            claimType: "CAPABILITY",
            sourceId: sourceB,
            evidenceKeys: [],
          },
        ],
      },
      context(),
    );

    expect(draft.evidence).toHaveLength(1);
    expect(draft.evidence[0].key.startsWith("evidence:")).toBe(true);
    expect(draft.evidence[0].sourceId).toBe(sourceB);
  });

  it("keeps AI-provided evidence scoped to project sources", () => {
    expect(() =>
      parseIntelligenceInterpretation(
        { evidence: [{ sourceId: "source-elsewhere", kind: "URL_SECTION", locator: "h1" }] },
        context(),
      ),
    ).toThrow(/not part of project/);
  });

  it("never lets the model assert a deterministic fact", () => {
    expect(() =>
      parseIntelligenceInterpretation(
        { claims: [{ text: "Runs on Postgres", assertionKind: "FACT" }] },
        context(),
      ),
    ).toThrow(/unknown field/);

    const draft = parseIntelligenceInterpretation(
      { claims: [{ text: "Runs on Postgres" }] },
      context(),
    );
    expect(draft.claims[0].assertionKind).toBe("INFERENCE");
  });

  it("covers every relationship type with a coherent endpoint pair", () => {
    for (const [type, endpoints] of Object.entries(RELATIONSHIP_ENDPOINTS)) {
      expect(endpoints.from).toBeTruthy();
      expect(endpoints.to).toBeTruthy();
      expect(type.endsWith("PROBLEM") && endpoints.to !== "PROBLEM" && type.includes("SOLVES")).toBe(
        false,
      );
    }
  });
});
