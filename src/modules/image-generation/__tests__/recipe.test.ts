import { describe, expect, it } from "vitest";
import { hashRecipe } from "../serialization/hash-recipe";
import { buildGenerationRecipe } from "../recipe/build-recipe";
import {
  parseGenerationRecipe,
  serializeGenerationRecipe,
} from "../recipe/generation-recipe";
import { fakeContextDeps } from "./fixtures";

const baseInput = {
  templateType: "PRODUCT_HERO",
  provider: "LOCAL_GRAPHIC",
  prompt: "Announce storyboards",
  width: 1080,
  height: 1080,
  outputFormat: "PNG",
  transparent: false,
  context: { projectId: "project_1", userRequest: "Announce storyboards" },
} as const;

describe("hashRecipe", () => {
  it("is stable regardless of object key order", () => {
    expect(hashRecipe({ a: 1, b: { c: 2, d: 3 } })).toBe(
      hashRecipe({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it("changes when the content changes", () => {
    expect(hashRecipe({ a: 1 })).not.toBe(hashRecipe({ a: 2 }));
  });
});

describe("buildGenerationRecipe", () => {
  it("produces a 64-character digest and a parseable recipe", async () => {
    const built = await buildGenerationRecipe(baseInput, fakeContextDeps());

    expect(built.recipeSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(built.recipe.designGraph.elements.length).toBeGreaterThan(0);

    const parsed = parseGenerationRecipe(built.recipeJson);
    expect(hashRecipe(parsed)).toBe(built.recipeSha256);
  });

  it("is deterministic for the same input", async () => {
    const first = await buildGenerationRecipe(baseInput, fakeContextDeps());
    const second = await buildGenerationRecipe(baseInput, fakeContextDeps());
    expect(first.recipeSha256).toBe(second.recipeSha256);
    expect(first.recipeJson).toBe(second.recipeJson);
  });

  it("changes the digest when the prompt changes", async () => {
    const first = await buildGenerationRecipe(baseInput, fakeContextDeps());
    const second = await buildGenerationRecipe(
      { ...baseInput, prompt: "Different brief" },
      fakeContextDeps(),
    );
    expect(first.recipeSha256).not.toBe(second.recipeSha256);
  });
});

describe("parseGenerationRecipe", () => {
  it("rejects invalid JSON", () => {
    expect(() => parseGenerationRecipe("{not json")).toThrow(/not valid JSON/i);
  });

  it("rejects an unknown contract version", () => {
    expect(() =>
      parseGenerationRecipe(JSON.stringify({ contractVersion: 99 })),
    ).toThrow(/contract version/i);
  });

  it("round-trips a real recipe", async () => {
    const built = await buildGenerationRecipe(baseInput, fakeContextDeps());
    const roundTripped = parseGenerationRecipe(
      serializeGenerationRecipe(built.recipe),
    );
    expect(roundTripped.prompt).toBe(baseInput.prompt);
    expect(roundTripped.provider).toBe("LOCAL_GRAPHIC");
  });
});
