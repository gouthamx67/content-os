import { describe, expect, it } from "vitest";
import {
  generatedAssetRef,
  parseAssetReference,
} from "../assets/asset-reference";

describe("parseAssetReference", () => {
  it("parses each supported kind", () => {
    expect(parseAssetReference("product:abc")).toEqual({
      kind: "product",
      id: "abc",
    });
    expect(parseAssetReference("brand:logo_1")).toEqual({
      kind: "brand",
      id: "logo_1",
    });
    expect(parseAssetReference("generated:iasset-1")).toEqual({
      kind: "generated",
      id: "iasset-1",
    });
  });

  it("rejects a URL", () => {
    expect(() => parseAssetReference("https://evil.example/x.png")).toThrow();
  });

  it("rejects a filesystem path", () => {
    expect(() => parseAssetReference("../../etc/passwd")).toThrow();
  });

  it("rejects an empty reference", () => {
    expect(() => parseAssetReference("")).toThrow(/Empty/i);
  });

  it("rejects an unsupported kind", () => {
    expect(() => parseAssetReference("http:abc")).toThrow(/Unsupported/i);
  });
});

describe("generatedAssetRef", () => {
  it("builds the canonical generated reference", () => {
    expect(generatedAssetRef("iasset_1")).toBe("generated:iasset_1");
  });

  it("refuses an id that is not a plain id", () => {
    expect(() => generatedAssetRef("../x")).toThrow(/plain id/i);
  });
});
