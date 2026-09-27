import { describe, expect, it } from "vitest";
import {
  brandEvidenceId,
  brandEvidenceKey,
  canonicalColorKey,
  canonicalFontKey,
  canonicalTermKey,
  isHexColor,
  normalizeFontFamily,
  normalizeHexColor,
  normalizeTerm,
} from "./brand-normalization";

describe("normalizeHexColor", () => {
  it("lowercases and prefixes a six digit hex value", () => {
    expect(normalizeHexColor("#A1B2C3")).toBe("#a1b2c3");
    expect(normalizeHexColor("  A1b2C3  ")).toBe("#a1b2c3");
  });

  it("rejects shorthand, named, and non hex values", () => {
    expect(normalizeHexColor("#fff")).toBeNull();
    expect(normalizeHexColor("#12345")).toBeNull();
    expect(normalizeHexColor("rebeccapurple")).toBeNull();
    expect(normalizeHexColor("rgb(0, 0, 0)")).toBeNull();
    expect(normalizeHexColor("")).toBeNull();
  });
});

describe("normalizeFontFamily", () => {
  it("removes quotes and collapses whitespace", () => {
    expect(normalizeFontFamily(`  "Inter",   'Helvetica Neue' , sans-serif `)).toBe(
      "Inter, Helvetica Neue, sans-serif",
    );
  });

  it("keeps generic families intact", () => {
    expect(normalizeFontFamily("system-ui")).toBe("system-ui");
  });
});

describe("normalizeTerm", () => {
  it("collapses internal whitespace and trims", () => {
    expect(normalizeTerm("  content   operating  system ")).toBe("content operating system");
  });
});

describe("canonical keys", () => {
  it("keys colors by role and normalized hex", () => {
    expect(canonicalColorKey("PRIMARY", "#A1B2C3")).toBe(
      canonicalColorKey("PRIMARY", "a1b2c3"),
    );
    expect(canonicalColorKey("PRIMARY", "#A1B2C3")).not.toBe(
      canonicalColorKey("SECONDARY", "#A1B2C3"),
    );
  });

  it("keys fonts by role and case insensitive family", () => {
    expect(canonicalFontKey("HEADING", `"Inter"`)).toBe(
      canonicalFontKey("HEADING", "inter"),
    );
  });

  it("keys terms case insensitively", () => {
    expect(canonicalTermKey(" Content OS ")).toBe(canonicalTermKey("content os"));
  });
});

describe("brand evidence identity", () => {
  it("is stable for the same source, kind and locator", () => {
    const first = brandEvidenceKey("src_1", "SOURCE_FRAGMENT", "html:title");
    const second = brandEvidenceKey("src_1", "SOURCE_FRAGMENT", "html:title");
    expect(first).toBe(second);
    expect(brandEvidenceId(first)).toBe(brandEvidenceId(second));
  });

  it("differs when the locator differs", () => {
    expect(brandEvidenceKey("src_1", "SOURCE_FRAGMENT", "html:title")).not.toBe(
      brandEvidenceKey("src_1", "SOURCE_FRAGMENT", "html:meta:description"),
    );
  });
});

describe("isHexColor", () => {
  it("only accepts bare six digit hex bodies", () => {
    expect(isHexColor("a1b2c3")).toBe(true);
    expect(isHexColor("#a1b2c3")).toBe(false);
  });
});
