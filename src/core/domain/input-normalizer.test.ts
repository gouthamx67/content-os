import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT_LIMITS, InputError } from "./input";
import { normalizeBatch, normalizeInput, type RawInputFile } from "./input-normalizer";

function file(name: string, bytes: Uint8Array, mimeType = "application/octet-stream"): RawInputFile {
  return { name, bytes, mimeType };
}

function folderFile(relativePath: string, value: string): RawInputFile {
  return {
    name: relativePath.split("/").at(-1) ?? relativePath,
    relativePath,
    mimeType: "text/plain",
    bytes: new TextEncoder().encode(value),
  };
}

describe("input normalization", () => {
  it("normalizes website and web app URLs", () => {
    expect(normalizeInput({ type: "url", value: "https://example.com/path" })).toEqual({
      origin: "url",
      kind: "website",
      value: "https://example.com/path",
      name: "example.com/path",
    });
    expect(
      normalizeInput({ type: "url", kind: "web_app", value: "https://example.com/app/" }),
    ).toMatchObject({ origin: "url", kind: "web_app", value: "https://example.com/app/" });
  });

  it("preserves Figma references without treating them as web pages", () => {
    expect(
      normalizeInput({ type: "url", kind: "figma", value: "https://www.figma.com/file/abc/App" }),
    ).toMatchObject({ origin: "url", kind: "figma" });
  });

  it("normalizes public GitHub repository URLs", () => {
    expect(
      normalizeInput({
        type: "repository",
        provider: "github",
        value: "https://github.com/acme/site.git",
      }),
    ).toEqual({
      origin: "repository",
      kind: "github",
      value: "https://github.com/acme/site",
      name: "acme/site",
    });
  });

  it("normalizes nested GitLab repository URLs", () => {
    expect(
      normalizeInput({
        type: "repository",
        provider: "gitlab",
        value: "https://gitlab.com/group/subgroup/site/-/tree/main",
      }),
    ).toMatchObject({
      kind: "gitlab",
      value: "https://gitlab.com/group/subgroup/site",
    });
  });

  it("rejects repository URLs outside the selected public host", () => {
    expect(() =>
      normalizeInput({
        type: "repository",
        provider: "github",
        value: "https://gitlab.com/acme/site",
      }),
    ).toThrowError(expect.objectContaining({ code: "REPOSITORY_INVALID" }));
  });

  it("rejects GitHub URLs that do not identify a repository", () => {
    expect(() =>
      normalizeInput({
        type: "repository",
        provider: "github",
        value: "https://github.com/acme/site/issues",
      }),
    ).toThrowError(expect.objectContaining({ code: "REPOSITORY_INVALID" }));
  });

  it("normalizes signed image uploads by content", () => {
    const input = normalizeInput({
      type: "upload",
      file: file("avatar.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])),
    });
    expect(input).toMatchObject({ origin: "upload", kind: "image" });
  });

  it("rejects files whose declared type conflicts with their signature", () => {
    expect(() =>
      normalizeInput({
        type: "upload",
        file: file("fake.pdf", new TextEncoder().encode("not a pdf"), "application/pdf"),
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_FILE" }));
  });

  it("normalizes ZIP uploads before deeper archive inspection", () => {
    expect(
      normalizeInput({
        type: "upload",
        file: file("archive.zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "application/zip"),
      }),
    ).toMatchObject({ origin: "upload", kind: "zip" });
  });

  it("accepts spreadsheet documents and both TIFF byte orders", () => {
    expect(
      normalizeInput({
        type: "upload",
        file: file("budget.xlsx", new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      }),
    ).toMatchObject({ kind: "document" });
    expect(
      normalizeInput({
        type: "upload",
        file: file("scan.tif", new Uint8Array([0x4d, 0x4d, 0x00, 0x2a])),
      }),
    ).toMatchObject({ kind: "image" });
  });

  it("rejects SVG uploads instead of storing active markup", () => {
    expect(() =>
      normalizeInput({
        type: "upload",
        file: file("logo.svg", new TextEncoder().encode("<svg/>"), "image/svg+xml"),
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_FILE" }));
  });

  it("normalizes pasted text and UTF-8 documents", () => {
    expect(normalizeInput({ type: "text", name: "Brief", value: "Hello" })).toEqual({
      origin: "clipboard",
      kind: "text",
      value: "Hello",
      name: "Brief",
    });
    expect(
      normalizeInput({
        type: "upload",
        file: file("README.md", new TextEncoder().encode("# Hello"), "text/markdown"),
      }),
    ).toMatchObject({ kind: "document" });
  });

  it("normalizes folder paths deterministically", () => {
    const input = normalizeInput({
      type: "folder",
      name: "Demo",
      files: [folderFile("src/b.ts", "b"), folderFile("src/a.ts", "a")],
    });
    expect(input).toMatchObject({ origin: "folder", kind: "local_project", name: "Demo" });
    if (input.origin === "folder") {
      expect(input.files.map((entry) => entry.relativePath)).toEqual([
        "src/a.ts",
        "src/b.ts",
      ]);
    }
  });

  it("rejects traversal, absolute, encoded backslash, drive, and NUL paths", () => {
    for (const path of [
      "../outside.txt",
      "/absolute.txt",
      "safe%5C..%5Coutside.txt",
      "C%3A/outside.txt",
      `safe${String.fromCharCode(0)}name.txt`,
    ]) {
      expect(() =>
        normalizeInput({
          type: "folder",
          files: [folderFile(path, "content")],
        }),
      ).toThrowError(expect.objectContaining({ code: "INVALID_FILE" }));
    }
  });

  it("rejects duplicate folder paths", () => {
    expect(() =>
      normalizeInput({
        type: "folder",
        files: [folderFile("src/a.ts", "a"), folderFile("src/a.ts", "b")],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_FILE" }));
  });

  it("rejects empty and oversized folders", () => {
    expect(() => normalizeInput({ type: "folder", files: [] })).toThrowError(
      expect.objectContaining({ code: "INVALID_FILE" }),
    );
    expect(() =>
      normalizeInput(
        {
          type: "folder",
          files: [folderFile("large.bin", "x")],
        },
        { ...DEFAULT_INPUT_LIMITS, maxFolderBytes: 0 },
      ),
    ).toThrowError(expect.objectContaining({ code: "FILE_TOO_LARGE" }));
  });

  it("rejects unsupported, empty, and oversized text inputs", () => {
    expect(() => normalizeInput({ type: "text", value: " " })).toThrowError(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    expect(() =>
      normalizeInput(
        { type: "text", value: "too large" },
        { ...DEFAULT_INPUT_LIMITS, maxTextBytes: 1 },
      ),
    ).toThrowError(expect.objectContaining({ code: "FILE_TOO_LARGE" }));
  });

  it("enforces a true batch limit", () => {
    expect(() =>
      normalizeBatch(
        Array.from({ length: 21 }, () => ({ type: "text", value: "x" }) as const),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  it("uses stable InputError instances", () => {
    expect(() => normalizeInput({ type: "url", value: "not a url" })).toThrowError(InputError);
  });
});
