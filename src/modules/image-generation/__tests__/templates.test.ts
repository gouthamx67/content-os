import { describe, expect, it } from "vitest";
import { GRAPHIC_TEMPLATE_TYPES } from "../domain/types";
import { validateDesignGraph } from "../domain/validation";
import { hashRecipe } from "../serialization/hash-recipe";
import { getGraphicTemplate } from "../templates/registry";
import { sampleContext } from "./fixtures";

describe("graphic templates", () => {
  for (const type of GRAPHIC_TEMPLATE_TYPES) {
    it(`${type} builds a valid, deterministic graph`, () => {
      const template = getGraphicTemplate(type);
      const input = {
        context: sampleContext,
        width: template.defaultWidth,
        height: template.defaultHeight,
        transparent: false,
      };

      const first = template.build(input);
      const second = template.build(input);

      expect(first.contractVersion).toBe(1);
      expect(first.width).toBe(template.defaultWidth);
      expect(first.height).toBe(template.defaultHeight);
      expect(first.elements.length).toBeGreaterThan(0);
      expect(() => validateDesignGraph(first)).not.toThrow();
      expect(hashRecipe(first)).toBe(hashRecipe(second));
    });

    it(`${type} leaves the background transparent when asked`, () => {
      const template = getGraphicTemplate(type);
      const graph = template.build({
        context: sampleContext,
        width: template.defaultWidth,
        height: template.defaultHeight,
        transparent: true,
      });

      expect(graph.background).toEqual({ kind: "TRANSPARENT" });
    });
  }

  it("throws for an unknown template rather than falling back to a default", () => {
    expect(() =>
      getGraphicTemplate("UNKNOWN" as (typeof GRAPHIC_TEMPLATE_TYPES)[number]),
    ).toThrow(/Unknown graphic template/i);
  });

  it("draws brand content into the graph", () => {
    const graph = getGraphicTemplate("PRODUCT_HERO").build({
      context: sampleContext,
      width: 1080,
      height: 1080,
      transparent: false,
    });

    const text = graph.elements
      .filter((element) => element.type === "TEXT")
      .map((element) => element.text ?? "")
      .join(" ");

    expect(text).toContain(sampleContext.product.name);
  });
});
