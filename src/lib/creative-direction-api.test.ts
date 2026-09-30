import { describe, expect, it } from "vitest";

import {
  creativeRegistry,
  wrapCreativeHttpError,
  parseCreativeDirectionEditRequest,
  parseGenerateCreativeRequest,
  serializeCreativeDirection,
} from "./creative-direction-api";
import { makeCreativeDirection } from "../testing/fakes";
import { HttpError } from "./http";
import { CreativeError } from "../core/domain/creative-direction";
import { CreativeValidationFailure } from "../core/services/creative-direction-validator";

describe("parseGenerateCreativeRequest", () => {
  it("reads the three fields a person chooses", () => {
    expect(
      parseGenerateCreativeRequest({ intentId: "int_1", mode: "WILD", count: 4 }),
    ).toEqual({ intentId: "int_1", mode: "WILD", count: 4 });
  });

  it("defaults the mode rather than guessing an angle", () => {
    expect(parseGenerateCreativeRequest({ intentId: "int_1" })).toEqual({
      intentId: "int_1",
      mode: "BALANCED",
    });
  });

  it("refuses a mode the domain does not have", () => {
    expect(() =>
      parseGenerateCreativeRequest({ intentId: "int_1", mode: "RECKLESS" }),
    ).toThrow(HttpError);
  });

  it("refuses a body that is not an object", () => {
    expect(() => parseGenerateCreativeRequest([{ intentId: "int_1" }])).toThrow(
      /JSON object/,
    );
    expect(() => parseGenerateCreativeRequest("int_1")).toThrow(/JSON object/);
  });

  it("refuses a missing intent id", () => {
    expect(() => parseGenerateCreativeRequest({ mode: "WILD" })).toThrow(
      /intentId is required/,
    );
  });

  it("refuses a count that is not a whole number", () => {
    expect(() =>
      parseGenerateCreativeRequest({ intentId: "int_1", count: 2.5 }),
    ).toThrow(/whole number/);
  });

  /**
   * The point of the boundary: a client cannot ask for a direction grounded in
   * material this project does not have by sending that material itself.
   */
  it("refuses a body that tries to supply the server's own context", () => {
    expect(() =>
      parseGenerateCreativeRequest({
        intentId: "int_1",
        mode: "BALANCED",
        brandVersion: 9,
        intelligenceVersion: 3,
        assets: [{ id: "as_x" }],
        claims: [{ id: "cl_x", text: "Anything at all" }],
      }),
    ).toThrow(/derives brandVersion, intelligenceVersion, assets, claims/);
  });

  it("refuses a body that tries to set the score", () => {
    expect(() =>
      parseGenerateCreativeRequest({ intentId: "int_1", strengthScore: 100 }),
    ).toThrow(/strengthScore/);
  });
});

describe("serializeCreativeDirection", () => {
  it("keeps the score out of the response", () => {
    // The score orders drafts for a reader; it does not say which idea is best.
    const serialized = serializeCreativeDirection(
      makeCreativeDirection({ strengthScore: 91 }),
    );
    expect(serialized).not.toHaveProperty("strengthScore");
    expect(Object.keys(serialized)).not.toContain("strengthScore");
  });

  it("carries the grounding ids the panel shows as proof", () => {
    const serialized = serializeCreativeDirection(
      makeCreativeDirection({
        proofStrategy: { claimIds: ["cl_1"], evidenceIds: ["ev_1"], proofPoints: ["x"] },
        visualStrategy: {
          approach: "The real screen",
          rationale: "Because",
          productMoments: ["The queue"],
          assetIds: ["as_1"],
        },
      }),
    );
    expect(serialized.proofStrategy.claimIds).toEqual(["cl_1"]);
    expect(serialized.visualStrategy.assetIds).toEqual(["as_1"]);
  });
});

describe("parseCreativeDirectionEditRequest", () => {
  it("reads a single field edit", () => {
    expect(parseCreativeDirectionEditRequest({ thesis: "A calmer opening" })).toEqual({
      thesis: "A calmer opening",
    });
  });

  it("reads a nested strategy as a whole object", () => {
    const hook = {
      statement: "Chasing status eats a morning",
      mechanism: "Open on a real moment",
      emotionalTrigger: "Recognition",
    };
    expect(parseCreativeDirectionEditRequest({ hook })).toEqual({ hook });
  });

  it("reads a cleared call to action", () => {
    expect(parseCreativeDirectionEditRequest({ cta: null })).toEqual({ cta: null });
  });

  it("reads a status change", () => {
    expect(parseCreativeDirectionEditRequest({ status: "REJECTED" })).toEqual({
      status: "REJECTED",
    });
  });

  it("refuses a field the domain does not have", () => {
    expect(() =>
      parseCreativeDirectionEditRequest({ scenes: ["a beat"] }),
    ).toThrow(/not editable/);
  });

  it("refuses a field the server owns", () => {
    expect(() =>
      parseCreativeDirectionEditRequest({ strengthScore: 100 }),
    ).toThrow(/not editable/);
    expect(() =>
      parseCreativeDirectionEditRequest({ brandVersion: 4 }),
    ).toThrow(/not editable/);
  });

  it("refuses an angle the domain does not have", () => {
    expect(() => parseCreativeDirectionEditRequest({ angle: "VIBE_CHECK" })).toThrow(
      HttpError,
    );
  });

  it("refuses a nested strategy sent as a list", () => {
    expect(() =>
      parseCreativeDirectionEditRequest({ hook: ["just one line"] }),
    ).toThrow(/must be an object/);
  });

  it("reads an empty body as an edit that changes nothing", () => {
    // The service still revalidates and stamps the row, so an empty PATCH is
    // harmless rather than an error the caller has to special-case.
    expect(parseCreativeDirectionEditRequest({})).toEqual({});
  });
});

describe("creativeRegistry", () => {
  it("carries every mode with the limits the panel needs to explain them", () => {
    const modes = creativeRegistry().modes;
    expect(modes.map((mode) => mode.id)).toEqual(["GUIDED", "BALANCED", "WILD"]);

    const guided = modes.find((mode) => mode.id === "GUIDED")!;
    expect(guided.requireProductUi).toBe(true);
    expect(guided.allowExperimentalHooks).toBe(false);
    expect(guided.maxUnverifiedClaims).toBe(0);
  });

  it("lets the panel warn before a mode is unavailable", () => {
    const modes = creativeRegistry().modes;
    expect(modes.find((mode) => mode.id === "GUIDED")!.requireProductUi).toBe(true);
    expect(modes.find((mode) => mode.id === "WILD")!.requireProductUi).toBe(false);
  });
});

describe("wrapCreativeHttpError", () => {
  it("answers 422 and names the rules a refused direction broke", async () => {
    const error = new CreativeValidationFailure([
      { code: "CREATIVE_UNVERIFIED_CLAIM", message: "Claim 1 is unverified" },
      { code: "CREATIVE_UNKNOWN_ASSET", message: "asset_9 is not in this project" },
    ]);

    const response = wrapCreativeHttpError(error);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.code).toBe("CREATIVE_UNVERIFIED_CLAIM");
    expect(body.issues).toEqual(error.issues);
  });

  it("still answers 422 when a failure carries no issues", async () => {
    const response = wrapCreativeHttpError(new CreativeValidationFailure([]));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.code).toBe("CREATIVE_INVALID_OUTPUT");
    expect(body.issues).toEqual([]);
  });

  it("leaves an unexpected error to the shared wrapper", async () => {
    const response = wrapCreativeHttpError(new Error("socket hang up"));
    expect(response.status).toBe(500);
  });

  it("keeps a creative error on its own status", async () => {
    const response = wrapCreativeHttpError(
      new CreativeError("CREATIVE_MODE_CONFLICT", "Guided needs product UI"),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.code).toBe("CREATIVE_MODE_CONFLICT");
  });
});
