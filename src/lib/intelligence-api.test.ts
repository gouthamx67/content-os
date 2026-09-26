import { describe, expect, it } from "vitest";

import { IntelligenceError, type IntelligenceGraph } from "../core/domain/intelligence";
import { HttpError } from "./http";
import {
  parseCorrectionRequest,
  parseSourceIds,
  serializeGraph,
  wrapIntelligenceHttpError,
} from "./intelligence-api";

function graph(): IntelligenceGraph {
  return {
    product: null,
    features: [],
    problems: [],
    benefits: [],
    claims: [],
    workflows: [],
    audienceSignals: [],
    brandSignals: [],
    assets: [],
    evidence: [],
    relationships: [
      {
        id: "rel_1",
        projectId: "project_1",
        type: "FEATURE_SUPPORTED_BY_EVIDENCE",
        fromType: "FEATURE",
        fromId: "feature_1",
        toType: "EVIDENCE",
        toId: "evidence_1",
        confidence: "HIGH",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

describe("parseCorrectionRequest", () => {
  it("parses a product correction", () => {
    expect(
      parseCorrectionRequest({
        scope: "product",
        name: "Northwind BI",
        assertionKind: "USER_PROVIDED",
      }),
    ).toEqual({
      scope: "product",
      changes: { name: "Northwind BI", assertionKind: "USER_PROVIDED" },
    });
  });

  it("parses each entity correction", () => {
    expect(
      parseCorrectionRequest({
        scope: "FEATURE",
        canonicalKey: "feature:dashboards",
        name: "Dashboards",
        importance: "PRIMARY",
      }),
    ).toEqual({
      scope: "FEATURE",
      canonicalKey: "feature:dashboards",
      changes: { name: "Dashboards", importance: "PRIMARY" },
    });

    expect(
      parseCorrectionRequest({
        scope: "CLAIM",
        canonicalKey: "claim:exports-csv",
        text: "Exports CSV",
        claimType: "FORMAT",
        verification: "SUPPORTED",
      }),
    ).toEqual({
      scope: "CLAIM",
      canonicalKey: "claim:exports-csv",
      changes: { text: "Exports CSV", claimType: "FORMAT", verification: "SUPPORTED" },
    });

    expect(
      parseCorrectionRequest({
        scope: "WORKFLOW",
        canonicalKey: "workflow:launch",
        steps: [{ action: "Draft", featureIds: ["feature_1"] }, { action: "Review" }],
      }),
    ).toEqual({
      scope: "WORKFLOW",
      canonicalKey: "workflow:launch",
      changes: {
        steps: [
          { order: 0, action: "Draft", description: null, featureIds: ["feature_1"] },
          { order: 1, action: "Review", description: null, featureIds: [] },
        ],
      },
    });
  });

  it("rejects unknown scopes, enums and shapes", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["unknown scope", { scope: "EVIDENCE" }],
      ["missing canonical key", { scope: "FEATURE", name: "x" }],
      ["blank canonical key", { scope: "FEATURE", canonicalKey: "  ", name: "x" }],
      ["bad category", { scope: "FEATURE", canonicalKey: "f:1", category: "NOPE" }],
      ["bad importance", { scope: "FEATURE", canonicalKey: "f:1", importance: "URGENT" }],
      ["bad claim type", { scope: "CLAIM", canonicalKey: "c:1", claimType: "NOPE" }],
      ["bad verification", { scope: "CLAIM", canonicalKey: "c:1", verification: "MAYBE" }],
      ["bad asset role", { scope: "ASSET", canonicalKey: "a:1", role: "HERO_IMAGE" }],
      ["bad assertion kind", { scope: "PROBLEM", canonicalKey: "p:1", assertionKind: "GUESS" }],
      ["wrong field type", { scope: "FEATURE", canonicalKey: "f:1", name: 7 }],
      ["empty change", { scope: "PROBLEM", canonicalKey: "p:1" }],
      ["steps not an array", { scope: "WORKFLOW", canonicalKey: "w:1", steps: "draft" }],
      ["step missing action", { scope: "WORKFLOW", canonicalKey: "w:1", steps: [{ order: 0 }] }],
      [
        "step feature ids not strings",
        { scope: "WORKFLOW", canonicalKey: "w:1", steps: [{ action: "a", featureIds: [1] }] },
      ],
    ];

    for (const [label, body] of cases) {
      expect(() => parseCorrectionRequest(body), label).toThrowError(HttpError);
    }
  });

  it("only accepts string arrays for sourceIds", () => {
    expect(parseSourceIds({ sourceIds: ["a", "b"] })).toEqual(["a", "b"]);
    expect(parseSourceIds({})).toBeUndefined();
    expect(() => parseSourceIds({ sourceIds: ["a", 2] })).toThrowError(HttpError);
    expect(() => parseSourceIds({ sourceIds: "a" })).toThrowError(HttpError);
  });
});

describe("wrapIntelligenceHttpError", () => {
  it("maps intelligence error codes to statuses", () => {
    const cases: Array<[string, number]> = [
      ["INTELLIGENCE_INVALID_INPUT", 400],
      ["INTELLIGENCE_NOT_FOUND", 404],
      ["INTELLIGENCE_ALREADY_RUNNING", 409],
      ["INTELLIGENCE_AI_INVALID_OUTPUT", 422],
      ["INTELLIGENCE_AI_UNAVAILABLE", 422],
      ["INTELLIGENCE_SOURCE_UNREADABLE", 422],
      ["INTELLIGENCE_SCOPE_VIOLATION", 403],
    ];

    for (const [code, status] of cases) {
      const error = new IntelligenceError(
        code as ConstructorParameters<typeof IntelligenceError>[0],
        "boom",
      );
      const response = wrapIntelligenceHttpError(error);
      expect(response.status, code).toBe(status);
    }
  });

  it("keeps authorization errors from the project service", () => {
    expect(wrapIntelligenceHttpError(new HttpError(403, "Forbidden")).status).toBe(403);
    expect(wrapIntelligenceHttpError(new HttpError(404, "Project not found")).status).toBe(404);
    expect(wrapIntelligenceHttpError(new Error("boom")).status).toBe(500);
  });
});

describe("serializeGraph", () => {
  it("exposes the graph with serialized relationships", () => {
    const serialized = serializeGraph(graph());

    expect(serialized.relationships).toEqual([
      {
        id: "rel_1",
        type: "FEATURE_SUPPORTED_BY_EVIDENCE",
        fromType: "FEATURE",
        fromId: "feature_1",
        toType: "EVIDENCE",
        toId: "evidence_1",
        confidence: "HIGH",
      },
    ]);
    expect(serialized.features).toEqual([]);
  });
});
