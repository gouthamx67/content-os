import { describe, expect, it } from "vitest";
import { createLocalRulesProvider } from "./local-rules-provider";
import { validateVariant } from "../claims/validate-variant";
import { makeContext } from "../__tests__/fixtures";

describe("local rules provider", () => {
  it("returns distinct, budgeted, groundable candidates", async () => {
    const provider = createLocalRulesProvider();
    const context = makeContext();
    const result = await provider.generate({ context, variantCount: 3 });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
    expect(new Set(result.candidates.map((c) => c.text)).size).toBe(
      result.candidates.length,
    );
    for (const candidate of result.candidates) {
      expect(candidate.text.length).toBeGreaterThan(0);
      expect(validateVariant(candidate.text, context).accepted).toBe(true);
    }
  });

  it("is deterministic for the same context", async () => {
    const provider = createLocalRulesProvider();
    const context = makeContext();
    const first = await provider.generate({ context, variantCount: 3 });
    const second = await provider.generate({ context, variantCount: 3 });
    expect(first.candidates.map((c) => c.text)).toEqual(
      second.candidates.map((c) => c.text),
    );
  });

  it("never emits a brand-prohibited term or hype", async () => {
    const provider = createLocalRulesProvider();
    const context = makeContext({
      brand: { ...makeContext().brand, prohibitedTerms: ["revolutionary"] },
    });
    const result = await provider.generate({ context, variantCount: 5 });
    for (const candidate of result.candidates) {
      expect(candidate.text.toLowerCase()).not.toContain("revolutionary");
      expect(candidate.text.toLowerCase()).not.toContain("game-changing");
    }
  });

  it("reports its model and version", async () => {
    const provider = createLocalRulesProvider();
    const result = await provider.generate({
      context: makeContext(),
      variantCount: 1,
    });
    expect(result.providerModel).toBe("local-rules");
    expect(result.providerVersion).toBe("local-rules-1");
  });
});
