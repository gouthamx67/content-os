import { describe, expect, it } from "vitest";
import { CreativeError } from "../domain/creative-direction";
import {
  creativeModeRegistry,
  getCreativeModePolicy,
  readsAsConceptualVisual,
  readsAsExperimentalHook,
} from "./creative-mode-policy";

describe("creative mode policy", () => {
  it("offers exactly the three documented modes", () => {
    expect(creativeModeRegistry().map((entry) => entry.id)).toEqual([
      "GUIDED",
      "BALANCED",
      "WILD",
    ]);
  });

  it("refuses a mode it does not have", () => {
    expect(() => getCreativeModePolicy("RECKLESS")).toThrow(CreativeError);
    expect(() => getCreativeModePolicy("RECKLESS")).toThrow(
      /GUIDED, BALANCED or WILD/,
    );
  });

  it("keeps unverified claims at zero in every mode", () => {
    for (const mode of ["GUIDED", "BALANCED", "WILD"] as const) {
      expect(getCreativeModePolicy(mode).maxUnverifiedClaims).toBe(0);
    }
  });

  it("actually separates the modes rather than only relabelling them", () => {
    const guided = getCreativeModePolicy("GUIDED");
    const balanced = getCreativeModePolicy("BALANCED");
    const wild = getCreativeModePolicy("WILD");

    expect(guided.allowMetaphor).toBe(false);
    expect(balanced.allowMetaphor).toBe(true);

    expect(guided.allowExperimentalHooks).toBe(false);
    expect(balanced.allowExperimentalHooks).toBe(true);

    expect(guided.requireProductUi).toBe(true);
    expect(balanced.requireProductUi).toBe(false);

    expect(guided.allowConceptualVisuals).toBe(false);
    expect(wild.allowConceptualVisuals).toBe(true);
  });

  it("restricts Guided to angles that can be shown", () => {
    const guided = getCreativeModePolicy("GUIDED");
    expect(guided.allowedAngles).toContain("PRODUCT_FIRST");
    expect(guided.allowedAngles).not.toContain("EMOTIONAL");
    expect(guided.allowedAngles).not.toContain("SOCIAL");
    expect(getCreativeModePolicy("WILD").allowedAngles).toHaveLength(12);
  });
});

describe("experimental hook detection", () => {
  it("recognises a metaphor as an opening", () => {
    expect(readsAsExperimentalHook("Imagine if your status report sent itself")).toBe(
      true,
    );
    expect(readsAsExperimentalHook("Think of it as a very quiet assistant")).toBe(true);
  });

  it("leaves a plain factual opening alone", () => {
    expect(
      readsAsExperimentalHook("Scheduled exports send themselves every Monday"),
    ).toBe(false);
  });
});

describe("conceptual visual detection", () => {
  it("recognises a drawn or abstract look standing in for the product", () => {
    expect(readsAsConceptualVisual("A stylised illustration of the workflow")).toBe(
      true,
    );
    expect(
      readsAsConceptualVisual("An abstracted visual metaphor for the report"),
    ).toBe(true);
  });

  it("leaves a real interface look alone", () => {
    expect(
      readsAsConceptualVisual("The real schedule screen, captured at 1440 wide"),
    ).toBe(false);
  });
});
