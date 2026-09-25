import { describe, expect, it, vi } from "vitest";
import * as yazl from "yazl";
import { DEFAULT_INPUT_LIMITS } from "../../core/domain/input";
import { IngestionInputProvider } from "./ingestion-provider";
import type { PublicFetchResult } from "./safe-http";

function createZip(path: string, content: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    archive.addBuffer(Buffer.from(content), path);
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.on("error", reject);
    archive.outputStream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    archive.end();
  });
}

function result(overrides: Partial<PublicFetchResult> = {}): PublicFetchResult {
  return {
    url: "https://example.com/",
    statusCode: 200,
    contentType: "text/html; charset=utf-8",
    body: new TextEncoder().encode("<!doctype html><title>Demo</title>"),
    ...overrides,
  };
}

describe("IngestionInputProvider", () => {
  it("validates and stores an uploaded PDF without transforming it", async () => {
    const provider = new IngestionInputProvider({ fetch: vi.fn() });
    const bytes = new TextEncoder().encode("%PDF-1.7\ncontent");

    const acquired = await provider.acquire(
      {
        origin: "upload",
        kind: "pdf",
        name: "brief.pdf",
        file: { name: "brief.pdf", mimeType: "application/pdf", bytes },
      },
      DEFAULT_INPUT_LIMITS,
    );

    expect(acquired).toMatchObject({ kind: "pdf", mimeType: "application/pdf", metadata: { validation: "pdf_signature" } });
    expect(acquired.bytes).toEqual(bytes);
  });

  it("validates explicit text uploads as UTF-8 and normalizes their stored type", async () => {
    const provider = new IngestionInputProvider({ fetch: vi.fn() });

    const acquired = await provider.acquire(
      {
        origin: "upload",
        kind: "text",
        name: "notes.txt",
        file: { name: "notes.txt", mimeType: "text/html", bytes: new TextEncoder().encode("hello") },
      },
      DEFAULT_INPUT_LIMITS,
    );

    expect(acquired.mimeType).toBe("text/plain; charset=utf-8");
    expect(acquired.metadata).toMatchObject({ validation: "utf8_text" });
  });

  it("rejects explicit text uploads that are not UTF-8", async () => {
    const provider = new IngestionInputProvider({ fetch: vi.fn() });

    await expect(
      provider.acquire(
        {
          origin: "upload",
          kind: "text",
          name: "notes.txt",
          file: { name: "notes.txt", mimeType: "text/plain", bytes: new Uint8Array([0xff, 0xfe]) },
        },
        DEFAULT_INPUT_LIMITS,
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_PARSE_FAILED" });
  });

  it("rejects a file whose declared type does not match its signature", async () => {
    const provider = new IngestionInputProvider({ fetch: vi.fn() });

    await expect(
      provider.acquire(
        {
          origin: "upload",
          kind: "pdf",
          name: "fake.pdf",
          file: { name: "fake.pdf", mimeType: "application/pdf", bytes: new TextEncoder().encode("not a pdf") },
        },
        DEFAULT_INPUT_LIMITS,
      ),
    ).rejects.toMatchObject({ code: "INVALID_FILE" });
  });

  it("creates a deterministic, content-preserving bundle for folder uploads", async () => {
    const provider = new IngestionInputProvider({ fetch: vi.fn() });
    const input = {
      origin: "folder" as const,
      kind: "local_project" as const,
      name: "checkout",
      files: [
        { name: "index.ts", relativePath: "src/index.ts", mimeType: "text/plain", bytes: new TextEncoder().encode("export {};") },
        { name: "README.md", relativePath: "README.md", mimeType: "text/markdown", bytes: new TextEncoder().encode("# Demo") },
      ],
    };

    const first = await provider.acquire(input, DEFAULT_INPUT_LIMITS);
    const second = await provider.acquire(input, DEFAULT_INPUT_LIMITS);
    const manifest = JSON.parse(new TextDecoder().decode(first.bytes));

    expect(first.bytes).toEqual(second.bytes);
    expect(first.mimeType).toBe("application/vnd.content-os.local-project+json");
    expect(manifest).toMatchObject({
      format: "content-os.local-project",
      version: 1,
      files: [
        { path: "README.md", content: "IyBEZW1v" },
        { path: "src/index.ts", content: "ZXhwb3J0IHt9Ow==" },
      ],
    });
  });

  it("fetches public website inputs through the guarded fetcher", async () => {
    const fetch = vi.fn(async () => result());
    const provider = new IngestionInputProvider({ fetch });

    const acquired = await provider.acquire(
      { origin: "url", kind: "website", value: "https://example.com/", name: "example.com" },
      DEFAULT_INPUT_LIMITS,
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({ maxBytes: DEFAULT_INPUT_LIMITS.maxUrlBytes }),
    );
    expect(acquired.metadata).toMatchObject({ finalUrl: "https://example.com/", contentType: "text/html" });
  });

  it("acquires a public GitHub archive through metadata and archive endpoints only", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === "https://api.github.com/repos/acme/site") {
        return result({
          url,
          contentType: "application/json",
          body: new TextEncoder().encode(JSON.stringify({ default_branch: "main" })),
        });
      }
      return result({
        url: "https://api.github.com/repos/acme/site/zipball/main",
        contentType: "application/zip",
        body: await createZip("README.md", "# Demo"),
      });
    });
    const provider = new IngestionInputProvider({ fetch });

    const acquired = await provider.acquire(
      { origin: "repository", kind: "github", value: "https://github.com/acme/site", name: "acme/site" },
      DEFAULT_INPUT_LIMITS,
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/acme/site",
      "https://api.github.com/repos/acme/site/zipball/main",
    ]);
    expect(acquired).toMatchObject({
      kind: "github",
      mimeType: "application/zip",
      metadata: { provider: "github", defaultBranch: "main", validation: "zip_entries" },
    });
  });

  it("validates GitLab repository ZIP downloads", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === "https://gitlab.com/api/v4/projects/acme%2Fsite") {
        return result({ url, contentType: "application/json", body: new TextEncoder().encode('{"default_branch":"main"}') });
      }
      return result({
        url,
        contentType: "application/zip",
        body: await createZip("README.md", "# Demo"),
      });
    });
    const provider = new IngestionInputProvider({ fetch });

    const acquired = await provider.acquire(
      { origin: "repository", kind: "gitlab", value: "https://gitlab.com/acme/site", name: "acme/site" },
      DEFAULT_INPUT_LIMITS,
    );

    expect(acquired.metadata).toMatchObject({ provider: "gitlab", defaultBranch: "main" });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://gitlab.com/api/v4/projects/acme%2Fsite/repository/archive.zip?sha=main",
    );
  });
});
